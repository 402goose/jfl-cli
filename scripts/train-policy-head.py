#!/usr/bin/env python3
"""
Train policy head from training buffer tuples.

Reads .jfl/training-buffer.jsonl, embeds via Stratus, trains a 768→256→256→1
Q-network that predicts reward given (state_embedding, action_embedding).

Usage:
    python3 scripts/train-policy-head.py [--buffer PATH] [--epochs N] [--lr RATE]

    STRATUS_API_KEY must be set in environment.

Output:
    .jfl/policy-weights.json — trained weights for inference
    .jfl/policy-embeddings.json — cached embeddings (skip re-embedding on retrain)
"""

import json
import os
import sys
import time
import urllib.request
import argparse
from pathlib import Path

import numpy as np

STRATUS_API_KEY = os.environ.get("STRATUS_API_KEY", "")
STRATUS_URL = os.environ.get("STRATUS_API_URL", "https://api.stratus.run")
EMBED_DIM = 768
HIDDEN_DIM = 256
EMBED_BATCH_SIZE = 20


def load_buffer(path: str) -> list[dict]:
    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except Exception:
                pass
    return entries


def format_state_text(entry: dict) -> str:
    s = entry["state"]
    dims = ", ".join(f"{k}={v:.4f}" for k, v in s.get("dimension_scores", {}).items())
    deltas = ", ".join(
        f"{'+' if d >= 0 else ''}{d:.4f}" for d in s.get("recent_deltas", [])
    )
    return (
        f"Agent: {s.get('agent', '?')}\n"
        f"Composite: {s.get('composite_score', 0):.4f}\n"
        f"Tests: {s.get('tests_passing', 0)}/{s.get('tests_total', 0)}\n"
        f"Trajectory: {s.get('trajectory_length', 0)}\n"
        f"Dimensions: {dims or 'none'}\n"
        f"Recent deltas: {deltas or 'none'}"
    )


def format_action_text(entry: dict) -> str:
    a = entry["action"]
    files = ", ".join(a.get("files_affected", [])[:5])
    return (
        f"Type: {a.get('type', '?')}\n"
        f"Description: {a.get('description', '')[:150]}\n"
        f"Scope: {a.get('scope', '?')}\n"
        f"Files: {files or 'none'}"
    )


def embed_batch(texts: list[str]) -> list[list[float]]:
    data = json.dumps({"model": "stratus-x1ac-base", "input": texts}).encode()
    req = urllib.request.Request(
        f"{STRATUS_URL}/v1/embeddings",
        data=data,
        headers={
            "Authorization": f"Bearer {STRATUS_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        result = json.loads(resp.read())
        return [d["embedding"] for d in result["data"]]
    except Exception as e:
        print(f"  Embedding error: {e}", file=sys.stderr)
        return [[0.0] * EMBED_DIM] * len(texts)


def embed_all(texts: list[str], label: str = "") -> np.ndarray:
    all_embeddings = []
    total = len(texts)
    for i in range(0, total, EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        embs = embed_batch(batch)
        all_embeddings.extend(embs)
        done = min(i + EMBED_BATCH_SIZE, total)
        print(f"  {label}: {done}/{total} embedded", end="\r")
    print(f"  {label}: {total}/{total} embedded    ")
    return np.array(all_embeddings, dtype=np.float64)


# --- Neural Network ---


def xavier_init(fan_in: int, fan_out: int) -> np.ndarray:
    std = np.sqrt(2.0 / fan_in) * 0.1  # Small init for stability
    return (np.random.randn(fan_in, fan_out) * std).astype(np.float64)


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(0, x)


def relu_grad(x: np.ndarray) -> np.ndarray:
    return (x > 0).astype(np.float64)


class PolicyHead:
    def __init__(self, input_dim: int = EMBED_DIM * 2, hidden_dim: int = HIDDEN_DIM):
        self.W1 = xavier_init(input_dim, hidden_dim)
        self.b1 = np.zeros(hidden_dim, dtype=np.float64)
        self.W2 = xavier_init(hidden_dim, hidden_dim)
        self.b2 = np.zeros(hidden_dim, dtype=np.float64)
        self.W3 = xavier_init(hidden_dim, 1)
        self.b3 = np.zeros(1, dtype=np.float64)

        # Adam state
        self.params = [self.W1, self.b1, self.W2, self.b2, self.W3, self.b3]
        self.m = [np.zeros_like(p) for p in self.params]
        self.v = [np.zeros_like(p) for p in self.params]
        self.t = 0

    def forward(self, x: np.ndarray) -> tuple:
        z1 = x @ self.W1 + self.b1
        a1 = relu(z1)
        z2 = a1 @ self.W2 + self.b2
        a2 = relu(z2)
        z3 = a2 @ self.W3 + self.b3
        return z3, (x, z1, a1, z2, a2)

    def backward(self, pred: np.ndarray, target: np.ndarray, cache: tuple) -> list:
        x, z1, a1, z2, a2 = cache
        batch_size = x.shape[0]

        # MSE gradient
        dz3 = (pred - target) / batch_size  # (B, 1)

        dW3 = a2.T @ dz3
        db3 = dz3.sum(axis=0)

        da2 = dz3 @ self.W3.T
        dz2 = da2 * relu_grad(z2)

        dW2 = a1.T @ dz2
        db2 = dz2.sum(axis=0)

        da1 = dz2 @ self.W2.T
        dz1 = da1 * relu_grad(z1)

        dW1 = x.T @ dz1
        db1 = dz1.sum(axis=0)

        return [dW1, db1, dW2, db2, dW3, db3]

    def adam_step(self, grads: list, lr: float = 1e-4, beta1=0.9, beta2=0.999, eps=1e-8, max_grad_norm=1.0):
        # Clip individual gradient values first
        grads = [np.clip(g, -5.0, 5.0) for g in grads]

        # Global gradient norm clipping
        total_norm = 0.0
        for g in grads:
            total_norm += float(np.sum(g.astype(np.float64) ** 2))
        total_norm = np.sqrt(total_norm)
        if total_norm > max_grad_norm:
            scale = max_grad_norm / (total_norm + eps)
            grads = [g * scale for g in grads]

        self.t += 1
        for i, (param, grad) in enumerate(zip(self.params, grads)):
            if np.any(np.isnan(grad)):
                continue
            self.m[i] = beta1 * self.m[i] + (1 - beta1) * grad
            self.v[i] = beta2 * self.v[i] + (1 - beta2) * (grad ** 2)
            m_hat = self.m[i] / (1 - beta1 ** self.t)
            v_hat = self.v[i] / (1 - beta2 ** self.t)
            update = lr * m_hat / (np.sqrt(v_hat) + eps)
            param -= np.clip(update, -0.1, 0.1)
        # Sync references
        self.W1, self.b1, self.W2, self.b2, self.W3, self.b3 = self.params

    def save(self, path: str, metadata: dict):
        weights = {
            "version": 1,
            "architecture": f"{self.W1.shape[0]}-{self.W1.shape[1]}-{self.W2.shape[1]}-{self.W3.shape[1]}",
            "embed_dim": EMBED_DIM,
            "mode": "embedding",
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **metadata,
            "layers": {
                "W1": self.W1.tolist(),
                "b1": self.b1.tolist(),
                "W2": self.W2.tolist(),
                "b2": self.b2.tolist(),
                "W3": self.W3.tolist(),
                "b3": self.b3.tolist(),
            },
        }
        with open(path, "w") as f:
            json.dump(weights, f)


def train(
    entries: list[dict],
    epochs: int = 50,
    lr: float = 1e-4,
    batch_size: int = 32,
    cache_path: str | None = None,
) -> tuple:
    print(f"\n  Training policy head on {len(entries)} tuples\n")

    # Check for cached embeddings
    state_embs = None
    action_embs = None
    if cache_path and os.path.exists(cache_path):
        print("  Loading cached embeddings...")
        with open(cache_path) as f:
            cache = json.load(f)
        if cache.get("count") == len(entries):
            state_embs = np.array(cache["state_embeddings"], dtype=np.float64)
            action_embs = np.array(cache["action_embeddings"], dtype=np.float64)
            print(f"  Loaded {len(state_embs)} cached embeddings")

    if state_embs is None:
        # Embed states and actions
        state_texts = [format_state_text(e) for e in entries]
        action_texts = [format_action_text(e) for e in entries]

        state_embs = embed_all(state_texts, "States")
        action_embs = embed_all(action_texts, "Actions")

        # Cache embeddings
        if cache_path:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w") as f:
                json.dump(
                    {
                        "count": len(entries),
                        "state_embeddings": state_embs.tolist(),
                        "action_embeddings": action_embs.tolist(),
                    },
                    f,
                )
            print(f"  Cached embeddings to {cache_path}")

    # Prepare training data
    # Input: concat(state_embedding, action_embedding) = 1536 dims
    X = np.concatenate([state_embs, action_embs], axis=1)

    # L2 normalize each input vector for stable training
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-8)
    X = X / norms

    # Target: composite_delta (reward)
    y = np.array(
        [float(e["reward"].get("composite_delta", 0)) for e in entries],
        dtype=np.float64,
    ).reshape(-1, 1)

    # Normalize targets to [-1, 1] range for stable training
    y_mean = y.mean()
    y_std = max(y.std(), 1e-6)
    y_norm = (y - y_mean) / y_std

    input_dim = X.shape[1]
    print(f"  Input dim: {input_dim} ({EMBED_DIM} state + {EMBED_DIM} action)")
    print(f"  Target range: [{y.min():.4f}, {y.max():.4f}] (mean={y_mean:.4f})")
    print()

    # Train/val split (90/10)
    n = len(X)
    indices = np.random.permutation(n)
    split = int(n * 0.9)
    train_idx, val_idx = indices[:split], indices[split:]

    X_train, y_train = X[train_idx], y_norm[train_idx]
    X_val, y_val = X[val_idx], y_norm[val_idx]

    model = PolicyHead(input_dim=input_dim)
    best_val_loss = float("inf")
    best_epoch = 0

    for epoch in range(epochs):
        # Shuffle training data
        perm = np.random.permutation(len(X_train))
        X_train = X_train[perm]
        y_train = y_train[perm]

        epoch_loss = 0.0
        n_batches = 0

        for i in range(0, len(X_train), batch_size):
            X_batch = X_train[i : i + batch_size]
            y_batch = y_train[i : i + batch_size]

            pred, cache = model.forward(X_batch)
            loss = float(((pred - y_batch) ** 2).mean())
            if np.isnan(loss) or np.isinf(loss):
                continue
            epoch_loss += loss
            n_batches += 1

            grads = model.backward(pred, y_batch, cache)
            model.adam_step(grads, lr=lr)

        avg_loss = epoch_loss / max(n_batches, 1)

        # Validation
        val_pred, _ = model.forward(X_val)
        val_loss = ((val_pred - y_val) ** 2).mean()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch + 1

        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(
                f"  Epoch {epoch+1:3d}/{epochs}: "
                f"train_loss={avg_loss:.6f}  val_loss={val_loss:.6f}"
                f"{'  ★ best' if epoch + 1 == best_epoch else ''}"
            )

    # Final metrics
    all_pred, _ = model.forward(X)
    all_pred_denorm = all_pred * y_std + y_mean
    mse = ((all_pred_denorm - y) ** 2).mean()

    # Direction accuracy: did we predict positive/negative correctly?
    pred_dir = (all_pred_denorm > 0).flatten()
    actual_dir = (y > 0).flatten()
    direction_acc = (pred_dir == actual_dir).mean()

    # Rank correlation (Spearman) — implemented without scipy
    def spearman_corr(x: np.ndarray, y: np.ndarray) -> float:
        n = len(x)
        if n < 3:
            return 0.0
        rank_x = np.argsort(np.argsort(x))
        rank_y = np.argsort(np.argsort(y))
        d = rank_x - rank_y
        return float(1 - 6 * np.sum(d**2) / (n * (n**2 - 1)))

    try:
        rank_corr = spearman_corr(all_pred_denorm.flatten(), y.flatten())
    except Exception:
        rank_corr = 0.0

    print(f"\n  Final MSE: {mse:.6f}")
    print(f"  Direction accuracy: {direction_acc:.1%}")
    print(f"  Rank correlation: {rank_corr:.4f}")
    print(f"  Best epoch: {best_epoch}")

    metadata = {
        "trained_on": len(entries),
        "train_size": len(X_train),
        "val_size": len(X_val),
        "epochs": epochs,
        "learning_rate": lr,
        "best_epoch": best_epoch,
        "final_mse": float(mse),
        "direction_accuracy": float(direction_acc),
        "rank_correlation": float(rank_corr),
        "target_mean": float(y_mean),
        "target_std": float(y_std),
    }

    return model, metadata


def main():
    parser = argparse.ArgumentParser(description="Train policy head from training buffer")
    parser.add_argument("--buffer", default=".jfl/training-buffer.jsonl", help="Training buffer path")
    parser.add_argument("--output", default=".jfl/policy-weights.json", help="Output weights path")
    parser.add_argument("--cache", default=".jfl/policy-embeddings.json", help="Embeddings cache path")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    args = parser.parse_args()

    if not STRATUS_API_KEY:
        print("Error: STRATUS_API_KEY not set", file=sys.stderr)
        print("  export STRATUS_API_KEY=stratus_sk_live_...", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.buffer):
        print(f"Error: Training buffer not found: {args.buffer}", file=sys.stderr)
        print("  Run: jfl eval mine --all --telemetry", file=sys.stderr)
        sys.exit(1)

    entries = load_buffer(args.buffer)
    if len(entries) < 10:
        print(f"Error: Need at least 10 tuples, got {len(entries)}", file=sys.stderr)
        sys.exit(1)

    print(f"\n  Policy Head Trainer")
    print(f"  {'─' * 40}")
    print(f"  Buffer: {args.buffer} ({len(entries)} tuples)")
    print(f"  Epochs: {args.epochs}, LR: {args.lr}, Batch: {args.batch_size}")
    print(f"  Stratus: {STRATUS_URL}")

    model, metadata = train(
        entries,
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        cache_path=args.cache,
    )

    model.save(args.output, metadata)
    size_kb = os.path.getsize(args.output) / 1024
    print(f"\n  Saved: {args.output} ({size_kb:.0f}KB)")
    print(f"  Direction accuracy: {metadata['direction_accuracy']:.1%}")
    print(f"  Rank correlation: {metadata['rank_correlation']:.4f}")
    print()


if __name__ == "__main__":
    main()

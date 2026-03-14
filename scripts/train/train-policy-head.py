#!/usr/bin/env python3
"""
Policy head trainer for JFL RL agents.

Trains a 3-layer MLP to predict reward from (state, action) embeddings.
Matches PolicyWeights JSON format consumed by policy-head.ts inference.

Architecture (per Andrew @ Stratus, 2026-03-13 call):
  Input: concat(state_emb, action_emb) = 2 * embed_dim
  Layer 1: Linear(input_dim, 512) + ReLU
  Layer 2: Linear(512, 512) + ReLU + LayerNorm + Dropout
  Layer 3: Linear(512, 1)

Usage:
  python train-policy-head.py --data /path/to/.jfl/training-buffer.jsonl
  python train-policy-head.py --embeddings /path/to/embeddings.npz --rewards /path/to/rewards.npy
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, random_split


class PolicyHead(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(hidden_dim),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, 1),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


def get_embeddings_from_stratus(texts: list[str], api_key: str, api_url: str) -> np.ndarray:
    """Batch-embed texts via Stratus /v1/embeddings endpoint."""
    import requests

    embeddings = []
    batch_size = 32

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp = requests.post(
            f"{api_url}/v1/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": "stratus-x1ac-base", "input": batch},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        for item in data["data"]:
            embeddings.append(item["embedding"])

        if i > 0 and i % 100 == 0:
            print(f"  Embedded {i}/{len(texts)} texts...")

    return np.array(embeddings, dtype=np.float32)


def load_training_data(jsonl_path: str, reward_clip: float = 1.0) -> tuple[list[str], list[str], np.ndarray]:
    """Load training buffer JSONL, return (state_texts, action_texts, rewards).

    Applies data quality filtering:
    - Clips rewards to [-reward_clip, reward_clip] (default ±1.0)
    - Drops entries with zero reward (no learning signal)
    - Drops entries with missing state/action data
    """
    state_texts = []
    action_texts = []
    rewards = []
    skipped_zero = 0
    skipped_outlier = 0
    skipped_missing = 0

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            state = entry.get("state", {})
            action = entry.get("action", {})
            reward = entry.get("reward", {})

            dims = state.get("dimension_scores", {})
            dims_str = ", ".join(f"{k}={v:.4f}" for k, v in dims.items()) if dims else "none"
            deltas = state.get("recent_deltas", [])
            deltas_str = ", ".join(f"{d:+.4f}" for d in deltas) if deltas else "none"

            state_text = "\n".join([
                f"Agent: {state.get('agent', 'unknown')}",
                f"Composite: {state.get('composite_score', 0):.4f}",
                f"Tests: {state.get('tests_passing', 0)}/{state.get('tests_total', 0)}",
                f"Trajectory: {state.get('trajectory_length', 0)}",
                f"Dimensions: {dims_str}",
                f"Recent deltas: {deltas_str}",
            ])

            files = action.get("files_affected", [])[:5]
            action_text = "\n".join([
                f"Type: {action.get('type', 'unknown')}",
                f"Description: {action.get('description', '')[:150]}",
                f"Scope: {action.get('scope', 'unknown')}",
                f"Files: {', '.join(files) if files else 'none'}",
            ])

            composite_delta = reward.get("composite_delta", 0.0)

            if not action.get("description") or not state.get("agent"):
                skipped_missing += 1
                continue

            if composite_delta == 0.0:
                skipped_zero += 1
                continue

            if abs(composite_delta) > reward_clip:
                skipped_outlier += 1
                composite_delta = max(-reward_clip, min(reward_clip, composite_delta))

            state_texts.append(state_text)
            action_texts.append(action_text)
            rewards.append(composite_delta)

    total_raw = len(state_texts) + skipped_zero + skipped_outlier + skipped_missing
    print(f"  Data quality filter (reward_clip=±{reward_clip}):")
    print(f"    Raw entries:      {total_raw}")
    print(f"    Kept:             {len(state_texts)}")
    print(f"    Skipped (zero):   {skipped_zero}")
    print(f"    Clipped (outlier):{skipped_outlier}")
    print(f"    Skipped (missing):{skipped_missing}")

    return state_texts, action_texts, np.array(rewards, dtype=np.float32)


def compute_metrics(predictions: np.ndarray, targets: np.ndarray) -> dict:
    """Compute direction accuracy and rank correlation."""
    direction_correct = np.sum(np.sign(predictions) == np.sign(targets))
    direction_accuracy = direction_correct / len(targets) if len(targets) > 0 else 0.0

    from scipy.stats import spearmanr
    try:
        rank_corr, _ = spearmanr(predictions, targets)
        if np.isnan(rank_corr):
            rank_corr = 0.0
    except Exception:
        rank_corr = 0.0

    return {
        "direction_accuracy": float(direction_accuracy),
        "rank_correlation": float(rank_corr),
        "mse": float(np.mean((predictions - targets) ** 2)),
        "mae": float(np.mean(np.abs(predictions - targets))),
    }


def export_weights(model: PolicyHead, embed_dim: int, target_mean: float, target_std: float,
                   train_size: int, metrics: dict, output_path: str):
    """Export model weights to PolicyWeights JSON format for policy-head.ts inference."""
    state_dict = model.state_dict()

    def to_list(tensor):
        return tensor.cpu().detach().numpy().tolist()

    weights = {
        "version": 1,
        "architecture": "mlp-3layer-512h",
        "embed_dim": embed_dim,
        "mode": "embedding",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "trained_on": train_size,
        "direction_accuracy": metrics["direction_accuracy"],
        "rank_correlation": metrics["rank_correlation"],
        "target_mean": float(target_mean),
        "target_std": float(target_std),
        "layers": {
            "W1": to_list(state_dict["net.0.weight"].T),
            "b1": to_list(state_dict["net.0.bias"]),
            "W2": to_list(state_dict["net.2.weight"].T),
            "b2": to_list(state_dict["net.2.bias"]),
            "W3": to_list(state_dict["net.6.weight"].T),
            "b3": to_list(state_dict["net.6.bias"]),
        },
    }

    with open(output_path, "w") as f:
        json.dump(weights, f, indent=2)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n  Exported weights to {output_path} ({size_mb:.1f} MB)")
    print(f"  Direction accuracy: {metrics['direction_accuracy']:.3f}")
    print(f"  Rank correlation: {metrics['rank_correlation']:.3f}")


def train(args):
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"\n  Device: {device}")

    # Load data
    if args.embeddings and args.rewards:
        print(f"  Loading pre-computed embeddings from {args.embeddings}")
        data = np.load(args.embeddings)
        state_embs = data["state_embeddings"]
        action_embs = data["action_embeddings"]
        rewards = np.load(args.rewards)
    else:
        print(f"  Loading training data from {args.data}")
        state_texts, action_texts, rewards = load_training_data(args.data, reward_clip=args.reward_clip)
        print(f"  Loaded {len(rewards)} usable entries")

        if len(rewards) < args.min_entries:
            print(f"\n  Not enough data: {len(rewards)} < {args.min_entries} minimum")
            print(f"  Need {args.min_entries - len(rewards)} more training entries")
            sys.exit(1)

        api_key = args.api_key or os.environ.get("STRATUS_API_KEY")
        api_url = args.api_url or os.environ.get("STRATUS_API_URL", "https://api.stratus.run")

        if not api_key:
            dotenv_path = Path(args.data).parent.parent / ".env"
            if dotenv_path.exists():
                for line in dotenv_path.read_text().splitlines():
                    if line.startswith("STRATUS_API_KEY="):
                        api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

        if not api_key:
            print("\n  STRATUS_API_KEY not set. Cannot compute embeddings.")
            print("  Either set the env var or use --embeddings with pre-computed data.")
            sys.exit(1)

        # Check for cached embeddings
        cache_dir = Path(args.data).parent / "train-cache"
        cache_dir.mkdir(exist_ok=True)
        cache_path = cache_dir / f"embeddings-{len(rewards)}.npz"

        if cache_path.exists() and not args.force_embed:
            print(f"  Loading cached embeddings from {cache_path}")
            cached = np.load(cache_path)
            state_embs = cached["state_embeddings"]
            action_embs = cached["action_embeddings"]
        else:
            print(f"  Computing embeddings for {len(state_texts)} entries...")
            state_embs = get_embeddings_from_stratus(state_texts, api_key, api_url)
            action_embs = get_embeddings_from_stratus(action_texts, api_key, api_url)
            np.savez(cache_path, state_embeddings=state_embs, action_embeddings=action_embs)
            print(f"  Cached embeddings to {cache_path}")

    embed_dim = state_embs.shape[1]
    input_dim = embed_dim * 2
    print(f"  Embedding dim: {embed_dim}, Input dim: {input_dim}")
    print(f"  Entries: {len(rewards)}, Reward range: [{rewards.min():.4f}, {rewards.max():.4f}]")

    # Normalize targets
    target_mean = float(rewards.mean())
    target_std = float(rewards.std()) if rewards.std() > 1e-8 else 1.0
    normalized_rewards = (rewards - target_mean) / target_std

    # Build tensors
    X = np.concatenate([state_embs, action_embs], axis=1)
    X_tensor = torch.tensor(X, dtype=torch.float32)
    y_tensor = torch.tensor(normalized_rewards, dtype=torch.float32)

    dataset = TensorDataset(X_tensor, y_tensor)

    # 70/30 split
    val_size = max(1, int(len(dataset) * args.val_ratio))
    train_size = len(dataset) - val_size
    train_dataset, val_dataset = random_split(
        dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(args.seed)
    )

    print(f"  Train: {train_size}, Val: {val_size}")

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size)

    # Build model
    model = PolicyHead(input_dim, hidden_dim=args.hidden_dim).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    print(f"  Model parameters: {param_count:,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    # Warmup + cosine schedule
    warmup_steps = args.warmup_epochs * len(train_loader)
    total_steps = args.epochs * len(train_loader)

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1.0 + np.cos(np.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    criterion = nn.MSELoss()

    # Training loop
    best_val_loss = float("inf")
    best_epoch = 0
    best_state = None
    patience_counter = 0

    print(f"\n  Training for up to {args.epochs} epochs (patience: {args.patience})...\n")

    for epoch in range(args.epochs):
        model.train()
        train_loss = 0.0
        train_batches = 0

        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            pred = model(X_batch)
            loss = criterion(pred, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            train_loss += loss.item()
            train_batches += 1

        avg_train_loss = train_loss / max(1, train_batches)

        # Validation
        model.eval()
        val_loss = 0.0
        val_batches = 0
        val_preds = []
        val_targets = []

        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                pred = model(X_batch)
                loss = criterion(pred, y_batch)
                val_loss += loss.item()
                val_batches += 1
                val_preds.extend(pred.cpu().numpy())
                val_targets.extend(y_batch.cpu().numpy())

        avg_val_loss = val_loss / max(1, val_batches)

        # Denormalize for metrics
        val_preds_denorm = np.array(val_preds) * target_std + target_mean
        val_targets_denorm = np.array(val_targets) * target_std + target_mean

        if (epoch + 1) % max(1, args.epochs // 20) == 0 or epoch == 0:
            metrics = compute_metrics(val_preds_denorm, val_targets_denorm)
            lr = optimizer.param_groups[0]["lr"]
            print(f"  Epoch {epoch+1:4d}  train_loss={avg_train_loss:.6f}  val_loss={avg_val_loss:.6f}  "
                  f"dir_acc={metrics['direction_accuracy']:.3f}  rank_corr={metrics['rank_correlation']:.3f}  "
                  f"lr={lr:.2e}")

        # Early stopping
        if avg_val_loss < best_val_loss - args.min_delta:
            best_val_loss = avg_val_loss
            best_epoch = epoch + 1
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"\n  Early stopping at epoch {epoch+1} (best: {best_epoch})")
                break

    # Load best checkpoint
    if best_state:
        model.load_state_dict(best_state)
        model.to(device)

    # Final metrics on full val set
    model.eval()
    all_preds = []
    all_targets = []
    with torch.no_grad():
        for X_batch, y_batch in val_loader:
            X_batch = X_batch.to(device)
            pred = model(X_batch)
            all_preds.extend(pred.cpu().numpy())
            all_targets.extend(y_batch.numpy())

    final_preds = np.array(all_preds) * target_std + target_mean
    final_targets = np.array(all_targets) * target_std + target_mean
    final_metrics = compute_metrics(final_preds, final_targets)

    print(f"\n  Final metrics (best epoch {best_epoch}):")
    print(f"    Direction accuracy: {final_metrics['direction_accuracy']:.3f}")
    print(f"    Rank correlation:   {final_metrics['rank_correlation']:.3f}")
    print(f"    MSE:                {final_metrics['mse']:.6f}")
    print(f"    MAE:                {final_metrics['mae']:.6f}")

    # Export
    export_weights(model, embed_dim, target_mean, target_std, len(rewards), final_metrics, args.output)

    # Also save training metadata
    meta_path = args.output.replace("policy-weights.json", "training-meta.json")
    meta = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "data_source": str(args.data) if args.data else "pre-computed",
        "entries": int(len(rewards)),
        "train_size": train_size,
        "val_size": val_size,
        "embed_dim": embed_dim,
        "hidden_dim": args.hidden_dim,
        "epochs_run": min(epoch + 1, args.epochs),
        "best_epoch": best_epoch,
        "best_val_loss": float(best_val_loss),
        "lr": args.lr,
        "batch_size": args.batch_size,
        "dropout": 0.1,
        "weight_decay": args.weight_decay,
        "device": device,
        "param_count": param_count,
        "metrics": final_metrics,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  Training metadata saved to {meta_path}")


def main():
    parser = argparse.ArgumentParser(description="Train JFL policy head")
    parser.add_argument("--data", type=str, help="Path to training-buffer.jsonl")
    parser.add_argument("--embeddings", type=str, help="Path to pre-computed embeddings .npz")
    parser.add_argument("--rewards", type=str, help="Path to rewards .npy (with --embeddings)")
    parser.add_argument("--output", type=str, default=".jfl/policy-weights.json",
                        help="Output path for policy weights JSON")
    parser.add_argument("--api-key", type=str, help="Stratus API key (or STRATUS_API_KEY env)")
    parser.add_argument("--api-url", type=str, default="https://api.stratus.run",
                        help="Stratus API URL")
    parser.add_argument("--epochs", type=int, default=500, help="Max training epochs")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate")
    parser.add_argument("--hidden-dim", type=int, default=512, help="Hidden layer dimension")
    parser.add_argument("--weight-decay", type=float, default=0.01, help="Weight decay")
    parser.add_argument("--patience", type=int, default=30, help="Early stopping patience")
    parser.add_argument("--min-delta", type=float, default=1e-5, help="Min improvement for early stop")
    parser.add_argument("--warmup-epochs", type=int, default=10, help="LR warmup epochs")
    parser.add_argument("--val-ratio", type=float, default=0.3, help="Validation split ratio")
    parser.add_argument("--min-entries", type=int, default=50, help="Minimum entries to train")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--reward-clip", type=float, default=1.0, help="Clip rewards to ±this value (default: 1.0)")
    parser.add_argument("--force-embed", action="store_true", help="Force re-computation of embeddings")
    args = parser.parse_args()

    if not args.data and not args.embeddings:
        parser.error("Either --data or --embeddings is required")

    train(args)


if __name__ == "__main__":
    main()

import { api, RLAgentConfig, RLSession } from "@/api"
import { usePolling, cn, timeAgo } from "@/lib/hooks"

export default function Experiments() {
  const agents = usePolling(() => api.rlAgents().then(r => r.agents), [], 15000)
  const sessions = usePolling(() => api.rlSessions().then(r => r.sessions), [], 10000)
  const context = usePolling(() => api.productContext(), { context: null, updatedAt: null }, 30000)

  // Group sessions by agent
  const sessionsByAgent: Record<string, RLSession[]> = {}
  for (const s of sessions) {
    if (!sessionsByAgent[s.agent]) sessionsByAgent[s.agent] = []
    sessionsByAgent[s.agent].push(s)
  }

  return (
    <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#e0e0e0" }}>
        ⚡ Autoresearch
      </h1>
      <p style={{ color: "#888", marginBottom: 24, fontSize: 14 }}>
        Scoped RL agents optimizing your services. Branches grow overnight, you review in the morning.
      </p>

      {/* Agent Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16, marginBottom: 32 }}>
        {agents.map((agent: RLAgentConfig) => {
          const agentSessions = sessionsByAgent[agent.name] || []
          const allRounds = agentSessions.flatMap(s => s.rounds)
          const keptRounds = allRounds.filter(r => r.kept)
          const lastSession = agentSessions[agentSessions.length - 1]
          const lastRound = lastSession?.rounds[lastSession.rounds.length - 1]

          // Calculate best metric
          const bestDelta = keptRounds.length > 0
            ? Math.max(...keptRounds.map(r => Math.abs(r.delta)))
            : 0

          return (
            <div key={agent.name} style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a4a",
              borderRadius: 8,
              padding: 16,
              borderLeft: keptRounds.length > 0 ? "3px solid #4ade80" : "3px solid #444",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0" }}>{agent.name}</h3>
                <span style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: agent.direction === "minimize" ? "#1e3a2e" : "#2e1e3a",
                  color: agent.direction === "minimize" ? "#4ade80" : "#a78bfa",
                }}>
                  {agent.direction === "minimize" ? "↓" : "↑"} {agent.metric}
                </span>
              </div>

              <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                {agent.target_repo ? `→ ${agent.target_repo}` : "self"} · {agent.constraints.files_in_scope.length} scope patterns
              </div>

              {/* Metric Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#e0e0e0" }}>{allRounds.length}</div>
                  <div style={{ fontSize: 10, color: "#666" }}>rounds</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: keptRounds.length > 0 ? "#4ade80" : "#666" }}>{keptRounds.length}</div>
                  <div style={{ fontSize: 10, color: "#666" }}>kept</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: bestDelta > 0 ? "#4ade80" : "#666" }}>
                    {bestDelta > 0 ? bestDelta.toFixed(0) : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "#666" }}>best Δ</div>
                </div>
              </div>

              {/* Round History (mini chart) */}
              {allRounds.length > 0 && (
                <div style={{ display: "flex", gap: 2, height: 24, alignItems: "flex-end", marginBottom: 8 }}>
                  {allRounds.slice(-15).map((r, i) => (
                    <div key={i} style={{
                      flex: 1,
                      height: r.kept ? "100%" : "40%",
                      background: r.kept ? "#4ade80" : "#ef4444",
                      borderRadius: 2,
                      opacity: 0.7,
                      minWidth: 4,
                    }} title={`R${r.round}: ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)} ${r.kept ? "KEPT" : "REVERTED"}`} />
                  ))}
                </div>
              )}

              {/* Last activity */}
              {lastRound && (
                <div style={{ fontSize: 11, color: "#666", borderTop: "1px solid #2a2a4a", paddingTop: 8 }}>
                  Last: {lastRound.metric.toFixed(1)} ({lastRound.delta > 0 ? "+" : ""}{lastRound.delta.toFixed(1)})
                  {lastRound.kept ? " ✓" : " ✗"}
                  {lastRound.timestamp && ` · ${timeAgo(lastRound.timestamp)}`}
                </div>
              )}

              {allRounds.length === 0 && (
                <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>No experiments yet</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Product Context */}
      {context.context && (
        <div style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a4a",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0" }}>🧠 Product Context</h2>
            <span style={{ fontSize: 11, color: "#666" }}>
              {context.updatedAt && timeAgo(context.updatedAt)}
            </span>
          </div>
          <pre style={{
            fontSize: 12,
            color: "#aaa",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
            maxHeight: 300,
            overflow: "auto",
          }}>
            {context.context.replace(/^# Product Context\n\n_Synthesized.*?\n\n/, "")}
          </pre>
        </div>
      )}

      {/* Session Detail */}
      {sessions.length > 0 && (
        <div style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a4a",
          borderRadius: 8,
          padding: 16,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0", marginBottom: 12 }}>📋 Recent Sessions</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2a2a4a", color: "#888" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Agent</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Rounds</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Kept</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Best Δ</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Results</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(-10).reverse().map((s: RLSession) => {
                  const kept = s.rounds.filter(r => r.kept)
                  const best = kept.length > 0 ? Math.max(...kept.map(r => Math.abs(r.delta))) : 0
                  return (
                    <tr key={s.id} style={{ borderBottom: "1px solid #1e1e3e" }}>
                      <td style={{ padding: "8px", color: "#e0e0e0" }}>{s.agent}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#888" }}>{s.rounds.length}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: kept.length > 0 ? "#4ade80" : "#666" }}>{kept.length}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: best > 0 ? "#4ade80" : "#666" }}>
                        {best > 0 ? best.toFixed(1) : "—"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <div style={{ display: "flex", gap: 3 }}>
                          {s.rounds.map((r, i) => (
                            <span key={i} style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: r.kept ? "#4ade80" : "#ef4444",
                            }} title={`R${r.round}: ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}`} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

import type { LogLine } from "../types";

export function ActivityView({ logs }: { logs: LogLine[] }) {
  const filtered = logs.filter(l => l.kind !== "heartbeat");
  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)", background: "var(--card)",
                    display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{filtered.length} events</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
        {filtered.length === 0 && (
          <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "20px 0" }}>
            No activity yet. Run news refresh, generate an insight, or propose a portfolio.
          </div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
          {logs.map(l => (
            <div key={l.id} style={{
              display: "flex", gap: 8, padding: "3px 0",
              borderBottom: "1px solid var(--line-lo)",
              color: l.kind === "heartbeat" ? "var(--ink-4)"
                : l.kind === "agent" ? "var(--ink)" : "var(--ink-2)",
            }}>
              <span style={{ color: "var(--ink-4)", minWidth: 60, fontSize: 10.5 }}>{l.ts}</span>
              <span style={{
                fontSize: 9.5, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                background: l.kind === "agent" ? "var(--blue-soft)" : "var(--paper-3)",
                color: l.kind === "agent" ? "var(--blue-ink)" : "var(--ink-3)",
              }}>{l.src}</span>
              <span style={{ flex: 1 }}>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

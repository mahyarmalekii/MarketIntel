import { useEffect, useState } from "react";
import type { ApiFetch } from "../types";
import Icon from "../components/Icon";

export function AnthropicAgentsView({ api }: { api: ApiFetch }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/v1/anthropic/agents")
      .then((r) => r.json())
      .then((data) => {
        setAgents(data);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, [api]);

  return (
    <div className="p-view">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2>Anthropic Financial Agents</h2>
          <div className="subtitle" style={{ marginTop: 4 }}>
            Reference agents from the anthropics/financial-services repository.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="col gap-3" style={{ opacity: 0.5 }}>
          <div className="spinner" />
          <div>Loading agents...</div>
        </div>
      ) : agents.length === 0 ? (
        <div className="card text-center" style={{ padding: 40, color: "var(--ink-2)" }}>
          <Icon name="spark" size={32} style={{ margin: "0 auto 12px auto", opacity: 0.4 }} />
          <div>No Anthropic agents found. Ensure the financial-services repository is cloned into the backend.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {agents.map((agent) => (
            <div key={agent.id} className="card col gap-3" style={{ padding: 16 }}>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <div className="nav-icon" style={{ background: "var(--purple)", color: "var(--purple-ink)" }}>
                  <Icon name="spark" size={14} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{agent.name}</div>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {agent.description}
              </div>
              <div className="row gap-2" style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <button className="btn btn-outline" style={{ flex: 1 }}>View Details</button>
                <button className="btn btn-primary" style={{ flex: 1 }}>Run Agent</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

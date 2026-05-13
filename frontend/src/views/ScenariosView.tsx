import { useCallback, useEffect, useState } from "react";
import type { ApiFetch, Scenario } from "../types";
import { getJson } from "../api";
import Icon from "../components/Icon";

const PRESETS = [
  { name: "Bull Market",       description: "Strong economic growth, rising corporate earnings, low unemployment, Fed rate cuts." },
  { name: "Bear Market",       description: "Economic contraction, falling earnings, high unemployment, rate hikes to combat inflation." },
  { name: "Recession",         description: "Two consecutive quarters of negative GDP growth, credit tightening, high unemployment." },
  { name: "Interest Rate Hike", description: "Central banks raise rates aggressively (+200bps over 12 months) to combat elevated inflation." },
  { name: "Oil Price Shock",   description: "Crude oil spikes to $150/bbl due to geopolitical supply disruption." },
  { name: "Tech Bubble Burst", description: "Valuation correction in technology sector — P/E multiples compress 40%, growth stocks hit hardest." },
  { name: "Geopolitical Crisis", description: "Major regional conflict disrupts trade routes, supply chains, and risk sentiment globally." },
  { name: "Soft Landing",      description: "Inflation returns to target, rates fall slowly, GDP growth moderates but remains positive." },
];

export function ScenariosView({ api }: { api: ApiFetch }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<Scenario & { per_stock?: any[]; summary?: string } | null>(null);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await getJson<Scenario[]>(api, "/api/v1/scenarios");
      setScenarios(data);
    } catch { /* surface via empty-state UI */ }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.data) {
        setLiveResult(d.data);
        setRunning(null);
        load();
      } else if (d?.event?.includes("error")) {
        setRunning(null);
      }
    };
    window.addEventListener("scenario-done", h);
    return () => window.removeEventListener("scenario-done", h);
  }, [load]);

  const run = async (name: string, description: string) => {
    setRunning(name);
    setLiveResult(null);
    await api("/api/v1/scenarios/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
  };

  const deleteScenario = async (id: string) => {
    await api(`/api/v1/scenarios/${id}`, { method: "DELETE" });
    load();
  };

  const impactColor = (v: number | null) => {
    if (v == null) return "var(--ink-3)";
    return v >= 0 ? "var(--ok)" : "var(--bad)";
  };

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Preset scenarios */}
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Preset Scenarios</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {PRESETS.map(p => (
              <button key={p.name}
                      disabled={running !== null}
                      onClick={() => run(p.name, p.description)}
                      style={{
                        background: running === p.name ? "var(--blue-soft)" : "var(--paper-2)",
                        border: `1px solid ${running === p.name ? "var(--blue)" : "var(--line)"}`,
                        borderRadius: 10, padding: "12px 14px", textAlign: "left",
                        cursor: "pointer", transition: "border-color 0.15s",
                      }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  {running === p.name ? <><span className="spinner" style={{ width: 10, height: 10, display: "inline-block", marginRight: 6 }} />Running…</> : p.name}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {p.description.slice(0, 80)}…
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom scenario */}
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Custom Scenario</div>
          <div className="col gap-2">
            <input className="input" placeholder="Scenario name" value={customName}
                   onChange={e => setCustomName(e.target.value)} />
            <textarea className="input" placeholder="Describe the macro environment in detail…"
                      value={customDesc} onChange={e => setCustomDesc(e.target.value)}
                      style={{ height: 80, resize: "vertical" }} />
            <div>
              <button className="btn" disabled={!customName || running !== null}
                      onClick={() => run(customName, customDesc)}>
                <Icon name="spark" size={13} /> Run Scenario
              </button>
            </div>
          </div>
        </div>

        {/* Live result */}
        {liveResult && (
          <div className="card" style={{ padding: 22, border: "2px solid var(--blue)" }}>
            <div className="row gap-3" style={{ marginBottom: 14, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{liveResult.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{liveResult.assumptions}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: impactColor(liveResult.portfolio_impact) }}>
                  {liveResult.portfolio_impact != null
                    ? `${liveResult.portfolio_impact >= 0 ? "+" : ""}${liveResult.portfolio_impact.toFixed(1)}%`
                    : "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>portfolio impact</div>
              </div>
            </div>

            {liveResult.summary && (
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)", marginBottom: 14 }}>{liveResult.summary}</p>
            )}

            {(liveResult as any).news_catalysts && (
              <div style={{ marginBottom: 12, padding: 12, background: "rgba(91,140,68,0.08)", borderRadius: 8, border: "1px solid var(--green)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--green)", textTransform: "uppercase", marginBottom: 4 }}>News Catalysts</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{(liveResult as any).news_catalysts}</div>
              </div>
            )}

            {liveResult.affected_sectors?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 6 }}>Affected Sectors</div>
                <div className="row gap-1" style={{ flexWrap: "wrap" }}>
                  {liveResult.affected_sectors.map((s: string) => (
                    <span key={s} className="pill">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {(liveResult as any).sector_rotation && (
              <div style={{ marginBottom: 12, padding: 12, background: "var(--paper-2)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--blue)", textTransform: "uppercase", marginBottom: 4 }}>Sector Rotation</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{(liveResult as any).sector_rotation}</div>
              </div>
            )}

            {(liveResult as any).hedge_recommendations && (
              <div style={{ marginBottom: 12, padding: 12, background: "var(--bad-soft)", borderRadius: 8, border: "1px solid var(--bad)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--bad)", textTransform: "uppercase", marginBottom: 4 }}>Hedge Recommendations</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{(liveResult as any).hedge_recommendations}</div>
              </div>
            )}

            {liveResult.per_stock && liveResult.per_stock.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 8 }}>Per-Stock Impact & Peer Comparison</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>
                  {liveResult.per_stock.map((s: any) => (
                    <div key={s.ticker} style={{ background: "var(--paper-2)", borderRadius: 8, padding: "10px 12px" }}>
                      <div className="row gap-2" style={{ marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.ticker}</span>
                        <span style={{ fontWeight: 700, fontSize: 12, color: impactColor(s.impact_pct), marginLeft: "auto" }}>
                          {s.impact_pct >= 0 ? "+" : ""}{s.impact_pct?.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{s.reasoning}</div>
                      {s.news_link && (
                        <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 4 }}>
                          News: {s.news_link}
                        </div>
                      )}
                      {s.peer_comparison && (
                        <div style={{ fontSize: 10.5, color: "var(--blue)", marginTop: 4, fontStyle: "italic" }}>
                          Peers: {s.peer_comparison}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saved scenarios */}
        {scenarios.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Saved Scenarios</div>
            <div className="col gap-2">
              {scenarios.map(sc => (
                <div key={sc.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <div className="row gap-3" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{sc.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                        {sc.created_at?.slice(0, 10)} · {sc.affected_sectors?.join(", ") || "—"}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: impactColor(sc.portfolio_impact) }}>
                      {sc.portfolio_impact != null
                        ? `${sc.portfolio_impact >= 0 ? "+" : ""}${sc.portfolio_impact.toFixed(1)}%`
                        : "—"}
                    </div>
                    <button className="btn btn-icon btn-sm" onClick={() => deleteScenario(sc.id)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  {sc.assumptions && (
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>{sc.assumptions}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { ApiFetch, Holding, PortfolioSummary } from "../types";
import { getJson } from "../api";
import Icon from "../components/Icon";
import { AIProposals } from "../components/AIProposals";

export function PortfolioView({ api }: { api: ApiFetch }) {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("MI_proposed");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [showProposeConfig, setShowProposeConfig] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avg_cost: "", region: "US", currency: "USD", notes: "" });
  const [proposeConfig, setProposeConfig] = useState({ budget: "10000", currency: "USD", industries: "" });

  useEffect(() => {
    localStorage.setItem("MI_proposed", JSON.stringify(proposed));
  }, [proposed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await getJson<PortfolioSummary>(api, "/api/v1/portfolio");
      setPortfolio(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const addHolding = async () => {
    if (!form.ticker || !form.shares || !form.avg_cost) return;
    await api("/api/v1/portfolio/holding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, shares: Number(form.shares), avg_cost: Number(form.avg_cost) }),
    });
    setForm({ ticker: "", shares: "", avg_cost: "", region: "US", currency: "USD", notes: "" });
    setShowAdd(false);
    load();
  };

  const deleteHolding = async (id: string) => {
    await api(`/api/v1/portfolio/holding/${id}`, { method: "DELETE" });
    load();
  };

  const proposePortfolio = async (feedback?: string, previous_portfolio?: any[]) => {
    setProposing(true);
    if (!feedback) {
      setProposed([]);
    }
    await api("/api/v1/portfolio/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        regions: ["US", "EU", "UK"], 
        risk_level: "moderate", 
        include_penny: true, 
        budget: Number(proposeConfig.budget),
        currency: proposeConfig.currency,
        industries: proposeConfig.industries,
        feedback,
        previous_portfolio
      }),
    });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.data && detail.data.length > 0) {
        setProposed(detail.data);
      } else if (detail?.event === "propose_error" || !detail?.data) {
        alert("AI Propose failed: " + (detail?.msg || "Unknown error. Check your LLM API key in Settings."));
      }
      setProposing(false);
      window.removeEventListener("propose-done", handler);
    };
    window.addEventListener("propose-done", handler);
    setTimeout(() => { setProposing(false); }, 90000);
  };

  const addProposed = async (p: any) => {
    await api("/api/v1/portfolio/holding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: p.ticker, shares: p.shares ?? 1,
        avg_cost: p.estimated_price ?? 0,
        region: p.region ?? "US",
      }),
    });
    load();
  };

  const pnl = portfolio?.total_pnl ?? 0;
  const pnlPct = portfolio?.total_pnl_pct ?? 0;

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Summary bar */}
        <div className="card" style={{ padding: 18, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div className="eyebrow">Total Value</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)" }}>
              ${(portfolio?.total_value ?? 0).toLocaleString("en", { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="eyebrow">Total P&L</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: pnl >= 0 ? "var(--ok)" : "var(--bad)" }}>
              {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toLocaleString("en", { maximumFractionDigits: 2 })}
              <span style={{ fontSize: 14, fontWeight: 500, marginLeft: 6 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
            </div>
          </div>
          <div>
            <div className="eyebrow">Positions</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{portfolio?.holdings.length ?? 0}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setShowAdd(s => !s)}>
              <Icon name="plus" size={14} /> Add Position
            </button>
            <button className="btn" onClick={() => { setShowAdd(false); setShowProposeConfig(s => !s); }}>
              <Icon name="spark" size={14} /> AI Propose
            </button>
            <button className="btn btn-icon" onClick={load} title="Refresh">
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Add Position</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
              {[
                { key: "ticker",   label: "Ticker",   placeholder: "AAPL" },
                { key: "shares",   label: "Shares",   placeholder: "10" },
                { key: "avg_cost", label: "Avg Cost", placeholder: "190.00" },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{f.label}</div>
                  <input className="input" placeholder={f.placeholder}
                         value={(form as any)[f.key]}
                         onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Region</div>
                <select className="input" value={form.region}
                        onChange={e => setForm(p => ({ ...p, region: e.target.value }))}>
                  <option value="US">US</option>
                  <option value="EU">EU</option>
                  <option value="UK">UK</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Currency</div>
                <select className="input" value={form.currency}
                        onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn" onClick={addHolding}>Add</button>
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Propose Config Form */}
        {showProposeConfig && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Junior Analyst Parameters</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Budget</div>
                <input className="input" type="number" placeholder="10000"
                       value={proposeConfig.budget}
                       onChange={e => setProposeConfig(p => ({ ...p, budget: e.target.value }))} />
              </div>
              <div style={{ width: 100 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Currency</div>
                <select className="input" value={proposeConfig.currency}
                        onChange={e => setProposeConfig(p => ({ ...p, currency: e.target.value }))}>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <div style={{ flex: 2, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Focus Industries (Optional)</div>
                <input className="input" placeholder="e.g. AI, Defense, Renewables"
                       value={proposeConfig.industries}
                       onChange={e => setProposeConfig(p => ({ ...p, industries: e.target.value }))} />
              </div>
              <button className="btn" 
                      style={{ background: "var(--primary-container)", color: "#000", borderColor: "var(--primary-container)", fontWeight: 700, padding: "0 24px", height: 38 }}
                      onClick={() => { setShowProposeConfig(false); proposePortfolio(); }} 
                      disabled={proposing}>
                {proposing ? "Running Pipeline..." : "Run Junior Analyst"}
              </button>
            </div>
          </div>
        )}

        {/* AI Proposed */}
        {proposed.length > 0 && (
          <AIProposals 
            proposals={proposed} 
            onDismiss={() => setProposed([])} 
            onAdd={addProposed}
            onConsult={(feedback) => proposePortfolio(feedback, proposed)}
          />
        )}

        {/* Holdings table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div className="eyebrow">Holdings</div>
          </div>
          {error ? (
            <div style={{ padding: 24, color: "var(--bad)", fontSize: 13 }}>{error}</div>
          ) : loading ? (
            <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
          ) : !portfolio?.holdings.length ? (
            <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>
              No positions yet. Click "Add Position" or let AI propose a portfolio.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--paper-2)" }}>
                    {["Ticker", "Name", "Region", "Shares", "Avg Cost", "Price", "Value", "P&L", "P&L %", "Cap", "Risk", ""].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600,
                                           fontSize: 11, color: "var(--ink-3)", borderBottom: "1px solid var(--line)",
                                           whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {portfolio.holdings.map(h => (
                    <HoldingRow key={h.id} holding={h} onDelete={deleteHolding} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function StockRiskBadge({ risk }: { risk: number | undefined }) {
  if (!risk) return <span style={{ color: "var(--ink-4)", fontSize: 11 }}>—</span>;
  const color =
    risk <= 3 ? "#00b894" :
    risk <= 5 ? "#fdcb6e" :
    risk <= 7 ? "#e17055" :
               "#d63031";
  const label =
    risk <= 3 ? "Low" :
    risk <= 5 ? "Med" :
    risk <= 7 ? "High" :
               "V.High";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%",
        background: color + "22", border: `2px solid ${color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 11, color, flexShrink: 0,
      }}>
        {risk}
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function HoldingRow({ holding: h, onDelete }: { holding: Holding; onDelete: (id: string) => void }) {
  const pnlPos = (h.pnl ?? 0) >= 0;
  return (
    <tr style={{ borderBottom: "1px solid var(--line)" }}>
      <td style={{ padding: "10px 12px", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{h.ticker}</td>
      <td style={{ padding: "10px 12px", color: "var(--ink-2)", maxWidth: 160,
                   overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name || "—"}</td>
      <td style={{ padding: "10px 12px" }}><span className="pill" style={{ fontSize: 10 }}>{h.region}</span></td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)" }}>{h.shares}</td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)" }}>${(h.avg_cost ?? 0).toFixed(2)}</td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)" }}>${(h.current_price ?? 0).toFixed(2)}</td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
        ${(h.current_value ?? 0).toLocaleString("en", { maximumFractionDigits: 2 })}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", color: pnlPos ? "var(--ok)" : "var(--bad)" }}>
        {pnlPos ? "+" : ""}${(h.pnl ?? 0).toFixed(2)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", color: pnlPos ? "var(--ok)" : "var(--bad)" }}>
        {(h.pnl_pct ?? 0) >= 0 ? "+" : ""}{(h.pnl_pct ?? 0).toFixed(2)}%
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span className="pill" style={{ fontSize: 10 }}>{h.market_cap_tier || "—"}</span>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <StockRiskBadge risk={h.risk} />
      </td>
      <td style={{ padding: "10px 12px" }}>
        <button className="btn btn-icon" onClick={() => onDelete(h.id)} title="Remove">
          <Icon name="trash" size={13} />
        </button>
      </td>
    </tr>
  );
}

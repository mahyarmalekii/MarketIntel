import { useCallback, useEffect, useState } from "react";
import type { ApiFetch, Insight, Stock } from "../types";
import { getJson } from "../api";
import { ActionBadge } from "./DashboardView";
import Icon from "../components/Icon";

const SCENARIOS = ["base", "bull", "bear"] as const;

export function ResearchView({ api, initialTicker }: { api: ApiFetch; initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker || "");
  const [scenario, setScenario] = useState<"base" | "bull" | "bear">("base");
  const [quote, setQuote] = useState<Stock | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [latestInsight, setLatestInsight] = useState<Insight & { bull_case?: string; bear_case?: string; key_risks?: string[]; conditional_strategy?: string } | null>(null);
  const [pennyStocks, setPennyStocks] = useState<Stock[]>([]);
  const [pennyRegion, setPennyRegion] = useState("US");
  const [loadingPenny, setLoadingPenny] = useState(false);
  const [scanRegion, setScanRegion] = useState("US");
  const [scanResults, setScanResults] = useState<Stock[]>([]);
  const [scanning, setScanning] = useState(false);

  const loadInsights = useCallback(async (t?: string) => {
    const url = t ? `/api/v1/insights?ticker=${t}` : "/api/v1/insights?limit=20";
    try {
      const data = await getJson<Insight[]>(api, url);
      setInsights(data);
    } catch { /* surface via the empty-state UI */ }
  }, [api]);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.data) {
        setLatestInsight(d.data);
        setGenerating(false);
        loadInsights(d.data.ticker);
      } else if (d?.event === "insight_error") {
        setGenerating(false);
      }
    };
    window.addEventListener("insight-done", h);
    return () => window.removeEventListener("insight-done", h);
  }, [loadInsights]);

  const lookupQuote = useCallback(async (t: string) => {
    if (!t) return;
    setQuoteLoading(true);
    setQuote(null);
    try {
      const q = await getJson<Stock>(api, `/api/v1/market/quote/${t.toUpperCase()}`);
      setQuote(q);
    } catch (e: unknown) {
      alert("Quote lookup failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setQuoteLoading(false);
    }
  }, [api]);

  const generate = useCallback(async (t: string, s: string) => {
    if (!t) return;
    setGenerating(true);
    setLatestInsight(null);
    await api("/api/v1/insights/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: t.toUpperCase(), scenario: s }),
    });
  }, [api]);

  useEffect(() => {
    if (initialTicker) {
      setTicker(initialTicker);
      lookupQuote(initialTicker);
      generate(initialTicker, "base");
    }
  }, [initialTicker, lookupQuote, generate]);


  const deleteInsight = async (id: string) => {
    await api(`/api/v1/insights/${id}`, { method: "DELETE" });
    loadInsights();
  };

  const loadPenny = async () => {
    setLoadingPenny(true);
    try {
      const data = await getJson<Stock[]>(api, `/api/v1/market/penny?region=${pennyRegion}`);
      setPennyStocks(data);
    } catch { setPennyStocks([]); }
    finally { setLoadingPenny(false); }
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const data = await getJson<Stock[]>(api, `/api/v1/market/scan?region=${scanRegion}`);
      setScanResults(data);
    } catch { setScanResults([]); }
    finally { setScanning(false); }
  };

  const runCrewAI = async () => {
    if (!ticker) return;
    await api("/api/v1/crewai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [ticker.toUpperCase()], task: "full_analysis" }),
    });
  };

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Analysis panel */}
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Stock Analysis</div>
          <div className="row gap-3" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Ticker</div>
              <input className="input" placeholder="e.g. AAPL, ASML.AS, BP.L"
                     value={ticker}
                     onChange={e => setTicker(e.target.value.toUpperCase())}
                     onKeyDown={e => e.key === "Enter" && lookupQuote(ticker)} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Scenario</div>
              <div className="row gap-1">
                {SCENARIOS.map(s => (
                  <button key={s} className="btn btn-sm"
                          onClick={() => setScenario(s)}
                          style={scenario === s ? { background: "var(--ink)", color: "var(--paper)" } : {}}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="row gap-2">
              <button className="btn" onClick={() => lookupQuote(ticker)} disabled={!ticker || quoteLoading}>
                <Icon name="search" size={13} /> {quoteLoading ? "Loading…" : "Look up"}
              </button>
              <button className="btn" onClick={() => generate(ticker, scenario)}
                      disabled={!ticker || generating}
                      style={{ background: "var(--ink)", color: "var(--paper)" }}>
                <Icon name="spark" size={13} /> {generating ? "Analysing…" : "AI Insight"}
              </button>
              <button className="btn" onClick={runCrewAI} disabled={!ticker} title="Run CrewAI multi-agent analysis">
                <Icon name="bolt" size={13} /> CrewAI
              </button>
            </div>
          </div>

          {/* Quote card */}
          {quote && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <div className="row gap-4" style={{ flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{quote.ticker}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{quote.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                    {quote.exchange} · {quote.sector} · <span className="pill" style={{ fontSize: 10 }}>{quote.market_cap_tier}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {quote.last_price != null ? `${quote.currency} ${quote.last_price.toFixed(2)}` : "N/A"}
                  </div>
                  {quote.prev_close && quote.last_price && (
                    <div style={{
                      fontSize: 13,
                      color: quote.last_price >= quote.prev_close ? "var(--ok)" : "var(--bad)",
                    }}>
                      {((quote.last_price - quote.prev_close) / quote.prev_close * 100).toFixed(2)}% from prev close
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", fontSize: 12 }}>
                  {[
                    ["P/E", quote.pe_ratio?.toFixed(1) ?? "—"],
                    ["Beta", quote.beta?.toFixed(2) ?? "—"],
                    ["52w High", quote["52w_high"]?.toFixed(2) ?? "—"],
                    ["52w Low", quote["52w_low"]?.toFixed(2) ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k}><span style={{ color: "var(--ink-3)" }}>{k}: </span><strong>{v}</strong></div>
                  ))}
                </div>
              </div>
              {quote.description && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.5 }}>
                  {quote.description.slice(0, 300)}{quote.description.length > 300 ? "…" : ""}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Latest AI insight result */}
        {generating && (
          <div className="card" style={{ padding: 20, display: "flex", gap: 10, alignItems: "center" }}>
            <div className="spinner" />
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>AI is analysing {ticker} under {scenario} scenario…</span>
          </div>
        )}

        {latestInsight && (
          <InsightCard insight={latestInsight} onDelete={() => { setLatestInsight(null); loadInsights(); }} api={api} />
        )}

        {/* History */}
        {insights.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Insight History</div>
            <div className="col gap-2">
              {insights.map(ins => (
                <div key={ins.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <div className="row gap-2" style={{ alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 13 }}>{ins.ticker}</span>
                    <ActionBadge action={ins.action} />
                    <span className="pill" style={{ fontSize: 10 }}>{ins.scenario}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{ins.confidence}% confidence</span>
                    <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: "auto" }}>
                      {ins.created_at?.slice(0, 10)}
                    </span>
                    <button className="btn btn-icon btn-sm" onClick={() => deleteInsight(ins.id)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{ins.rationale}</div>
                  {ins.target_price && (
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                      Target: ${ins.target_price} · Model: {ins.model_used}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Market Scanner */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Penny stocks */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row gap-2" style={{ marginBottom: 14, alignItems: "center" }}>
              <div className="eyebrow" style={{ flex: 1 }}>Penny Stocks</div>
              <select className="input" style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
                      value={pennyRegion} onChange={e => setPennyRegion(e.target.value)}>
                <option value="US">US</option>
                <option value="EU">EU</option>
                <option value="UK">UK</option>
              </select>
              <button className="btn btn-sm" onClick={loadPenny} disabled={loadingPenny}>
                {loadingPenny ? "…" : "Scan"}
              </button>
            </div>
            {pennyStocks.length === 0 && !loadingPenny && (
              <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Click Scan to find penny stocks.</div>
            )}
            <div className="col gap-1">
              {pennyStocks.map(s => (
                <div key={s.ticker} className="row gap-2"
                     style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                     onClick={() => { setTicker(s.ticker); lookupQuote(s.ticker); }}>
                  <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 60 }}>{s.ticker}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {s.last_price != null ? `${s.currency} ${s.last_price.toFixed(3)}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Region scan */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row gap-2" style={{ marginBottom: 14, alignItems: "center" }}>
              <div className="eyebrow" style={{ flex: 1 }}>Market Scan</div>
              <select className="input" style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
                      value={scanRegion} onChange={e => setScanRegion(e.target.value)}>
                <option value="US">US Large Cap</option>
                <option value="EU">EU Large Cap</option>
                <option value="UK">UK Large Cap</option>
              </select>
              <button className="btn btn-sm" onClick={runScan} disabled={scanning}>
                {scanning ? "…" : "Scan"}
              </button>
            </div>
            {scanResults.length === 0 && !scanning && (
              <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Select a region and click Scan.</div>
            )}
            <div className="col gap-1" style={{ maxHeight: 260, overflowY: "auto" }}>
              {scanResults.map(s => (
                <div key={s.ticker} className="row gap-2"
                     style={{ padding: "5px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                     onClick={() => { setTicker(s.ticker); lookupQuote(s.ticker); }}>
                  <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 70 }}>{s.ticker}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 60, textAlign: "right" }}>
                    {s.last_price != null ? `$${s.last_price.toFixed(2)}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight: ins, onDelete, api }: {
  insight: Insight & { bull_case?: string; bear_case?: string; key_risks?: string[]; conditional_strategy?: string };
  onDelete: () => void;
  api: ApiFetch;
}) {
  const addToPortfolio = async () => {
    const price = ins.target_price;
    if (!price) return;
    await api("/api/v1/portfolio/holding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: ins.ticker, shares: 1, avg_cost: price, region: "US" }),
    });
  };

  return (
    <div className="card" style={{ padding: 22, border: `2px solid ${ins.action === "buy" ? "var(--green)" : ins.action === "sell" ? "var(--bad)" : "var(--line)"}` }}>
      <div className="row gap-3" style={{ marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)" }}>{ins.ticker}</span>
        <ActionBadge action={ins.action} />
        <div style={{ flex: 1 }} />
        <div className="row gap-1">
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Confidence</div>
          <div style={{ position: "relative", width: 80, height: 8, borderRadius: 4, background: "var(--paper-3)" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 4,
                          width: `${ins.confidence}%`, background: ins.confidence >= 70 ? "var(--ok)" : ins.confidence >= 50 ? "var(--warn)" : "var(--bad)" }} />
          </div>
          <span className="mono" style={{ fontSize: 12 }}>{ins.confidence}%</span>
        </div>
        {ins.target_price && (
          <div style={{ fontSize: 12, fontWeight: 600 }}>Target: ${ins.target_price}</div>
        )}
      </div>

      <p style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 14, color: "var(--ink)" }}>{ins.rationale}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        {ins.bull_case && (
          <div style={{ background: "var(--green-soft)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--green-ink)", textTransform: "uppercase", marginBottom: 6 }}>Bull Case</div>
            <div style={{ fontSize: 12.5, color: "var(--green-ink)", lineHeight: 1.4 }}>{ins.bull_case}</div>
          </div>
        )}
        {ins.bear_case && (
          <div style={{ background: "var(--bad-soft)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--bad)", textTransform: "uppercase", marginBottom: 6 }}>Bear Case</div>
            <div style={{ fontSize: 12.5, color: "var(--bad)", lineHeight: 1.4 }}>{ins.bear_case}</div>
          </div>
        )}
      </div>

      {ins.conditional_strategy && (
        <div style={{ marginBottom: 14, background: "rgba(91,140,68,0.08)", borderRadius: 8, border: "1px solid var(--green)", padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", marginBottom: 6 }}>If/Then Strategy</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{ins.conditional_strategy}</div>
        </div>
      )}

      {ins.key_risks && ins.key_risks.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: "var(--ink-3)", textTransform: "uppercase" }}>Key Risks</div>
          <div className="col gap-1">
            {ins.key_risks.map((r, i) => (
              <div key={i} className="row gap-2" style={{ fontSize: 12.5 }}>
                <span style={{ color: "var(--warn)" }}>⚠</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row gap-2">
        {ins.action === "buy" && ins.target_price && (
          <button className="btn btn-sm" onClick={addToPortfolio}>
            <Icon name="plus" size={12} /> Add to Portfolio
          </button>
        )}
        <button className="btn btn-sm" onClick={onDelete}>Dismiss</button>
      </div>
    </div>
  );
}

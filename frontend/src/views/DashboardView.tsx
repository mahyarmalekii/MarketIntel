import { useEffect, useState, useCallback } from "react";
import type { ApiFetch, PortfolioSummary, NewsItem, Insight, LogLine, View } from "../types";
import { getJson } from "../api";
import { StatCard } from "../components/Topbar";
import Icon from "../components/Icon";

export function DashboardView({ api, logs, setView }: {
  api: ApiFetch;
  logs: LogLine[];
  setView: (v: View) => void;
}) {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, n, i] = await Promise.all([
        getJson<PortfolioSummary>(api, "/api/v1/portfolio"),
        getJson<NewsItem[]>(api, "/api/v1/news?limit=6"),
        getJson<Insight[]>(api, "/api/v1/insights?limit=5"),
      ]);
      setPortfolio(p);
      setNews(n);
      setInsights(i);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const refreshNews = async () => {
    setRefreshing(true);
    await api("/api/v1/news/refresh", { method: "POST" });
    const h = () => { setRefreshing(false); load(); window.removeEventListener("news-refresh-done", h); };
    window.addEventListener("news-refresh-done", h);
    setTimeout(() => setRefreshing(false), 30000);
  };

  const pnl = portfolio?.total_pnl ?? 0;
  const pnlPct = portfolio?.total_pnl_pct ?? 0;
  const regionMap: Record<string, number> = {};
  for (const h of portfolio?.holdings ?? []) {
    regionMap[h.region] = (regionMap[h.region] ?? 0) + (h.current_value ?? 0);
  }

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 28 }}>

        {error && (
          <div style={{ background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 10, padding: 14, color: "var(--bad)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          <StatCard tone="blue"
            icon="dollar"
            label="Total Value"
            value={`$${(portfolio?.total_value ?? 0).toLocaleString("en", { maximumFractionDigits: 0 })}`}
            sub="current portfolio" />
          <StatCard
            tone={pnl >= 0 ? "green" : "pink"}
            icon={pnl >= 0 ? "trend-up" : "trend-down"}
            label="Total P&L"
            value={`${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toLocaleString("en", { maximumFractionDigits: 0 })}`}
            sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% return`} />
          <StatCard tone="purple" icon="layers" label="Positions" value={portfolio?.holdings.length ?? 0} sub="across US · EU · UK" />
          <StatCard tone="orange" icon="newspaper" label="News Items" value={news.length} sub="latest in feed" />
          <StatCard tone="teal" icon="spark" label="AI Insights" value={insights.length} sub="generated" />
        </div>

        {/* Region allocation */}
        {Object.keys(regionMap).length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Region Allocation</div>
            <div className="row gap-3" style={{ flexWrap: "wrap" }}>
              {Object.entries(regionMap).map(([region, val]) => {
                const total = portfolio?.total_value ?? 1;
                const pct = (val / total) * 100;
                const tones: Record<string, string> = { US: "blue", EU: "green", UK: "teal" };
                const tone = tones[region] ?? "purple";
                return (
                  <div key={region} style={{ flex: "1 1 160px" }}>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{region}</span>
                      <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--paper-3)" }}>
                      <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: `var(--${tone})`, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                      ${val.toLocaleString("en", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* News */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div className="eyebrow">Latest News</div>
              <button className="btn btn-sm" onClick={refreshNews} disabled={refreshing}>
                <Icon name="refresh" size={12} /> {refreshing ? "Fetching…" : "Refresh"}
              </button>
            </div>
            <div className="col gap-1">
              {news.length === 0 && (
                <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
                  No news yet.{" "}
                  <button className="btn btn-sm" onClick={refreshNews}>Fetch now</button>
                </div>
              )}
              {news.map(n => (
                <a key={n.id} href={n.url} target="_blank" rel="noreferrer"
                   style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="row gap-2"
                       style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                    <SentimentDot sentiment={n.sentiment} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{n.source}</div>
                    </div>
                  </div>
                </a>
              ))}
              {news.length > 0 && (
                <button className="btn btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }}
                        onClick={() => setView("news")}>
                  All news <Icon name="arrow-right" size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Insights */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div className="eyebrow">Latest Insights</div>
              <button className="btn btn-sm" onClick={() => setView("research")}>Generate</button>
            </div>
            <div className="col gap-2">
              {insights.length === 0 && (
                <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
                  No insights yet.{" "}
                  <button className="btn btn-sm" onClick={() => setView("research")}>Research a stock</button>
                </div>
              )}
              {insights.map(ins => {
                const insightRisk = ins.action === "buy" && ins.confidence >= 75 ? 3
                  : ins.action === "buy" ? 5
                  : ins.action === "hold" ? 4
                  : ins.action === "sell" ? 6
                  : 5;
                const riskColor = insightRisk <= 3 ? "#00b894" : insightRisk <= 5 ? "#fdcb6e" : "#e17055";
                return (
                <div key={ins.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                  <div className="row gap-2" style={{ alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{ins.ticker}</span>
                    <ActionBadge action={ins.action} />
                    <div title={`Risk ${insightRisk}/10`} style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: riskColor + "22", border: `1.5px solid ${riskColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, fontSize: 10, color: riskColor, flexShrink: 0,
                    }}>
                      {insightRisk}
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: "auto" }}>
                      {ins.confidence}% conf
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.4 }}>
                    {ins.rationale?.slice(0, 110)}{(ins.rationale?.length ?? 0) > 110 ? "…" : ""}
                  </div>
                </div>
                );
              })}
              {insights.length > 0 && (
                <button className="btn btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }}
                        onClick={() => setView("research")}>
                  All insights <Icon name="arrow-right" size={11} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Activity strip */}
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Recent Activity</div>
          <div className="col gap-1">
            {logs.filter(l => l.kind !== "heartbeat").slice(0, 6).map(l => (
              <div key={l.id} className="row gap-2"
                   style={{ fontSize: 12, padding: "3px 0",
                            color: l.kind === "agent" ? "var(--ink)" : "var(--ink-3)" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", minWidth: 54 }}>{l.ts}</span>
                <span className="pill" style={{ fontSize: 9.5, padding: "1px 5px" }}>{l.src}</span>
                <span style={{ flex: 1 }}>{l.msg}</span>
              </div>
            ))}
            {logs.filter(l => l.kind !== "heartbeat").length === 0 && (
              <div style={{ color: "var(--ink-3)", fontSize: 12 }}>No activity yet.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

function SentimentDot({ sentiment }: { sentiment: string }) {
  const color = sentiment === "bullish" ? "var(--ok)" : sentiment === "bearish" ? "var(--bad)" : "var(--ink-4)";
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 3 }} />;
}

export function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    buy:   { bg: "var(--green-soft)",  color: "var(--green-ink)"  },
    hold:  { bg: "var(--yellow-soft)", color: "var(--yellow-ink)" },
    sell:  { bg: "var(--bad-soft)",    color: "var(--bad)"        },
    watch: { bg: "var(--blue-soft)",   color: "var(--blue-ink)"   },
  };
  const s = map[action] ?? map.watch;
  return (
    <span style={{ ...s, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                   textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {action}
    </span>
  );
}

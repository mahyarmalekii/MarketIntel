import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiFetch } from "../types";
import Icon from "../components/Icon";

interface Market {
  id: string;
  platform: string;
  question: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  end_date: string | null;
  hours_left: number | null;
  category: string;
  url: string;
  risk: number;
  good_bet: boolean;
  niche_bet: boolean;
  big_bet: boolean;
}

interface PredSource {
  id: string;
  name: string;
  color: string;
  categories: string[];
  description: string;
  data_type: string;
  reliability: string;
  covers: string[];
}

interface NewsSource {
  id: string;
  name: string;
  color: string;
  category: string;
  covers: string[];
}

interface SourcesData {
  prediction_markets: PredSource[];
  news_sources: NewsSource[];
  x_configured: boolean;
}

interface AnalysisResult {
  edge_assessment: string;
  bull_case: string;
  bear_case: string;
  recommended_position: string;
  confidence: number;
  rational_alternative: { description: string; rationale: string };
  niche_angle: string;
  portfolio_cross_impact: string;
  political_financial_link: string;
  signal: "BUY" | "SELL" | "HOLD" | "WATCH";
  signal_rationale: string;
  key_dates: string;
}

interface CrossSignal {
  ticker: string;
  signal: string;
  strength: number;
  trigger: string;
  category: string;
  time_horizon: string;
  rationale: string;
  linked_prediction: string;
}

type Category  = "all" | "financial" | "sports" | "politics" | "tech";
type BetFilter = "all" | "niche" | "big";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "financial", label: "Financial" },
  { id: "sports",    label: "Sports" },
  { id: "politics",  label: "Politics" },
  { id: "tech",      label: "Tech" },
];

const PLATFORM_COLORS: Record<string, string> = {
  polymarket: "#00b4b4",
  kalshi:     "#6c5ce7",
  predictit:  "#e84393",
  metaculus:  "#f39c12",
  manifold:   "#3498db",
};

const PLATFORM_LABELS: Record<string, string> = {
  polymarket: "Polymarket",
  kalshi:     "Kalshi",
  predictit:  "PredictIt",
  metaculus:  "Metaculus",
  manifold:   "Manifold",
};

const SIGNAL_COLORS: Record<string, string> = {
  BUY:   "#00b894",
  SELL:  "#d63031",
  HOLD:  "#fdcb6e",
  WATCH: "#74b9ff",
};

// ─── Small shared components ─────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: number }) {
  const color =
    risk <= 3 ? "#00b894" : risk <= 5 ? "#fdcb6e" : risk <= 7 ? "#e17055" : "#d63031";
  const label =
    risk <= 3 ? "Low" : risk <= 5 ? "Med" : risk <= 7 ? "High" : "V.High";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: color + "22", border: `2px solid ${color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 12, color,
      }}>
        {risk}
      </div>
      <span style={{ fontSize: 9.5, color, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function PriceBar({ yes, no }: { yes: number; no: number }) {
  return (
    <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 7, width: "100%" }}>
      <div style={{ width: `${yes}%`, background: "#00b894" }} />
      <div style={{ width: `${no}%`, background: "#d63031" }} />
    </div>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#888";
  const label = PLATFORM_LABELS[platform] ?? platform;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12,
      background: color + "22", color,
    }}>
      {label}
    </span>
  );
}

function SignalPill({ signal }: { signal: string }) {
  const color = SIGNAL_COLORS[signal] ?? "#888";
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 8,
      background: color + "22", color, border: `1px solid ${color}`,
    }}>
      {signal}
    </span>
  );
}

function fmt_vol(n: number): string {
  if (n <= 0)         return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fmt_time(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1)      return `${Math.round(hours * 60)}m left`;
  if (hours < 24)     return `${Math.round(hours)}h left`;
  return `${Math.round(hours / 24)}d left`;
}

// ─── Sources Panel ────────────────────────────────────────────────────────────

const NEWS_CAT_COLORS: Record<string, string> = {
  finance:  "#00b894",
  politics: "#e17055",
  sports:   "#74b9ff",
  social:   "#ff4500",
};

function SourcesPanel({ data, api }: { data: SourcesData; api: ApiFetch }) {
  const [open,        setOpen]        = useState(true);
  const [newsFilter,  setNewsFilter]  = useState<"all" | "finance" | "politics" | "sports" | "social">("all");
  const [nitterInput, setNitterInput] = useState("");
  const [savingNitter,setSavingNitter]= useState(false);
  const [nitterSaved, setNitterSaved] = useState(false);

  const saveNitter = async () => {
    if (!nitterInput.trim()) return;
    setSavingNitter(true);
    try {
      await api("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "x_nitter_instance", value: nitterInput.trim() }),
      });
      setNitterSaved(true);
    } finally {
      setSavingNitter(false);
    }
  };

  const totalSources =
    data.prediction_markets.length + data.news_sources.length;

  const filteredNews = newsFilter === "all"
    ? data.news_sources
    : data.news_sources.filter(s => s.category === newsFilter);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <Icon name="spark" size={14} />
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
          Data Sources — where insights come from
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>
          {totalSources} sources ({data.prediction_markets.length} markets + {data.news_sources.length} news)
        </span>
        <span style={{ color: "var(--ink-3)", fontSize: 16 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--line)" }}>

          {/* Prediction markets */}
          <div style={{ padding: "10px 16px 6px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 8 }}>
              Prediction Market Platforms ({data.prediction_markets.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {data.prediction_markets.map(s => (
                <div key={s.id} style={{
                  padding: "10px 12px", borderRadius: 8, background: "var(--paper-2)",
                  borderLeft: `3px solid ${s.color}`,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "var(--ink)", marginBottom: 4 }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.4, marginBottom: 4 }}>
                    {s.description}
                  </div>
                  <div style={{ fontSize: 9.5, color: "var(--ink-3)", marginBottom: 3 }}>
                    <strong style={{ color: "var(--ink-2)" }}>Reliability:</strong> {s.reliability}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {s.covers.slice(0, 3).map(c => (
                      <span key={c} style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 6,
                        background: s.color + "18", color: s.color, fontWeight: 600,
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* X / Nitter setup (when not configured) */}
          {!data.x_configured && !nitterSaved && (
            <div style={{
              margin: "0 16px 10px", padding: "12px 14px", borderRadius: 10,
              background: "#00000010", border: "1px solid #00000020",
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 13, marginRight: 4 }}>𝕏</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "var(--ink)", marginBottom: 2 }}>
                  X / Twitter — not configured
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  X's official API costs $100/month. Use a free{" "}
                  <strong>Nitter</strong> instance instead (open-source Twitter frontend with RSS).
                  Enter your preferred instance URL to enable X feeds.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={nitterInput}
                  onChange={e => setNitterInput(e.target.value)}
                  placeholder="https://nitter.privacydev.net"
                  style={{
                    padding: "5px 10px", borderRadius: 8, fontSize: 11.5,
                    border: "1px solid var(--line)", background: "var(--paper)",
                    color: "var(--ink)", width: 220,
                  }}
                  onKeyDown={e => e.key === "Enter" && void saveNitter()}
                />
                <button
                  className="btn"
                  onClick={() => void saveNitter()}
                  disabled={savingNitter || !nitterInput.trim()}
                  style={{ fontSize: 11, padding: "5px 12px" }}
                >
                  {savingNitter ? "Saving…" : "Enable"}
                </button>
              </div>
            </div>
          )}

          {(data.x_configured || nitterSaved) && (
            <div style={{
              margin: "0 16px 10px", padding: "8px 14px", borderRadius: 8,
              background: "#00000008", border: "1px solid #00000018",
              display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
              color: "var(--ink-2)",
            }}>
              <span style={{ fontSize: 14 }}>𝕏</span>
              <span>
                X / Twitter feed <strong style={{ color: "var(--ok)" }}>active</strong> via Nitter —
                monitoring {16} accounts. Posts included in next news refresh.
              </span>
            </div>
          )}

          {/* News sources */}
          <div style={{ padding: "10px 16px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                            letterSpacing: "0.08em", color: "var(--ink-3)" }}>
                News & Social Sources ({data.news_sources.length})
              </div>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                {(["all", "finance", "politics", "sports", "social"] as const).map(f => (
                  <button key={f} onClick={() => setNewsFilter(f)} style={{
                    padding: "2px 9px", borderRadius: 12, fontSize: 10.5, cursor: "pointer", border: "none",
                    background: newsFilter === f
                      ? (f === "all" ? "var(--paper-3)" : (NEWS_CAT_COLORS[f] ?? "#888") + "28")
                      : "var(--paper-2)",
                    color: newsFilter === f
                      ? (f === "all" ? "var(--ink)" : (NEWS_CAT_COLORS[f] ?? "#888"))
                      : "var(--ink-3)",
                    fontWeight: newsFilter === f ? 700 : 400,
                  }}>
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {filteredNews.map(s => {
                const catColor = NEWS_CAT_COLORS[s.category] ?? "#888";
                return (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 10px", borderRadius: 20,
                    background: catColor + "14",
                    border: `1px solid ${catColor}30`,
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>{s.name}</span>
                    <span style={{ fontSize: 10, color: "var(--ink-3)" }}>
                      {s.covers[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cross-Signals Panel ──────────────────────────────────────────────────────

function CrossSignalsPanel({ signals, loading, onRefresh }: {
  signals: CrossSignal[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
        borderBottom: signals.length > 0 ? "1px solid var(--line)" : undefined,
      }}>
        <Icon name="spark" size={13} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>Cross-Domain Portfolio Signals</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          Political &amp; macro news → your holdings
        </span>
        <button
          className="btn"
          onClick={onRefresh}
          disabled={loading}
          style={{ marginLeft: "auto", fontSize: 11, padding: "4px 12px" }}
        >
          <Icon name="refresh" size={12} />
          {loading ? "Scanning…" : "Refresh Signals"}
        </button>
      </div>

      {loading && signals.length === 0 && (
        <div className="row gap-2" style={{
          padding: "20px", color: "var(--ink-3)", justifyContent: "center", fontSize: 12,
        }}>
          <div className="spinner" /> Analyzing markets and news for portfolio impact…
        </div>
      )}

      {signals.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 1,
        }}>
          {signals.map((s, i) => {
            const sigColor = SIGNAL_COLORS[s.signal] ?? "#888";
            return (
              <div key={i} style={{
                padding: "14px 16px",
                borderRight: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                borderLeft: `3px solid ${sigColor}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
                    {s.ticker}
                  </span>
                  <SignalPill signal={s.signal} />
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-3)" }}>
                    strength {s.strength}/10
                  </span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>
                  {s.trigger}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, marginBottom: 6 }}>
                  {s.rationale}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 9.5, padding: "1px 7px", borderRadius: 8,
                    background: "var(--paper-3)", color: "var(--ink-3)",
                  }}>
                    {s.category}
                  </span>
                  <span style={{
                    fontSize: 9.5, padding: "1px 7px", borderRadius: 8,
                    background: "var(--paper-3)", color: "var(--ink-3)",
                  }}>
                    {s.time_horizon}
                  </span>
                </div>
                {s.linked_prediction && (
                  <div style={{
                    marginTop: 8, fontSize: 10, color: "var(--blue-ink)",
                    borderTop: "1px solid var(--line)", paddingTop: 6,
                  }}>
                    Linked: {s.linked_prediction}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && signals.length === 0 && (
        <div style={{ padding: "16px", fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
          Click "Refresh Signals" to scan current prediction markets and news for portfolio impact.
        </div>
      )}
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function DetailDrawer({
  market,
  analysis,
  relatedNews,
  analyzing,
  onAnalyze,
  onClose,
}: {
  market: Market;
  analysis: AnalysisResult | null;
  relatedNews: any[];
  analyzing: boolean;
  onAnalyze: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)",
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201,
        width: "min(540px, 95vw)",
        background: "var(--paper)",
        borderLeft: "1px solid var(--line)",
        display: "flex", flexDirection: "column",
        overflowY: "auto",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--line)",
          position: "sticky", top: 0, background: "var(--paper)", zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                <PlatformBadge platform={market.platform} />
                <span style={{
                  fontSize: 10, color: "var(--ink-3)", padding: "2px 6px",
                  background: "var(--paper-3)", borderRadius: 10,
                }}>
                  {market.category}
                </span>
                {market.niche_bet && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: "#a29bfe22", color: "#a29bfe",
                  }}>
                    Niche
                  </span>
                )}
                {market.big_bet && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: "#fdcb6e22", color: "#b8860b",
                  }}>
                    High Volume
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4, color: "var(--ink)" }}>
                {market.question}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--ink-3)", fontSize: 18, padding: "2px 6px",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Odds row */}
          <div style={{ marginTop: 12 }}>
            <PriceBar yes={market.yes_price} no={market.no_price} />
            <div className="row gap-3" style={{ marginTop: 6, fontSize: 12, flexWrap: "wrap" }}>
              <span style={{ color: "#00b894", fontWeight: 700 }}>YES {market.yes_price}¢</span>
              <span style={{ color: "#d63031", fontWeight: 700 }}>NO {market.no_price}¢</span>
              <span style={{ color: "var(--ink-3)" }}>Vol {fmt_vol(market.volume_24h)}</span>
              <span style={{ color: "var(--ink-3)" }}>{fmt_time(market.hours_left)}</span>
              <a href={market.url} target="_blank" rel="noopener noreferrer"
                 style={{ color: "var(--blue-ink)", textDecoration: "none", fontSize: 11 }}>
                Open on {PLATFORM_LABELS[market.platform] ?? market.platform} ↗
              </a>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Risk + Analyze button */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <RiskBadge risk={market.risk} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4 }}>
                Risk score based on odds distance from 50%, liquidity, and time decay.
              </div>
            </div>
            {!analysis && (
              <button
                className="btn"
                onClick={onAnalyze}
                disabled={analyzing}
                style={{
                  background: "var(--primary-container)", color: "#000",
                  fontWeight: 700, borderColor: "var(--primary-container)",
                }}
              >
                <Icon name="spark" size={12} />
                {analyzing ? "Analyzing…" : "AI Deep Analyze"}
              </button>
            )}
          </div>

          {analyzing && !analysis && (
            <div className="row gap-2" style={{
              padding: "20px", background: "var(--blue-soft)", borderRadius: 12,
              color: "var(--blue-ink)", justifyContent: "center", fontSize: 12,
            }}>
              <div className="spinner" />
              Analyzing market edges, news, and portfolio impact…
            </div>
          )}

          {/* AI Analysis */}
          {analysis && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Signal */}
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                background: (SIGNAL_COLORS[analysis.signal] ?? "#888") + "14",
                borderRadius: 10,
                border: `1px solid ${(SIGNAL_COLORS[analysis.signal] ?? "#888")}44`,
              }}>
                <SignalPill signal={analysis.signal} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)", marginBottom: 2 }}>
                    Portfolio Signal
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.4 }}>
                    {analysis.signal_rationale}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--ink-3)", marginBottom: 2 }}>Confidence</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>
                    {analysis.confidence}%
                  </div>
                </div>
              </div>

              {/* Recommended position */}
              <Section title="AI Recommended Position" accent="var(--blue)">
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue-ink)", marginBottom: 4 }}>
                  {analysis.recommended_position}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  {analysis.edge_assessment}
                </div>
              </Section>

              {/* Bull / Bear */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Section title="Bull Case (YES)" accent="#00b894">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.bull_case}
                  </div>
                </Section>
                <Section title="Bear Case (NO)" accent="#d63031">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.bear_case}
                  </div>
                </Section>
              </div>

              {/* Rational alternative */}
              {analysis.rational_alternative?.description && (
                <Section title="More Rational Alternative" accent="#a29bfe">
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                    {analysis.rational_alternative.description}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {analysis.rational_alternative.rationale}
                  </div>
                </Section>
              )}

              {/* Niche angle */}
              {analysis.niche_angle && (
                <Section title="Contrarian / Niche Angle" accent="#a29bfe">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.niche_angle}
                  </div>
                </Section>
              )}

              {/* Portfolio cross-impact */}
              {analysis.portfolio_cross_impact && (
                <Section title="Portfolio Cross-Impact" accent="#fdcb6e">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.portfolio_cross_impact}
                  </div>
                </Section>
              )}

              {/* Political / financial link */}
              {analysis.political_financial_link && (
                <Section title="Political → Financial Market Link" accent="#e17055">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.political_financial_link}
                  </div>
                </Section>
              )}

              {/* Key dates */}
              {analysis.key_dates && (
                <Section title="Key Dates & Catalysts" accent="var(--ink-3)">
                  <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {analysis.key_dates}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* Related news */}
          {relatedNews.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 8,
              }}>
                Related News ({relatedNews.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {relatedNews.map((n: any, i: number) => {
                  const sentColor =
                    n.sentiment === "bullish" ? "#00b894" :
                    n.sentiment === "bearish" ? "#d63031" : "var(--ink-3)";
                  return (
                    <div key={i} style={{
                      padding: "8px 12px", borderRadius: 8,
                      background: "var(--paper-2)",
                      borderLeft: `3px solid ${sentColor}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
                        <span style={{ color: sentColor, fontWeight: 600 }}>{n.sentiment}</span>
                        {" — "}{n.source}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {analysis && (
            <button
              className="btn"
              onClick={onAnalyze}
              style={{ fontSize: 11, alignSelf: "flex-start" }}
            >
              <Icon name="refresh" size={11} /> Re-analyze
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, accent, children }: {
  title: string; accent: string; children: ReactNode;
}) {
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 10,
      background: "var(--paper-2)",
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: accent, marginBottom: 6,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Intel Crew Panel ─────────────────────────────────────────────────────────

interface CrewStatus {
  ready: boolean;
  issues: string[];
  agent_count: number;
  has_crewai: boolean;
  llm_provider: string;
  llm_model: string;
  has_llm_key: boolean;
  portfolio_size: number;
  news_items: number;
  parallel_phases: number;
}

interface CrewResult {
  source: string;
  agents_used: number;
  tickers: string[];
  result: {
    regime_summary: string;
    overall_risk_level: number;
    portfolio_health: string;
    equity_signals: {
      ticker: string; signal: string; current_price: number; target_price: number;
      stop_loss: number; upside_pct: number; confidence: number; time_horizon: string;
      cross_domain_driver: string; entry_level: number;
    }[];
    prediction_bets: {
      question: string; platform: string; current_yes_price: number; fair_value: number;
      edge_pct: number; position: string; confidence: number; linked_equity: string; rationale: string;
    }[];
    hedges: { instrument: string; sizing_pct: number; rationale: string }[];
    macro_calls: { theme: string; direction: string; affected_assets: string[]; confidence: number }[];
    political_alerts: { event: string; market_impact: string; impact_score: number; timeline: string }[];
    top_3_actions: string[];
    watch_list: string[];
  };
  n8n?: { total_workflows_triggered: number };
}

const HEALTH_COLOR: Record<string, string> = {
  STRONG:   "#00b894",
  MODERATE: "#fdcb6e",
  WEAK:     "#e17055",
  CRITICAL: "#d63031",
};

function IntelCrewPanel({ api }: { api: ApiFetch }) {
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [progressMsg,setProgressMsg]= useState("");
  const [result,     setResult]     = useState<CrewResult | null>(null);
  const [error,      setError]      = useState("");
  const [tab,        setTab]        = useState<"brief" | "equity" | "bets" | "risk" | "macro">("brief");
  const [crewStatus, setCrewStatus] = useState<CrewStatus | null>(null);
  const [fastMode,   setFastMode]   = useState(false);
  const crewHandlerRef = useRef<((e: Event) => void) | null>(null);
  const progHandlerRef = useRef<((e: Event) => void) | null>(null);

  useEffect(() => {
    api("/api/v1/predictions/crew-ready")
      .then(r => { if (r.ok) r.json().then(setCrewStatus); })
      .catch(() => {});
  }, [api]);

  const launch = () => {
    setRunning(true);
    setProgress(5);
    setProgressMsg("Launching Intel Crew...");
    setError("");

    if (crewHandlerRef.current)  window.removeEventListener("intel-crew-done",     crewHandlerRef.current);
    if (progHandlerRef.current)  window.removeEventListener("intel-crew-progress", progHandlerRef.current);

    const progressHandler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setProgress(d.pct ?? 0);
      setProgressMsg(d.msg ?? "");
    };
    const doneHandler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.data) setResult(d.data as CrewResult);
      if (d.msg && d.event === "intel_crew_error") setError(d.msg);
      setRunning(false);
      setProgress(100);
      window.removeEventListener("intel-crew-done",     doneHandler);
      window.removeEventListener("intel-crew-progress", progressHandler);
      crewHandlerRef.current = null;
      progHandlerRef.current = null;
    };

    crewHandlerRef.current = doneHandler;
    progHandlerRef.current = progressHandler;
    window.addEventListener("intel-crew-done",     doneHandler);
    window.addEventListener("intel-crew-progress", progressHandler);

    api("/api/v1/predictions/full-cross-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [], fire_n8n: true, fast_mode: fastMode }),
    }).catch(err => { setError(String(err)); setRunning(false); });

    setTimeout(() => setRunning(false), 300_000);
  };

  const r = result?.result;
  const healthColor = HEALTH_COLOR[r?.portfolio_health ?? ""] ?? "var(--ink-3)";

  const statusDot = !crewStatus ? "#888"
    : crewStatus.ready ? "#00b894"
    : crewStatus.has_llm_key ? "#fdcb6e"
    : "#d63031";
  const statusLabel = !crewStatus ? "Checking…"
    : crewStatus.ready ? "Ready"
    : crewStatus.has_llm_key ? "Partial"
    : "Not ready";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
        borderBottom: "1px solid var(--line)",
        background: "linear-gradient(135deg, var(--paper-2) 0%, var(--paper) 100%)",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>
            Intel Crew — 12-Agent Cross-Domain Analysis
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
            4 parallel phases · Political · Macro · Equity · Prediction Markets · Risk · Synthesis
          </div>
        </div>

        {r && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--ink-3)" }}>Risk</div>
              <div style={{ fontSize: 18, fontWeight: 800,
                color: r.overall_risk_level >= 8 ? "#d63031" : r.overall_risk_level >= 6 ? "#e17055" : "#00b894" }}>
                {r.overall_risk_level}/10
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--ink-3)" }}>Health</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: healthColor }}>
                {r.portfolio_health}
              </div>
            </div>
          </div>
        )}

        {/* Fast mode toggle */}
        <label style={{
          display: "flex", alignItems: "center", gap: 5, fontSize: 11,
          color: "var(--ink-3)", cursor: "pointer", userSelect: "none",
        }}>
          <input
            type="checkbox"
            checked={fastMode}
            onChange={e => setFastMode(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Fast
        </label>

        {/* Status dot + launch button */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <button
            className="btn"
            onClick={launch}
            disabled={running}
            style={{
              background: running ? "var(--paper-3)" : "var(--primary-container)",
              color: running ? "var(--ink-3)" : "#000",
              fontWeight: 800, borderColor: "transparent", minWidth: 130,
            }}
          >
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%",
              background: statusDot, marginRight: 5, flexShrink: 0,
              boxShadow: crewStatus?.ready ? `0 0 5px ${statusDot}` : undefined,
            }} />
            {running ? "Crew Running…" : result ? "Re-run Crew" : "Launch Intel Crew"}
          </button>
          <span style={{ fontSize: 9.5, color: statusDot, fontWeight: 700 }}>{statusLabel}</span>
        </div>
      </div>

      {/* Issues bar — only shown when not ready */}
      {crewStatus && !crewStatus.ready && crewStatus.issues.length > 0 && !running && (
        <div style={{
          padding: "8px 18px", background: "#fdcb6e18",
          borderBottom: "1px solid #fdcb6e44",
          display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b7851f" }}>Setup needed:</span>
          {crewStatus.issues.map((issue, i) => (
            <span key={i} style={{
              fontSize: 10.5, color: "#b7851f", background: "#fdcb6e28",
              padding: "2px 8px", borderRadius: 8,
            }}>{issue}</span>
          ))}
        </div>
      )}

      {/* Ready info bar */}
      {crewStatus?.ready && !running && !result && (
        <div style={{
          padding: "6px 18px", background: "#00b89410",
          borderBottom: "1px solid #00b89430",
          display: "flex", gap: 16, alignItems: "center",
        }}>
          <span style={{ fontSize: 10.5, color: "#00b894" }}>
            {crewStatus.agent_count} agents · {crewStatus.llm_provider} ({crewStatus.llm_model}) ·{" "}
            {crewStatus.portfolio_size} holdings · {crewStatus.news_items} news items ·{" "}
            {crewStatus.parallel_phases} parallel phases
          </span>
          {fastMode && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#fdcb6e",
              background: "#fdcb6e18", padding: "1px 7px", borderRadius: 6,
            }}>
              FAST: 4 tickers max, ~50% fewer tokens
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      {running && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 600 }}>{progressMsg}</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{progress}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4, background: "var(--blue)",
              width: `${progress}%`, transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 6 }}>
            Each agent builds on the previous — analysis typically takes 60-120 seconds
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 18px", background: "var(--bad-soft)", color: "var(--bad)", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {r && !running && (
        <div>
          {/* Regime summary */}
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)",
                        background: "var(--blue-soft)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--blue-ink)",
                          textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Macro Regime
            </div>
            <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>
              {r.regime_summary}
            </div>
          </div>

          {/* Top 3 actions */}
          {r.top_3_actions?.length > 0 && (
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                            letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 8 }}>
                Top Priority Actions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {r.top_3_actions.map((action, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      background: i === 0 ? "#d63031" : i === 1 ? "#fdcb6e" : "#00b894",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, color: "#fff",
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.5, paddingTop: 2 }}>
                      {action}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)" }}>
            {([
              ["brief",  "Brief"],
              ["equity", `Equity (${r.equity_signals?.length ?? 0})`],
              ["bets",   `Bets (${r.prediction_bets?.length ?? 0})`],
              ["risk",   "Risk & Hedges"],
              ["macro",  "Macro & Politics"],
            ] as [string, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id as typeof tab)}
                style={{
                  padding: "8px 14px", fontSize: 11.5, border: "none", cursor: "pointer",
                  borderBottom: tab === id ? "2px solid var(--blue)" : "2px solid transparent",
                  background: tab === id ? "var(--blue-soft)" : "var(--paper)",
                  color: tab === id ? "var(--blue-ink)" : "var(--ink-3)",
                  fontWeight: tab === id ? 700 : 400,
                  transition: "all 0.12s",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab: Brief */}
          {tab === "brief" && (
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {r.watch_list?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)",
                                textTransform: "uppercase", marginBottom: 6 }}>Watch List</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.watch_list.map(t => (
                      <span key={t} style={{
                        padding: "3px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: "var(--paper-3)", color: "var(--ink)",
                      }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                Source: <strong>{result?.source}</strong> ·{" "}
                {result?.agents_used} agents ·{" "}
                Tickers: {result?.tickers?.join(", ")}
                {result?.n8n?.total_workflows_triggered
                  ? ` · n8n: ${result.n8n.total_workflows_triggered} workflows fired`
                  : ""}
              </div>
            </div>
          )}

          {/* Tab: Equity Signals */}
          {tab === "equity" && (
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {(r.equity_signals ?? []).map((s, i) => {
                const sigColor = SIGNAL_COLORS[s.signal] ?? "#888";
                return (
                  <div key={i} style={{
                    padding: "12px 14px", borderRadius: 10, background: "var(--paper-2)",
                    borderLeft: `4px solid ${sigColor}`,
                    display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
                  }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{s.ticker}</span>
                        <SignalPill signal={s.signal} />
                        <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{s.time_horizon}</span>
                        <span style={{ fontSize: 10.5, color: "var(--ink-3)", marginLeft: "auto" }}>
                          {s.confidence}% confidence
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.4, marginBottom: 6 }}>
                        {s.cross_domain_driver}
                      </div>
                      <div style={{ display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
                        <span>Entry: <strong>${s.entry_level?.toFixed(2)}</strong></span>
                        <span>Target: <strong style={{ color: "#00b894" }}>${s.target_price?.toFixed(2)}</strong></span>
                        <span>Stop: <strong style={{ color: "#d63031" }}>${s.stop_loss?.toFixed(2)}</strong></span>
                        <span>Upside: <strong style={{ color: s.upside_pct >= 0 ? "#00b894" : "#d63031" }}>
                          {s.upside_pct >= 0 ? "+" : ""}{s.upside_pct?.toFixed(1)}%
                        </strong></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab: Prediction Bets */}
          {tab === "bets" && (
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {(r.prediction_bets ?? []).map((b, i) => (
                <div key={i} style={{
                  padding: "12px 14px", borderRadius: 10, background: "var(--paper-2)",
                  borderLeft: `4px solid ${b.position === "YES" ? "#00b894" : "#d63031"}`,
                }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                      background: b.position === "YES" ? "#00b89422" : "#d6303122",
                      color: b.position === "YES" ? "#00b894" : "#d63031",
                    }}>{b.position}</span>
                    <span style={{ fontSize: 10, color: "var(--ink-3)", padding: "2px 6px",
                                   background: "var(--paper-3)", borderRadius: 8 }}>{b.platform}</span>
                    {b.linked_equity && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blue-ink)",
                                     padding: "2px 6px", background: "var(--blue-soft)", borderRadius: 8 }}>
                        {b.linked_equity}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700,
                                   color: "#00b894" }}>
                      +{b.edge_pct?.toFixed(1)}% edge
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 6, lineHeight: 1.4 }}>
                    {b.question}
                  </div>
                  <div style={{ display: "flex", gap: 14, fontSize: 11, marginBottom: 6 }}>
                    <span>Market: <strong>{b.current_yes_price}¢</strong></span>
                    <span>Fair value: <strong style={{ color: "var(--blue-ink)" }}>{b.fair_value}¢</strong></span>
                    <span>Confidence: <strong>{b.confidence}%</strong></span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>{b.rationale}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tab: Risk & Hedges */}
          {tab === "risk" && (
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {(r.hedges ?? []).map((h, i) => (
                <div key={i} style={{
                  padding: "10px 14px", borderRadius: 10, background: "var(--paper-2)",
                  borderLeft: "4px solid #e17055",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{h.instrument}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#e17055" }}>
                      {h.sizing_pct?.toFixed(1)}% of portfolio
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{h.rationale}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tab: Macro & Politics */}
          {tab === "macro" && (
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {(r.political_alerts ?? []).map((a, i) => {
                const impact = a.impact_score ?? 0;
                const color  = impact >= 7 ? "#d63031" : impact >= 4 ? "#e17055" : "#fdcb6e";
                return (
                  <div key={i} style={{
                    padding: "10px 14px", borderRadius: 10, background: "var(--paper-2)",
                    borderLeft: `4px solid ${color}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: "var(--ink)", flex: 1 }}>{a.event}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color }}>
                        {impact >= 0 ? "+" : ""}{impact}/10
                      </span>
                      <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{a.timeline}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{a.market_impact}</div>
                  </div>
                );
              })}
              {(r.macro_calls ?? []).map((m, i) => {
                const color = m.direction === "bullish" ? "#00b894"
                            : m.direction === "bearish" ? "#d63031" : "#fdcb6e";
                return (
                  <div key={`m${i}`} style={{
                    padding: "10px 14px", borderRadius: 10, background: "var(--paper-2)",
                    borderLeft: `4px solid ${color}`,
                  }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{m.theme}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8,
                        background: color + "22", color,
                      }}>{m.direction}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>
                        {m.confidence}% conf.
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {(m.affected_assets ?? []).map(a => (
                        <span key={a} style={{
                          fontSize: 10.5, padding: "1px 7px", borderRadius: 6,
                          background: "var(--paper-3)", fontWeight: 600,
                        }}>{a}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!result && !running && !error && (
        <div style={{ padding: "20px 18px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
          Launch the Intel Crew to run a full cross-domain analysis:
          political intelligence → macro regime → equity signals with price targets →
          prediction market edges → risk assessment → synthesized action brief.
          All agents share context — everything is interconnected.
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function PredictionsView({ api }: { api: ApiFetch }) {
  const [markets,       setMarkets]       = useState<Market[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [category,      setCategory]      = useState<Category>("all");
  const [showOnly,      setShowOnly]      = useState<"all" | "good">("all");
  const [maxRisk,       setMaxRisk]       = useState(10);
  const [betFilter,     setBetFilter]     = useState<BetFilter>("all");
  const [error,         setError]         = useState("");
  const [aiPredictions, setAiPredictions] = useState<any[]>([]);
  const [generatingAI,  setGeneratingAI]  = useState(false);

  const [sourcesData,   setSourcesData]   = useState<SourcesData | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [analysis,      setAnalysis]      = useState<AnalysisResult | null>(null);
  const [relatedNews,   setRelatedNews]   = useState<any[]>([]);
  const [analyzingId,   setAnalyzingId]   = useState<string | null>(null);

  const [crossSignals,     setCrossSignals]     = useState<CrossSignal[]>([]);
  const [loadingCrossSignals, setLoadingCrossSignals] = useState(false);

  const analyzeHandlerRef = useRef<((e: Event) => void) | null>(null);
  const crossHandlerRef   = useRef<((e: Event) => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = showOnly === "good"
        ? "/api/v1/predictions/suggest?limit=20"
        : `/api/v1/predictions?limit=30${category !== "all" ? `&category=${category}` : ""}`;
      const r = await api(url);
      if (!r.ok) throw new Error(await r.text());
      setMarkets(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [api, category, showOnly]);

  useEffect(() => { void load(); }, [load]);

  // Load sources on mount
  useEffect(() => {
    api("/api/v1/predictions/sources")
      .then(r => r.json())
      .then(setSourcesData)
      .catch(() => {/* ignore */});
  }, [api]);

  // WebSocket: AI predictions
  const generateAIPredictions = async () => {
    setGeneratingAI(true);
    await api("/api/v1/predictions/generate", { method: "POST" });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.data) setAiPredictions(detail.data);
      setGeneratingAI(false);
      window.removeEventListener("predictions-done", handler);
    };
    window.addEventListener("predictions-done", handler);
    setTimeout(() => setGeneratingAI(false), 60000);
  };

  // WebSocket: market analysis
  const analyzeMarket = useCallback((market: Market) => {
    setAnalyzingId(market.id);
    setAnalysis(null);
    setRelatedNews([]);

    if (analyzeHandlerRef.current)
      window.removeEventListener("pred-analyze-done", analyzeHandlerRef.current);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.market_id !== market.id) return;
      if (detail.analysis) {
        setAnalysis(detail.analysis);
        setRelatedNews(detail.related_news ?? []);
      }
      setAnalyzingId(null);
      window.removeEventListener("pred-analyze-done", handler);
      analyzeHandlerRef.current = null;
    };
    analyzeHandlerRef.current = handler;
    window.addEventListener("pred-analyze-done", handler);

    api("/api/v1/predictions/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id:         market.id,
        question:   market.question,
        yes_price:  market.yes_price,
        platform:   market.platform,
        category:   market.category,
        volume_24h: market.volume_24h,
        hours_left: market.hours_left,
        url:        market.url,
      }),
    }).catch(() => setAnalyzingId(null));

    setTimeout(() => setAnalyzingId(null), 90000);
  }, [api]);

  // WebSocket: cross signals
  const loadCrossSignals = () => {
    setLoadingCrossSignals(true);
    setCrossSignals([]);

    if (crossHandlerRef.current)
      window.removeEventListener("cross-signals-done", crossHandlerRef.current);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.signals) setCrossSignals(detail.signals);
      setLoadingCrossSignals(false);
      window.removeEventListener("cross-signals-done", handler);
      crossHandlerRef.current = null;
    };
    crossHandlerRef.current = handler;
    window.addEventListener("cross-signals-done", handler);

    api("/api/v1/predictions/cross-signals", { method: "POST" })
      .catch(() => setLoadingCrossSignals(false));

    setTimeout(() => setLoadingCrossSignals(false), 90000);
  };

  // Clean up handlers on unmount
  useEffect(() => {
    return () => {
      if (analyzeHandlerRef.current)
        window.removeEventListener("pred-analyze-done", analyzeHandlerRef.current);
      if (crossHandlerRef.current)
        window.removeEventListener("cross-signals-done", crossHandlerRef.current);
    };
  }, []);

  // Close drawer and clear analysis when market changes
  const handleCardClick = (market: Market) => {
    if (selectedMarket?.id === market.id) {
      setSelectedMarket(null);
      setAnalysis(null);
      setRelatedNews([]);
    } else {
      setSelectedMarket(market);
      setAnalysis(null);
      setRelatedNews([]);
    }
  };

  // Filtering
  const visible = markets.filter(m => {
    if (m.risk > maxRisk) return false;
    if (betFilter === "niche" && !m.niche_bet) return false;
    if (betFilter === "big"   && !m.big_bet)   return false;
    return true;
  });

  const goodCount = markets.filter(m => m.good_bet).length;
  const nicheCount = markets.filter(m => m.niche_bet).length;
  const bigCount   = markets.filter(m => m.big_bet).length;
  const avgRisk    = markets.length
    ? (markets.reduce((s, m) => s + m.risk, 0) / markets.length).toFixed(1)
    : "—";
  const platformsPresent = [...new Set(markets.map(m => m.platform))];

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Sources panel */}
        {sourcesData && <SourcesPanel data={sourcesData} api={api} />}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Prediction Markets</h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
              Live odds from 5 platforms — click any market for AI deep-analysis
            </div>
          </div>
          <div className="row gap-2">
            <button
              className="btn"
              onClick={generateAIPredictions}
              disabled={generatingAI}
              style={{
                background: "var(--primary-container)", color: "#000",
                fontWeight: 700, borderColor: "var(--primary-container)",
              }}
            >
              <Icon name="spark" size={13} />
              {generatingAI ? "AI Running…" : "AI Trades"}
            </button>
            <button className="btn" onClick={load} disabled={loading} style={{ gap: 6 }}>
              <Icon name="refresh" size={13} /> {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "Markets loaded", value: markets.length },
            { label: "Suggested bets", value: goodCount,  accent: true },
            { label: "Niche bets",      value: nicheCount },
            { label: "High volume",     value: bigCount },
            { label: "Avg risk score",  value: avgRisk + " / 10" },
            { label: "Sources active",  value: platformsPresent.length || "—" },
          ].map(s => (
            <div key={s.label} className="card" style={{
              padding: "10px 16px", minWidth: 100, flex: 1,
              border: s.accent ? "1px solid var(--blue)" : undefined,
            }}>
              <div style={{
                fontSize: 22, fontWeight: 800,
                color: s.accent ? "var(--blue-ink)" : "var(--ink)",
              }}>
                {s.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Intel Crew — 6-agent cross-domain analysis */}
        <IntelCrewPanel api={api} />

        {/* Cross signals */}
        <CrossSignalsPanel
          signals={crossSignals}
          loading={loadingCrossSignals}
          onRefresh={loadCrossSignals}
        />

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                border: `1px solid ${category === c.id ? "var(--blue)" : "var(--line)"}`,
                background: category === c.id ? "var(--blue-soft)" : "var(--paper-2)",
                color: category === c.id ? "var(--blue-ink)" : "var(--ink-2)",
                fontWeight: category === c.id ? 700 : 400,
                transition: "all 0.15s",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Bet type + filters row */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Bet type filter */}
          <div style={{ display: "flex", gap: 1, borderRadius: 20, overflow: "hidden", border: "1px solid var(--line)" }}>
            {(["all", "niche", "big"] as BetFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setBetFilter(f)}
                style={{
                  padding: "5px 13px", fontSize: 12, cursor: "pointer", border: "none",
                  background: betFilter === f ? "var(--paper-3)" : "var(--paper-2)",
                  color: betFilter === f
                    ? f === "niche" ? "#a29bfe" : f === "big" ? "#b8860b" : "var(--ink)"
                    : "var(--ink-3)",
                  fontWeight: betFilter === f ? 700 : 400,
                  transition: "all 0.12s",
                }}
              >
                {f === "all" ? "All Bets" : f === "niche" ? "Niche" : "High Volume"}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowOnly(s => s === "good" ? "all" : "good")}
            style={{
              padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              border: `1px solid ${showOnly === "good" ? "#00b894" : "var(--line)"}`,
              background: showOnly === "good" ? "#00b89422" : "var(--paper-2)",
              color: showOnly === "good" ? "#00b894" : "var(--ink-2)",
              fontWeight: showOnly === "good" ? 600 : 400,
            }}
          >
            Suggested only
          </button>

          <div className="row gap-2" style={{ alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Max risk:</span>
            {[3, 5, 7, 10].map(v => (
              <button
                key={v}
                onClick={() => setMaxRisk(v)}
                style={{
                  padding: "4px 10px", borderRadius: 16, fontSize: 11.5, cursor: "pointer",
                  border: "1px solid var(--line)",
                  background: maxRisk === v ? "var(--paper-3)" : "var(--paper-2)",
                  fontWeight: maxRisk === v ? 700 : 400,
                  color: maxRisk === v
                    ? v <= 3 ? "#00b894" : v <= 5 ? "#fdcb6e" : v <= 7 ? "#e17055" : "#d63031"
                    : "var(--ink-3)",
                }}
              >
                ≤{v}
              </button>
            ))}
          </div>
        </div>

        {/* Platform legend */}
        {platformsPresent.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Active sources:</span>
            {platformsPresent.map(p => <PlatformBadge key={p} platform={p} />)}
          </div>
        )}

        {error && (
          <div style={{ padding: 14, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 8, fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading && markets.length === 0 && (
          <div className="row gap-2" style={{ color: "var(--ink-3)", padding: "30px 0", justifyContent: "center" }}>
            <div className="spinner" /> Fetching prediction markets…
          </div>
        )}

        {/* AI Generated Predictions */}
        {aiPredictions.length > 0 && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 14, padding: "20px",
            background: "var(--blue-soft)", borderRadius: 16, border: "1px solid var(--blue)",
          }}>
            <div className="eyebrow" style={{ color: "var(--blue-ink)" }}>AI News-to-Trade Predictions</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
              {aiPredictions.map((p, i) => (
                <div key={i} className="card" style={{ padding: 16, background: "var(--card)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 4 }}>News Event</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>{p.news_event}</div>
                    </div>
                    <div style={{
                      background: p.decision === "BET" ? "var(--ok-soft)" : "var(--bad-soft)",
                      color: p.decision === "BET" ? "var(--ok)" : "var(--bad)",
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 800,
                      border: `1px solid ${p.decision === "BET" ? "var(--ok)" : "var(--bad)"}`,
                    }}>
                      {p.decision}
                    </div>
                  </div>
                  <div style={{ borderLeft: "2px solid var(--blue)", paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--blue-ink)", textTransform: "uppercase", marginBottom: 2 }}>Rationale</div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>{p.rationale}</div>
                  </div>
                  <div style={{ borderLeft: "2px solid var(--bad)", paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--bad)", textTransform: "uppercase", marginBottom: 2 }}>Risk</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{p.risk_analysis}</div>
                  </div>
                  <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase" }}>Actionable Setup</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--blue-ink)" }}>{p.actionable_trade}</div>
                    </div>
                    <div className="pill" style={{ background: "var(--paper-3)", fontSize: 11, fontWeight: 700 }}>{p.ticker}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Market cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map(m => {
            const isSelected = selectedMarket?.id === m.id;
            return (
              <div
                key={`${m.platform}-${m.id}`}
                className="card"
                onClick={() => handleCardClick(m)}
                style={{
                  padding: "14px 16px", cursor: "pointer",
                  border: isSelected
                    ? "1px solid var(--blue)"
                    : m.good_bet
                      ? "1px solid #00b89455"
                      : "1px solid var(--line)",
                  background: isSelected
                    ? "var(--blue-soft)"
                    : m.good_bet
                      ? "#00b8940a"
                      : "var(--card)",
                  position: "relative",
                  transition: "all 0.12s",
                }}
              >
                {/* Badges */}
                <div style={{ position: "absolute", top: 10, right: 14, display: "flex", gap: 6 }}>
                  {m.niche_bet && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                      background: "#a29bfe22", color: "#a29bfe",
                    }}>
                      Niche
                    </span>
                  )}
                  {m.big_bet && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                      background: "#fdcb6e22", color: "#b8860b",
                    }}>
                      High Vol
                    </span>
                  )}
                  {m.good_bet && !m.niche_bet && !m.big_bet && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                      background: "#00b89422", color: "#00b894",
                    }}>
                      Suggested
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <PlatformBadge platform={m.platform} />
                      {m.category && (
                        <span style={{
                          fontSize: 10, color: "var(--ink-3)", padding: "2px 6px",
                          background: "var(--paper-3)", borderRadius: 10,
                        }}>
                          {m.category}
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, marginBottom: 8,
                      paddingRight: (m.good_bet || m.niche_bet || m.big_bet) ? 110 : 0,
                    }}>
                      {m.question}
                    </div>
                    <PriceBar yes={m.yes_price} no={m.no_price} />
                    <div className="row gap-3" style={{ marginTop: 6, fontSize: 11.5, flexWrap: "wrap" }}>
                      <span style={{ color: "#00b894", fontWeight: 700 }}>YES {m.yes_price}¢</span>
                      <span style={{ color: "#d63031", fontWeight: 700 }}>NO {m.no_price}¢</span>
                      <span style={{ color: "var(--ink-3)" }}>Vol {fmt_vol(m.volume_24h)}</span>
                      <span style={{ color: "var(--ink-3)" }}>{fmt_time(m.hours_left)}</span>
                      <span style={{ color: "var(--blue-ink)", fontSize: 11 }}>
                        {isSelected ? "▲ Open" : "Click to analyze →"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
                    <RiskBadge risk={m.risk} />
                    {analyzingId === m.id && (
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {visible.length === 0 && !loading && markets.length > 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "20px 0", fontSize: 13 }}>
            No markets match the current filters. Try adjusting the bet type or risk cap.
          </div>
        )}
        {visible.length === 0 && !loading && markets.length === 0 && !error && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "40px 0", fontSize: 13 }}>
            No markets loaded yet. Click Refresh to fetch.
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedMarket && (
        <DetailDrawer
          market={selectedMarket}
          analysis={analysis}
          relatedNews={relatedNews}
          analyzing={analyzingId === selectedMarket.id}
          onAnalyze={() => analyzeMarket(selectedMarket)}
          onClose={() => {
            setSelectedMarket(null);
            setAnalysis(null);
            setRelatedNews([]);
          }}
        />
      )}
    </div>
  );
}

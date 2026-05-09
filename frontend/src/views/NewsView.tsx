import { useCallback, useEffect, useState } from "react";
import type { ApiFetch, NewsItem } from "../types";
import { getJson } from "../api";
import Icon from "../components/Icon";

const SENTIMENTS = ["all", "bullish", "neutral", "bearish"] as const;

export function NewsView({ api }: { api: ApiFetch }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [filter, setFilter] = useState<"all" | "bullish" | "neutral" | "bearish">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filter === "all"
        ? "/api/v1/news?limit=80"
        : `/api/v1/news?sentiment=${filter}&limit=80`;
      const n = await getJson<NewsItem[]>(api, url);
      setNews(n);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener("news-refresh-done", h);
    return () => window.removeEventListener("news-refresh-done", h);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await api("/api/v1/news/refresh", { method: "POST" });
    setTimeout(() => setRefreshing(false), 30000);
  };

  const bullish = news.filter(n => n.sentiment === "bullish").length;
  const bearish = news.filter(n => n.sentiment === "bearish").length;

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>

        {/* Toolbar */}
        <div className="row gap-3" style={{ marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div className="row gap-1">
            {SENTIMENTS.map(s => (
              <button key={s} className={"btn btn-sm" + (filter === s ? " btn-active" : "")}
                      onClick={() => setFilter(s)}
                      style={filter === s ? { background: "var(--ink)", color: "var(--paper)" } : {}}>
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>↑ {bullish} bullish</span>
            <span style={{ fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>↓ {bearish} bearish</span>
            <button className="btn" onClick={refresh} disabled={refreshing}>
              <Icon name="refresh" size={13} /> {refreshing ? "Fetching…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 10,
                        padding: 14, color: "var(--bad)", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading && <div style={{ color: "var(--ink-3)", fontSize: 13, marginBottom: 16 }}>Loading…</div>}

        {!loading && news.length === 0 && (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ color: "var(--ink-3)", marginBottom: 12 }}>No news in the feed yet.</div>
            <button className="btn" onClick={refresh}>Fetch news now</button>
          </div>
        )}

        <div className="col gap-2">
          {news.map(item => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const sentColor = item.sentiment === "bullish" ? "var(--ok)"
    : item.sentiment === "bearish" ? "var(--bad)" : "var(--ink-4)";
  const sentBg = item.sentiment === "bullish" ? "var(--green-soft)"
    : item.sentiment === "bearish" ? "var(--bad-soft)" : "var(--paper-3)";

  return (
    <a href={item.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card" style={{ padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s" }}
           onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--ink-4)")}
           onMouseLeave={e => (e.currentTarget.style.borderColor = "")}>
        <div className="row gap-3" style={{ marginBottom: 6, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>{item.title}</div>
            {item.summary && (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {item.summary.slice(0, 200)}{item.summary.length > 200 ? "…" : ""}
              </div>
            )}
          </div>
          <span style={{ background: sentBg, color: sentColor, fontSize: 10, fontWeight: 700,
                         padding: "3px 8px", borderRadius: 999, textTransform: "uppercase",
                         letterSpacing: "0.06em", whiteSpace: "nowrap", flexShrink: 0 }}>
            {item.sentiment}
          </span>
        </div>
        <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>{item.source}</span>
          {item.published_at && (
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{item.published_at.slice(0, 16)}</span>
          )}
          {item.tickers.length > 0 && (
            <div className="row gap-1" style={{ marginLeft: "auto", flexWrap: "wrap" }}>
              {item.tickers.map(t => (
                <span key={t} className="pill" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>{t}</span>
              ))}
            </div>
          )}
          <Icon name="external" size={12} color="var(--ink-4)" style={{ marginLeft: item.tickers.length ? 0 : "auto" }} />
        </div>
      </div>
    </a>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { ApiFetch, Stock } from "../types";
import { getJson } from "../api";

const FOREX_TICKERS = ["EURUSD=X", "GBPUSD=X", "JPY=X", "AUDUSD=X", "USDCAD=X", "USDCHF=X"];

export function ForexView({ api }: { api: ApiFetch }) {
  const [quotes, setQuotes] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [customTicker, setCustomTicker] = useState("");

  const loadQuotes = useCallback(async (tickers: string[]) => {
    setLoading(true);
    try {
      const results = await Promise.all(
        tickers.map(t => getJson<Stock>(api, `/api/v1/market/quote/${t}`).catch(() => null))
      );
      setQuotes(prev => {
        const newMap = new Map(prev.map(q => [q.ticker, q]));
        results.forEach(q => { if (q && !q.error && q.ticker) newMap.set(q.ticker, q); });
        return Array.from(newMap.values());
      });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadQuotes(FOREX_TICKERS);
  }, [loadQuotes]);

  const addCustom = () => {
    if (customTicker) {
      let t = customTicker.toUpperCase();
      if (!t.includes("=X")) t += "=X";
      loadQuotes([t]);
      setCustomTicker("");
    }
  };

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Forex Exchange Rates</div>
          
          <div className="row gap-2" style={{ marginBottom: 20 }}>
            <input className="input" placeholder="e.g. EURGBP" 
                   value={customTicker} onChange={e => setCustomTicker(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && addCustom()} />
            <button className="btn" onClick={addCustom}>Look up</button>
            <button className="btn btn-icon" onClick={() => loadQuotes(quotes.map(q => q.ticker) || FOREX_TICKERS)} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
            {quotes.map(q => (
              <div key={q.ticker} style={{ background: "var(--paper-2)", borderRadius: 10, padding: 16, border: "1px solid var(--line)" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{q.ticker.replace("=X", "")}</span>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                    {q.last_price?.toLocaleString("en", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{q.name}</div>
                {q.prev_close && q.last_price && (
                  <div style={{ fontSize: 12, marginTop: 6, color: q.last_price >= q.prev_close ? "var(--ok)" : "var(--bad)" }}>
                    {((q.last_price - q.prev_close) / q.prev_close * 100).toFixed(2)}% from prev close
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

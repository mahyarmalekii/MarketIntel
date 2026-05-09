import { useState } from "react";
import Icon from "../components/Icon";

const EXCHANGES: Record<string, string> = {
  "US":   "NASDAQ",
  "NYSE": "NYSE",
  "EU":   "XETR",
  "LSE":  "LSE",
};

const INTERVALS = [
  { label: "1D", value: "D" },
  { label: "1W", value: "W" },
  { label: "1M", value: "M" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
];

const QUICK_PICKS = [
  { ticker: "AAPL",    exchange: "NASDAQ", label: "Apple" },
  { ticker: "MSFT",    exchange: "NASDAQ", label: "Microsoft" },
  { ticker: "NVDA",    exchange: "NASDAQ", label: "NVIDIA" },
  { ticker: "ASML",    exchange: "NASDAQ", label: "ASML" },
  { ticker: "SAP",     exchange: "XETR",   label: "SAP" },
  { ticker: "BP",      exchange: "LSE",    label: "BP" },
  { ticker: "TSLA",    exchange: "NASDAQ", label: "Tesla" },
  { ticker: "GOOGL",   exchange: "NASDAQ", label: "Alphabet" },
];

export function ChartsView() {
  const [ticker, setTicker] = useState("AAPL");
  const [exchange, setExchange] = useState("NASDAQ");
  const [interval, setInterval] = useState("D");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [input, setInput] = useState("");

  const symbol = `${exchange}:${ticker}`;

  const tvUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${encodeURIComponent(symbol)}&interval=${interval}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&theme=${theme}&style=1&timezone=Etc%2FUTC&locale=en&allow_symbol_change=1&calendar=0&hotlist=0&news=0&withdateranges=1`;

  const loadTicker = () => {
    if (!input.trim()) return;
    const parts = input.toUpperCase().split(":");
    if (parts.length === 2) {
      setExchange(parts[0]);
      setTicker(parts[1]);
    } else {
      setTicker(parts[0]);
    }
    setInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Toolbar */}
      <div className="row gap-3" style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)",
                                          background: "var(--card)", flexWrap: "wrap", alignItems: "center" }}>
        {/* Ticker input */}
        <div className="row gap-1" style={{ flex: "1 1 220px" }}>
          <input className="input" style={{ flex: 1 }}
                 placeholder="EXCHANGE:TICKER or just TICKER"
                 value={input}
                 onChange={e => setInput(e.target.value)}
                 onKeyDown={e => e.key === "Enter" && loadTicker()} />
          <select className="input" style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
                  value={exchange} onChange={e => setExchange(e.target.value)}>
            {Object.entries(EXCHANGES).map(([k, v]) => (
              <option key={k} value={v}>{v}</option>
            ))}
          </select>
          <button className="btn" onClick={loadTicker}>
            <Icon name="chart" size={13} /> Load
          </button>
        </div>

        {/* Interval */}
        <div className="row gap-1">
          {INTERVALS.map(i => (
            <button key={i.value} className="btn btn-sm"
                    onClick={() => setInterval(i.value)}
                    style={interval === i.value ? { background: "var(--ink)", color: "var(--paper)" } : {}}>
              {i.label}
            </button>
          ))}
        </div>

        {/* Theme */}
        <button className="btn btn-sm"
                onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
          {theme === "light" ? "Dark" : "Light"}
        </button>

        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>
          {symbol}
        </div>
      </div>

      {/* Quick picks */}
      <div className="row gap-1" style={{ padding: "8px 18px", borderBottom: "1px solid var(--line)",
                                           background: "var(--paper-2)", flexWrap: "wrap" }}>
        {QUICK_PICKS.map(q => (
          <button key={q.ticker} className="btn btn-sm"
                  onClick={() => { setTicker(q.ticker); setExchange(q.exchange); }}
                  style={ticker === q.ticker ? { background: "var(--blue)", color: "var(--blue-ink)" } : {}}>
            {q.ticker}
          </button>
        ))}
      </div>

      {/* TradingView iframe */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <iframe
          key={`${symbol}-${interval}-${theme}`}
          src={tvUrl}
          title={`TradingView chart — ${symbol}`}
          style={{ width: "100%", height: "100%", border: "none" }}
          allowFullScreen
        />
      </div>

      <div style={{ padding: "6px 18px", fontSize: 10.5, color: "var(--ink-4)",
                    background: "var(--paper-2)", borderTop: "1px solid var(--line)" }}>
        Charts powered by TradingView — free embeddable widget. Data is real-time for exchanges that support it.
      </div>
    </div>
  );
}

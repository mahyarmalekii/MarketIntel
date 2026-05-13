import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { ApiFetch } from "../types";
import { getJson } from "../api";

// ─── types ────────────────────────────────────────────────

interface TechBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  bb_mid: number | null;
}

interface TechSummary {
  rsi: number | null;
  rsi_signal: "overbought" | "oversold" | "neutral";
  trend: "bullish" | "bearish";
  macd: number | null;
  macd_signal_val: number | null;
  sma20: number | null;
  sma50: number | null;
}

interface TechData {
  bars: TechBar[];
  summary: TechSummary;
}

// ─── constants ────────────────────────────────────────────

const PERIODS = ["1mo", "3mo", "6mo", "1y", "2y"] as const;
type Period = (typeof PERIODS)[number];

const QUICK_PICKS = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "ASML"];

const GRID_STROKE = "rgba(255,255,255,0.04)";
const AXIS_COLOR  = "#3c4a40";
const AXIS_STYLE  = { fontSize: 10, fill: AXIS_COLOR };

// ─── helpers ──────────────────────────────────────────────

function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function tickEvery(bars: TechBar[], n: number): string[] {
  return bars
    .filter((_, i) => i % n === 0)
    .map(b => b.date);
}

// ─── custom tooltips ──────────────────────────────────────

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TechBar | undefined;
  if (!d) return null;
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8,
      padding: "10px 14px", fontSize: 11.5, minWidth: 170,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--ink-2)" }}>{fmtDate(label)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 14px" }}>
        {[
          ["Open",  d.open?.toFixed(2)],
          ["High",  d.high?.toFixed(2)],
          ["Low",   d.low?.toFixed(2)],
          ["Close", d.close?.toFixed(2)],
        ].map(([k, v]) => (
          <><span style={{ color: AXIS_COLOR }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span></>
        ))}
        {d.sma20  != null && <><span style={{ color: AXIS_COLOR }}>SMA20</span><span style={{ color: "#6da3d4" }}>{d.sma20.toFixed(2)}</span></>}
        {d.sma50  != null && <><span style={{ color: AXIS_COLOR }}>SMA50</span><span style={{ color: "#f2c94c" }}>{d.sma50.toFixed(2)}</span></>}
        {d.bb_upper != null && <><span style={{ color: AXIS_COLOR }}>BB+</span><span style={{ color: "#6da3d4" }}>{d.bb_upper.toFixed(2)}</span></>}
        {d.bb_lower != null && <><span style={{ color: AXIS_COLOR }}>BB-</span><span style={{ color: "#6da3d4" }}>{d.bb_lower.toFixed(2)}</span></>}
      </div>
    </div>
  );
}

function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TechBar | undefined;
  if (!d) return null;
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8,
      padding: "8px 12px", fontSize: 11.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--ink-2)" }}>{fmtDate(label)}</div>
      <div><span style={{ color: AXIS_COLOR }}>Volume </span><span style={{ fontWeight: 600 }}>{(d.volume / 1e6).toFixed(2)}M</span></div>
    </div>
  );
}

function RsiTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TechBar | undefined;
  if (!d || d.rsi == null) return null;
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8,
      padding: "8px 12px", fontSize: 11.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--ink-2)" }}>{fmtDate(label)}</div>
      <div><span style={{ color: AXIS_COLOR }}>RSI </span><span style={{ fontWeight: 600, color: "#a18cd1" }}>{d.rsi.toFixed(2)}</span></div>
    </div>
  );
}

function MacdTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TechBar | undefined;
  if (!d) return null;
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8,
      padding: "8px 12px", fontSize: 11.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--ink-2)" }}>{fmtDate(label)}</div>
      {d.macd        != null && <div><span style={{ color: AXIS_COLOR }}>MACD </span><span style={{ color: "#56ccdb" }}>{d.macd.toFixed(4)}</span></div>}
      {d.macd_signal != null && <div><span style={{ color: AXIS_COLOR }}>Signal </span><span style={{ color: "#f2994a" }}>{d.macd_signal.toFixed(4)}</span></div>}
      {d.macd_hist   != null && <div><span style={{ color: AXIS_COLOR }}>Hist </span><span style={{ fontWeight: 600 }}>{d.macd_hist.toFixed(4)}</span></div>}
    </div>
  );
}

// ─── summary pills ────────────────────────────────────────

function SummaryPills({ summary }: { summary: TechSummary }) {
  const rsiColor =
    summary.rsi_signal === "overbought" ? "var(--bad)"
    : summary.rsi_signal === "oversold"  ? "var(--ok)"
    : "var(--ink-3)";

  const trendColor = summary.trend === "bullish" ? "var(--ok)" : "var(--bad)";

  const macdCross = summary.macd != null && summary.macd_signal_val != null
    ? summary.macd > summary.macd_signal_val ? "Bullish Cross" : "Bearish Cross"
    : "—";
  const macdCrossColor = macdCross === "Bullish Cross" ? "var(--ok)" : macdCross === "Bearish Cross" ? "var(--bad)" : "var(--ink-3)";

  const pillStyle = (color: string) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 12px", borderRadius: 999,
    background: color + "18", border: `1px solid ${color}44`,
    fontSize: 12, fontWeight: 600, color,
  });

  return (
    <div className="row gap-2" style={{ padding: "8px 18px", flexWrap: "wrap", borderBottom: "1px solid var(--line)", background: "var(--card)" }}>
      <span style={pillStyle(rsiColor)}>
        RSI {summary.rsi != null ? summary.rsi.toFixed(1) : "—"}
        <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 11 }}>
          {summary.rsi_signal === "overbought" ? "Overbought"
           : summary.rsi_signal === "oversold" ? "Oversold"
           : "Neutral"}
        </span>
      </span>
      <span style={pillStyle(trendColor)}>
        Trend: {summary.trend === "bullish" ? "Bullish" : "Bearish"}
        {summary.sma20 != null && summary.sma50 != null && (
          <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 11 }}>
            SMA20 {summary.sma20.toFixed(1)} / SMA50 {summary.sma50.toFixed(1)}
          </span>
        )}
      </span>
      <span style={pillStyle(macdCrossColor)}>
        MACD: {macdCross}
      </span>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────

export function TechnicalView({ api }: { api: ApiFetch }) {
  const [ticker, setTicker]   = useState("AAPL");
  const [input, setInput]     = useState("AAPL");
  const [period, setPeriod]   = useState<Period>("3mo");
  const [data, setData]       = useState<TechData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (t: string, p: Period) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getJson<TechData>(api, `/api/v1/market/technicals/${t}?period=${p}`);
      setData(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load technical data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(ticker, period); }, [ticker, period, load]);

  const go = () => {
    const t = input.trim().toUpperCase();
    if (!t) return;
    setTicker(t);
  };

  const bars = data?.bars ?? [];

  // Compute tick density — show ~10 labels on the x-axis
  const tickStep = Math.max(1, Math.floor(bars.length / 10));
  const ticks = tickEvery(bars, tickStep);

  // Volume bar colors: green if close >= open, red otherwise
  const volumeData = bars.map(b => ({
    ...b,
    volumeUp:   b.close >= b.open ? b.volume : 0,
    volumeDown: b.close <  b.open ? b.volume : 0,
  }));

  // MACD histogram colors
  const macdData = bars.map(b => ({
    ...b,
    macdHistPos: b.macd_hist != null && b.macd_hist >= 0 ? b.macd_hist : 0,
    macdHistNeg: b.macd_hist != null && b.macd_hist < 0  ? b.macd_hist : 0,
  }));

  const chartCommon = {
    margin: { top: 0, right: 8, bottom: 0, left: 0 },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Toolbar */}
      <div className="row gap-3" style={{
        padding: "10px 18px", borderBottom: "1px solid var(--line)",
        background: "var(--card)", flexWrap: "wrap", alignItems: "center", flexShrink: 0,
      }}>
        <div className="row gap-1" style={{ flex: "1 1 200px" }}>
          <input
            className="input" style={{ flex: 1 }}
            placeholder="e.g. AAPL"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && go()}
          />
          <button className="btn" onClick={go}>Load</button>
        </div>

        {/* Period buttons */}
        <div className="row gap-1">
          {PERIODS.map(p => (
            <button
              key={p}
              className="btn btn-sm"
              onClick={() => setPeriod(p)}
              style={period === p ? { background: "var(--ink)", color: "var(--paper)" } : {}}
            >{p}</button>
          ))}
        </div>

        {/* Quick picks */}
        <div className="row gap-1" style={{ flexWrap: "wrap" }}>
          {QUICK_PICKS.map(q => (
            <button
              key={q}
              className="btn btn-sm"
              style={ticker === q ? { background: "var(--blue)", color: "var(--blue-ink)" } : {}}
              onClick={() => { setInput(q); setTicker(q); }}
            >{q}</button>
          ))}
        </div>
      </div>

      {/* Summary pills */}
      {data && !loading && <SummaryPills summary={data.summary} />}

      {/* Charts area */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, gap: 10 }}>
            <div className="spinner" />
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Loading technical data for {ticker}…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            margin: 24, background: "var(--bad-soft)", border: "1px solid var(--bad)",
            borderRadius: 10, padding: 16, color: "var(--bad)", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Charts */}
        {!loading && !error && bars.length > 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 0, padding: "0 4px 4px 4px" }}>

            {/* Panel 1 — Price + BB + SMA (50%) */}
            <div style={{ flex: "5 0 0", minHeight: 0, paddingTop: 8 }}>
              <div style={{ fontSize: 10, color: AXIS_COLOR, paddingLeft: 12, paddingBottom: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Price · BB · SMA
              </div>
              <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <ComposedChart data={bars} syncId="ta" {...chartCommon}>
                  <CartesianGrid strokeDasharray="0" stroke={GRID_STROKE} />
                  <XAxis
                    dataKey="date"
                    ticks={ticks}
                    tickFormatter={fmtDate}
                    tick={AXIS_STYLE}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={AXIS_STYLE}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => v.toFixed(0)}
                  />
                  <Tooltip content={<PriceTooltip />} />
                  {/* Bollinger Band fill area */}
                  <Area
                    type="monotone"
                    dataKey="bb_upper"
                    stroke="#6da3d4"
                    strokeWidth={1}
                    fill="rgba(109,163,212,0.08)"
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="bb_lower"
                    stroke="#6da3d4"
                    strokeWidth={1}
                    fill="rgba(109,163,212,0.08)"
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {/* SMA20 */}
                  <Line
                    type="monotone"
                    dataKey="sma20"
                    stroke="#6da3d4"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {/* SMA50 */}
                  <Line
                    type="monotone"
                    dataKey="sma50"
                    stroke="#f2c94c"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {/* Price */}
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#51faaa"
                    strokeWidth={1.8}
                    dot={false}
                    activeDot={{ r: 3, fill: "#51faaa" }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Panel 2 — Volume (15%) */}
            <div style={{ flex: "1.5 0 0", minHeight: 0, paddingTop: 4 }}>
              <div style={{ fontSize: 10, color: AXIS_COLOR, paddingLeft: 12, paddingBottom: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>Volume</div>
              <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <ComposedChart data={volumeData} syncId="ta" {...chartCommon}>
                  <CartesianGrid strokeDasharray="0" stroke={GRID_STROKE} />
                  <XAxis dataKey="date" hide />
                  <YAxis
                    tick={AXIS_STYLE}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => v >= 1e6 ? (v / 1e6).toFixed(0) + "M" : (v / 1e3).toFixed(0) + "K"}
                  />
                  <Tooltip content={<VolumeTooltip />} />
                  <Bar dataKey="volumeUp"   fill="rgba(81,250,170,0.5)" isAnimationActive={false} />
                  <Bar dataKey="volumeDown" fill="rgba(255,107,107,0.5)" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Panel 3 — RSI (20%) */}
            <div style={{ flex: "2 0 0", minHeight: 0, paddingTop: 4 }}>
              <div style={{ fontSize: 10, color: AXIS_COLOR, paddingLeft: 12, paddingBottom: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>RSI(14)</div>
              <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <ComposedChart data={bars} syncId="ta" {...chartCommon}>
                  <CartesianGrid strokeDasharray="0" stroke={GRID_STROKE} />
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} tick={AXIS_STYLE} axisLine={false} tickLine={false} width={52} ticks={[0, 30, 50, 70, 100]} />
                  <Tooltip content={<RsiTooltip />} />
                  {/* Overbought zone */}
                  <ReferenceLine y={70} stroke="rgba(255,107,107,0.5)" strokeDasharray="4 3" strokeWidth={1} />
                  {/* Oversold zone */}
                  <ReferenceLine y={30} stroke="rgba(81,250,170,0.5)" strokeDasharray="4 3" strokeWidth={1} />
                  {/* RSI line */}
                  <Line
                    type="monotone"
                    dataKey="rsi"
                    stroke="#a18cd1"
                    strokeWidth={1.8}
                    dot={false}
                    activeDot={{ r: 3, fill: "#a18cd1" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Panel 4 — MACD (15%) */}
            <div style={{ flex: "1.5 0 0", minHeight: 0, paddingTop: 4 }}>
              <div style={{ fontSize: 10, color: AXIS_COLOR, paddingLeft: 12, paddingBottom: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>MACD(12,26,9)</div>
              <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <ComposedChart data={macdData} syncId="ta" {...chartCommon}>
                  <CartesianGrid strokeDasharray="0" stroke={GRID_STROKE} />
                  <XAxis dataKey="date" hide />
                  <YAxis
                    tick={AXIS_STYLE}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(2)}
                  />
                  <Tooltip content={<MacdTooltip />} />
                  <ReferenceLine y={0} stroke={GRID_STROKE} strokeWidth={1} />
                  {/* Histogram */}
                  <Bar dataKey="macdHistPos" fill="rgba(81,250,170,0.7)" isAnimationActive={false} />
                  <Bar dataKey="macdHistNeg" fill="rgba(255,107,107,0.7)" isAnimationActive={false} />
                  {/* MACD line */}
                  <Line
                    type="monotone"
                    dataKey="macd"
                    stroke="#56ccdb"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 2, fill: "#56ccdb" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {/* Signal line */}
                  <Line
                    type="monotone"
                    dataKey="macd_signal"
                    stroke="#f2994a"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 2, fill: "#f2994a" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

          </div>
        )}

        {/* Empty state */}
        {!loading && !error && bars.length === 0 && data && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--ink-3)", fontSize: 13 }}>
            No data returned for {ticker} ({period}).
          </div>
        )}
      </div>
    </div>
  );
}

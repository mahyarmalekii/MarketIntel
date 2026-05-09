import Icon from "./Icon";
import type { View } from "../types";

const META: Record<View, { title: string; sub: string }> = {
  dashboard:  { title: "Dashboard",         sub: "Portfolio overview, market pulse, recent signals" },
  portfolio:  { title: "Portfolio",          sub: "Holdings, P&L, region allocation, add positions" },
  news:       { title: "News Feed",          sub: "Financial news with AI sentiment tagging" },
  research:   { title: "AI Research",        sub: "Stock insights, penny picks, multi-LLM analysis" },
  charts:     { title: "Charts",             sub: "TradingView live charts for any ticker" },
  scenarios:   { title: "Scenario Analysis",  sub: "Bull, bear, macro stress-test your portfolio" },
  predictions: { title: "Prediction Markets", sub: "Polymarket & Kalshi — live odds, risk ratings, suggested bets" },
  export:      { title: "Export & Automate",  sub: "Excel, Google Sheets, n8n workflows, CrewAI" },
  activity:    { title: "Activity Log",       sub: "Backend events and agent logs" },
};

export function Topbar({ view }: { view: View }) {
  const { title, sub } = META[view] ?? { title: view, sub: "" };
  return (
    <header className="topbar">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: 0 }}>{title}</h2>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
      </div>
    </header>
  );
}

export const StatCard = ({ tone, label, value, sub, icon }: {
  tone: string; label: string; value: string | number; sub: string; icon: string;
}) => (
  <div style={{
    background: `var(--${tone}-soft)`, border: `1px solid var(--${tone})`,
    borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 12, minHeight: 120,
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 9,
      background: `var(--${tone})`, color: `var(--${tone}-ink)`,
      display: "grid", placeItems: "center",
    }}>
      <Icon name={icon} size={15} />
    </div>
    <div className="col" style={{ gap: 4 }}>
      <div className="display tabular" style={{ fontSize: 36, color: `var(--${tone}-ink)`, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{sub}</div>
    </div>
  </div>
);

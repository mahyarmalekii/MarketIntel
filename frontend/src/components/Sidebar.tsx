import Icon from "./Icon";
import type { View } from "../types";

const NAV = [
  { id: "dashboard",   label: "Dashboard",    icon: "home",     tone: "blue"   },
  { id: "portfolio",   label: "Portfolio",    icon: "layers",   tone: "green"  },
  { id: "news",        label: "News Feed",    icon: "pulse",    tone: "orange" },
  { id: "research",    label: "AI Research",  icon: "spark",    tone: "purple" },
  { id: "charts",      label: "Charts",       icon: "chart",    tone: "teal"   },
  { id: "scenarios",   label: "Scenarios",    icon: "graph",    tone: "yellow" },
  { id: "predictions", label: "Predictions",  icon: "bolt",     tone: "pink"   },
  { id: "export",      label: "Export",       icon: "download", tone: "pink"   },
  { id: "activity",    label: "Activity",     icon: "pulse",    tone: "orange" },
  { id: "anthropic_agents", label: "Anthropic Agents", icon: "spark", tone: "purple" },
] as const;

export function Sidebar({ view, setView, online, port, beat, onSettings }: {
  view: View;
  setView: (v: View) => void;
  online: boolean;
  port: number | null;
  beat: number;
  onSettings: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="row gap-3" style={{ padding: "4px 8px 18px 8px" }}>
        <Icon name="logo" size={32} />
        <div className="col" style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>Market Intel</div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: "0.14em", textTransform: "uppercase" }}>local · free</div>
        </div>
      </div>

      <div className="eyebrow" style={{ padding: "0 12px", marginBottom: 4 }}>Workspace</div>
      <div className="col gap-1">
        {NAV.map(n => {
          const active = view === n.id;
          return (
            <div key={n.id} className={"nav-item " + (active ? "active" : "")} onClick={() => setView(n.id as View)}>
              <div className="nav-icon" style={{
                background: active ? `var(--${n.tone})` : "var(--paper-3)",
                color: active ? `var(--${n.tone}-ink)` : "var(--ink-2)",
              }}>
                <Icon name={n.icon} size={14} stroke={1.8} />
              </div>
              <span style={{ flex: 1 }}>{n.label}</span>
            </div>
          );
        })}
      </div>

      <div className="grow" />

      <div className="card-flat" style={{ padding: 10, background: "var(--card)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="col" style={{ gap: 2 }}>
            <div className="row gap-2">
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: online ? "var(--ok)" : "var(--bad)",
                boxShadow: `0 0 0 3px ${online ? "rgba(91,140,68,0.18)" : "rgba(180,69,44,0.18)"}`,
                animation: online ? "blink 2s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{online ? `Online · :${port}` : "Offline"}</span>
            </div>
            <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)" }}>♥ {beat}</span>
          </div>
          <button className="btn btn-icon" onClick={onSettings} aria-label="Settings">
            <Icon name="settings" size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import SettingsModal from "./SettingsModal";
import "./index.css";
import type { ApiFetch, View } from "./types";
import { useWS } from "./hooks/useWS";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import ErrorBoundary from "./components/ErrorBoundary";
import { DashboardView } from "./views/DashboardView";
import { PortfolioView } from "./views/PortfolioView";
import { NewsView } from "./views/NewsView";
import { ResearchView } from "./views/ResearchView";
import { ChartsView } from "./views/ChartsView";
import { ScenariosView } from "./views/ScenariosView";
import { PredictionsView } from "./views/PredictionsView";
import { ExportView } from "./views/ExportView";
import { ActivityView } from "./views/ActivityView";

// Backend URL: "" means same origin (proxy in dev, same-host in production)
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_URL ?? "";

export default function App() {
  const { conn, port, apiToken, sidecarError, logs, beat } = useWS();

  const api = useMemo<ApiFetch | null>(() => {
    if (!apiToken) return null;
    return (path, opts) => {
      const headers = new Headers(opts?.headers);
      headers.set("Authorization", `Bearer ${apiToken}`);
      return fetch(`${BACKEND_HTTP}${path}`, { ...opts, headers });
    };
  }, [apiToken]);

  const [view, setView] = useState<View>("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const [startupSeconds, setStartupSeconds] = useState(0);

  useEffect(() => {
    if (api) return;
    const start = Date.now();
    const t = window.setInterval(
      () => setStartupSeconds(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => window.clearInterval(t);
  }, [api]);

  if (!api) {
    return (
      <StartupScreen
        conn={conn}
        port={port}
        seconds={startupSeconds}
        sidecarError={sidecarError}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar
        view={view}
        setView={setView}
        online={conn === "connected"}
        port={port}
        beat={beat}
        onSettings={() => setShowSettings(true)}
      />
      <div className="app-main">
        <Topbar view={view} />
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: "var(--paper)",
          }}
        >
          {view === "dashboard" && (
            <ErrorBoundary label="Dashboard">
              <DashboardView api={api} logs={logs} setView={setView} />
            </ErrorBoundary>
          )}
          {view === "portfolio" && (
            <ErrorBoundary label="Portfolio">
              <PortfolioView api={api} />
            </ErrorBoundary>
          )}
          {view === "news" && (
            <ErrorBoundary label="News">
              <NewsView api={api} />
            </ErrorBoundary>
          )}
          {view === "research" && (
            <ErrorBoundary label="Research">
              <ResearchView api={api} />
            </ErrorBoundary>
          )}
          {view === "charts" && (
            <ErrorBoundary label="Charts">
              <ChartsView />
            </ErrorBoundary>
          )}
          {view === "scenarios" && (
            <ErrorBoundary label="Scenarios">
              <ScenariosView api={api} />
            </ErrorBoundary>
          )}
          {view === "predictions" && (
            <ErrorBoundary label="Predictions">
              <PredictionsView api={api} />
            </ErrorBoundary>
          )}
          {view === "export" && (
            <ErrorBoundary label="Export">
              <ExportView api={api} />
            </ErrorBoundary>
          )}
          {view === "activity" && (
            <ErrorBoundary label="Activity">
              <ActivityView logs={logs} />
            </ErrorBoundary>
          )}
        </div>
      </div>
      <AnimatePresence>
        {showSettings && api && (
          <SettingsModal key="settings" api={api} onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function StartupScreen({
  conn,
  seconds,
  sidecarError,
}: {
  conn: string;
  port: number | null;
  seconds: number;
  sidecarError: string | null;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "grid",
        placeItems: "center",
        background: "var(--paper)",
        padding: 24,
      }}
    >
      <section className="card col gap-4" style={{ width: "min(680px,100%)", padding: 30 }}>
        <div className="row gap-3">
          <div className="spinner" />
          <div>
            <div className="eyebrow">Connecting to backend</div>
            <h1 style={{ fontSize: 28, marginTop: 6 }}>Preparing your workspace</h1>
          </div>
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <span className="pill">Status: {conn}</span>
          <span className="pill">Elapsed: {seconds}s</span>
        </div>
        {seconds >= 15 && (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 14,
              background: "var(--paper-3)",
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            Taking longer than expected. Make sure the backend is running and
            <code style={{ margin: "0 4px" }}>VITE_BACKEND_URL</code> is set correctly.
          </div>
        )}
        {sidecarError && (
          <div
            style={{
              border: "1px solid var(--bad)",
              borderRadius: 8,
              padding: 14,
              background: "var(--bad-soft)",
              color: "var(--bad)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {sidecarError}
          </div>
        )}
      </section>
    </div>
  );
}

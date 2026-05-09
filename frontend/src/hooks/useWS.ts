import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnSt, LogLine } from "../types";

// Backend base URL: set VITE_BACKEND_URL in .env for production.
// In dev, vite.config.ts proxies /api and /ws to localhost:2860.
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_URL ?? "";
const BACKEND_WS = BACKEND_HTTP
  ? BACKEND_HTTP.replace(/^https/, "wss").replace(/^http/, "ws")
  : "";

export function useWS() {
  const [conn, setConn] = useState<ConnSt>("disconnected");
  const [port, setPort] = useState<number | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [sidecarError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [beat, setBeat] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const idRef = useRef(0);

  const addLog = useCallback((msg: string, kind: LogLine["kind"], src = "sys") => {
    setLogs(p => [
      { id: idRef.current++, ts: new Date().toISOString().slice(11, 19), msg, src, kind },
      ...p.slice(0, 149),
    ]);
  }, []);

  const setToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    setApiToken(t);
  }, []);

  const connect = useCallback((token: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConn("connecting");
    const wsUrl = BACKEND_WS
      ? `${BACKEND_WS}/ws?token=${encodeURIComponent(token)}`
      : `/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => { setConn("connected"); addLog("Backend connected", "system", "ws"); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "heartbeat") {
          setBeat(d.beat);
          if (d.beat % 12 === 1)
            addLog(`Heartbeat #${d.beat} — uptime ${d.uptime_seconds.toFixed(0)}s`, "heartbeat", "hb");
        } else if (d.type === "agent") {
          addLog(d.msg ?? d.event, "agent", d.event ?? "agent");
          if (d.event === "news_done" || d.event === "news_error")
            window.dispatchEvent(new CustomEvent("news-refresh-done", { detail: d }));
          if (d.event === "insight_done" || d.event === "insight_error")
            window.dispatchEvent(new CustomEvent("insight-done", { detail: d }));
          if (d.event === "propose_done" || d.event === "propose_error")
            window.dispatchEvent(new CustomEvent("propose-done", { detail: d }));
          if (d.event === "scenario_done" || d.event === "scenario_error")
            window.dispatchEvent(new CustomEvent("scenario-done", { detail: d }));
          if (d.event === "crewai_done" || d.event === "crewai_error")
            window.dispatchEvent(new CustomEvent("crewai-done", { detail: d }));
          if (d.event === "predictions_done" || d.event === "predictions_error")
            window.dispatchEvent(new CustomEvent("predictions-done", { detail: d }));
          if (d.event === "pred_analyze_done" || d.event === "pred_analyze_error")
            window.dispatchEvent(new CustomEvent("pred-analyze-done", { detail: d }));
          if (d.event === "cross_signals_done" || d.event === "cross_signals_error")
            window.dispatchEvent(new CustomEvent("cross-signals-done", { detail: d }));
          if (d.event === "intel_crew_done" || d.event === "intel_crew_error")
            window.dispatchEvent(new CustomEvent("intel-crew-done", { detail: d }));
          if (d.event === "intel_crew_progress")
            window.dispatchEvent(new CustomEvent("intel-crew-progress", { detail: d }));
        }
      } catch { /* ignore */ }
    };
    ws.onclose = (ev) => {
      setConn("disconnected");
      wsRef.current = null;
      // If the backend rejected our token (e.g. backend restarted with new token),
      // clear the stale cached token so we re-fetch a fresh one.
      if (ev.code === 4401 || ev.code === 1006) {
        localStorage.removeItem("MI_TOKEN");
        setToken(null);
        // Re-fetch token after a short delay
        setTimeout(async () => {
          try {
            const r = await fetch(`${BACKEND_HTTP}/api/v1/token`);
            if (r.ok) {
              const j = await r.json();
              const t = j.token as string;
              localStorage.setItem("MI_TOKEN", t);
              setToken(t);
              connect(t);
            }
          } catch { /* backend not up yet, will retry */ }
        }, 1500);
      } else {
        // Read latest token via ref so reconnect doesn't use a stale closure value.
        setTimeout(() => {
          const t = tokenRef.current;
          if (t) connect(t);
        }, 3000);
      }
    };
    ws.onerror = () => ws.close();
  }, [addLog, setToken]);

  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;

    const fetchToken = async () => {
      const stored = localStorage.getItem("MI_TOKEN");
      if (stored) {
        setToken(stored);
        connect(stored);
        return;
      }
      try {
        const r = await fetch(`${BACKEND_HTTP}/api/v1/token`);
        if (r.ok) {
          const j = await r.json();
          const t = j.token as string;
          localStorage.setItem("MI_TOKEN", t);
          setToken(t);
          // port is implicit from the proxy — use a placeholder to signal "connected"
          setPort(0);
          connect(t);
        }
      } catch { /* backend not up yet */ }
    };

    void fetchToken();
    poll = window.setInterval(() => {
      if (!cancelled && !tokenRef.current) void fetchToken();
    }, 1500);

    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearInterval(poll);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { conn, port, apiToken, sidecarError, logs, beat, addLog };
}

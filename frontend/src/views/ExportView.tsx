import { useState } from "react";
import type { ApiFetch } from "../types";
import Icon from "../components/Icon";

export function ExportView({ api }: { api: ApiFetch }) {
  const [excelLoading, setExcelLoading] = useState(false);
  const [sheetId, setSheetId] = useState("");
  const [credsPath, setCredsPath] = useState("");
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsMsg, setSheetsMsg] = useState("");
  const [n8nUrl, setN8nUrl] = useState("http://localhost:5678");
  const [workflowId, setWorkflowId] = useState("");
  const [n8nLoading, setN8nLoading] = useState(false);
  const [n8nMsg, setN8nMsg] = useState("");
  const [crewTickers, setCrewTickers] = useState("");
  const [crewTask, setCrewTask] = useState("full_analysis");
  const [crewLoading, setCrewLoading] = useState(false);
  const [crewResult, setCrewResult] = useState("");

  const exportExcel = async () => {
    setExcelLoading(true);
    try {
      const r = await api("/api/v1/export/excel", { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "portfolio.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Export failed: " + e.message);
    } finally {
      setExcelLoading(false);
    }
  };

  const saveN8nUrl = async () => {
    await api("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "n8n_url", value: n8nUrl }),
    });
  };

  const triggerN8n = async () => {
    if (!workflowId) return;
    setN8nLoading(true);
    setN8nMsg("");
    try {
      const r = await api(`/api/v1/n8n/trigger/${workflowId}`, { method: "POST" });
      const d = await r.json();
      setN8nMsg(`Status ${d.status}: ${d.body?.slice(0, 120) || "OK"}`);
    } catch (e: any) {
      setN8nMsg("Error: " + e.message);
    } finally {
      setN8nLoading(false);
    }
  };

  const pushSheets = async () => {
    if (!sheetId) return;
    setSheetsLoading(true);
    setSheetsMsg("");
    try {
      const r = await api("/api/v1/export/gsheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_id: sheetId, credentials_path: credsPath }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      setSheetsMsg("Synced successfully!");
    } catch (e: any) {
      setSheetsMsg("Error: " + e.message);
    } finally {
      setSheetsLoading(false);
    }
  };

  const runCrew = async () => {
    const tickers = crewTickers.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return;
    setCrewLoading(true);
    setCrewResult("");
    await api("/api/v1/crewai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, task: crewTask }),
    });
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setCrewResult(d?.data?.analysis || d?.msg || "Done");
      setCrewLoading(false);
      window.removeEventListener("crewai-done", h);
    };
    window.addEventListener("crewai-done", h);
    setTimeout(() => setCrewLoading(false), 120000);
  };

  return (
    <div className="ingestion-page scroll">
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Excel Export */}
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Excel Export</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.5 }}>
            Download a .xlsx workbook with four sheets: Portfolio, News, Insights, and Scenarios.
            Colour-coded P&L, all data formatted for analysis.
          </p>
          <button className="btn" onClick={exportExcel} disabled={excelLoading}
                  style={{ background: "var(--green)", color: "var(--green-ink)" }}>
            <Icon name="download" size={14} /> {excelLoading ? "Generating…" : "Download portfolio.xlsx"}
          </button>
        </div>

        {/* Google Sheets */}
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Google Sheets Sync</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.5 }}>
            Push your portfolio and insights to a Google Sheet. Requires a service account JSON credential file.
            <br />
            <span style={{ color: "var(--ink-3)" }}>Setup: Google Cloud → IAM → Service Account → create key → share sheet with service account email.</span>
          </p>
          <div className="col gap-2">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Google Sheet ID</div>
              <input className="input" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                     value={sheetId} onChange={e => setSheetId(e.target.value)} />
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
                Found in the sheet URL: /spreadsheets/d/&lt;ID&gt;/edit
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Service Account Credentials Path</div>
              <input className="input" placeholder="C:\Users\you\credentials.json"
                     value={credsPath} onChange={e => setCredsPath(e.target.value)} />
            </div>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <button className="btn" onClick={pushSheets} disabled={!sheetId || sheetsLoading}>
                <Icon name="upload" size={14} /> {sheetsLoading ? "Syncing…" : "Sync to Sheets"}
              </button>
              {sheetsMsg && <span style={{ fontSize: 12.5, color: sheetsMsg.startsWith("Error") ? "var(--bad)" : "var(--ok)" }}>{sheetsMsg}</span>}
            </div>
          </div>
        </div>

        {/* n8n */}
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>n8n Workflow Trigger</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.5 }}>
            Fire webhooks to your local n8n instance. Create a webhook node in n8n and paste its ID here.
            Use this for price alerts, portfolio digests, Slack notifications, etc.
          </p>
          <div className="col gap-2">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>n8n Base URL</div>
              <div className="row gap-2">
                <input className="input" placeholder="http://localhost:5678"
                       value={n8nUrl} onChange={e => setN8nUrl(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-sm" onClick={saveN8nUrl}>Save</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Webhook / Workflow ID</div>
              <input className="input" placeholder="portfolio-digest or my-custom-workflow"
                     value={workflowId} onChange={e => setWorkflowId(e.target.value)} />
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
                This triggers: {n8nUrl}/webhook/{workflowId || "your-id"}
              </div>
            </div>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <button className="btn" onClick={triggerN8n} disabled={!workflowId || n8nLoading}>
                <Icon name="bolt" size={14} /> {n8nLoading ? "Triggering…" : "Trigger Workflow"}
              </button>
              {n8nMsg && <span style={{ fontSize: 12.5, color: n8nMsg.startsWith("Error") ? "var(--bad)" : "var(--ok)" }}>{n8nMsg}</span>}
            </div>
          </div>
        </div>

        {/* CrewAI */}
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>CrewAI Multi-Agent Analysis</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.5 }}>
            Runs a research crew (Market Analyst + News Analyst + Risk Manager) on selected tickers.
            Falls back to direct LLM if CrewAI is not configured.
          </p>
          <div className="col gap-2">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Tickers (comma or space separated)</div>
              <input className="input" placeholder="AAPL MSFT NVDA"
                     value={crewTickers} onChange={e => setCrewTickers(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Task</div>
              <select className="input" value={crewTask} onChange={e => setCrewTask(e.target.value)}>
                <option value="full_analysis">Full Analysis</option>
                <option value="risk_only">Risk Assessment Only</option>
                <option value="news_impact">News Impact</option>
                <option value="entry_exit">Entry/Exit Points</option>
              </select>
            </div>
            <div>
              <button className="btn" onClick={runCrew} disabled={!crewTickers || crewLoading}>
                <Icon name="bolt" size={14} /> {crewLoading ? "Running crew…" : "Run CrewAI"}
              </button>
            </div>
            {crewLoading && (
              <div className="row gap-2" style={{ color: "var(--ink-3)", fontSize: 13 }}>
                <div className="spinner" /> CrewAI agents working… (this may take 30–90s)
              </div>
            )}
            {crewResult && (
              <div style={{ background: "var(--paper-2)", borderRadius: 8, padding: 14,
                             fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 400,
                             overflowY: "auto", marginTop: 8, border: "1px solid var(--line)" }}>
                {crewResult}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

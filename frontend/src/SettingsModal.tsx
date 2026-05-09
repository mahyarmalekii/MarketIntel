import { useEffect, useState } from "react";
import Icon from "./components/Icon";
import { getJson } from "./api";
import type { ApiFetch } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props { api: ApiFetch; onClose: () => void; }

const PROVIDERS = [
  { value: "anthropic",  label: "Claude (Anthropic)",  keyName: "anthropic_api_key"  },
  { value: "openai",     label: "OpenAI / GPT",        keyName: "openai_api_key"     },
  { value: "gemini",     label: "Google Gemini",       keyName: "gemini_api_key"     },
  { value: "deepseek",   label: "DeepSeek",            keyName: "deepseek_api_key"   },
  { value: "groq",       label: "Groq",                keyName: "groq_api_key"       },
  { value: "mistral",    label: "Mistral",             keyName: "mistral_api_key"    },
  { value: "xai",        label: "xAI / Grok",         keyName: "xai_api_key"        },
  { value: "kimi",       label: "Kimi / Moonshot",    keyName: "kimi_api_key"       },
  { value: "ollama",     label: "Ollama (local)",     keyName: null                 },
] as const;

type Cfg = Record<string, string>;

export default function SettingsModal({ api, onClose }: Props) {
  const [cfg, setCfg] = useState<Cfg>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tgState, setTgState] = useState<"idle" | "detecting" | "ok" | "error">("idle");
  const [tgMsg, setTgMsg] = useState("");

  useEffect(() => {
    getJson<Cfg>(api, "/api/v1/settings")
      .then(d => setCfg(d ?? {}))
      .catch(() => { /* keep defaults — backend may not be ready yet */ });
  }, [api]);

  const set = (k: string, v: string) => setCfg(c => ({ ...c, [k]: v }));

  const save = async () => {
    setSaveState("saving");
    try {
      const results = await Promise.all(
        Object.entries(cfg).map(([key, value]) =>
          api("/api/v1/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, value }),
          })
        )
      );
      const failed = results.filter(r => !r.ok);
      if (failed.length) throw new Error(`${failed.length} setting(s) failed to save`);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  const detectChatId = async () => {
    setTgState("detecting");
    setTgMsg("");
    try {
      const d = await getJson<{ chat_id: string }>(api, "/api/v1/telegram/detect-chat-id", { method: "POST" });
      set("telegram_chat_id", d.chat_id);
      setTgMsg(`Chat ID detected: ${d.chat_id}`);
      setTgState("ok");
    } catch (e: unknown) {
      setTgMsg(e instanceof Error ? e.message : "Error");
      setTgState("error");
    }
  };

  const testTelegram = async () => {
    setTgState("detecting");
    setTgMsg("");
    try {
      const r = await api("/api/v1/telegram/test", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "👋 Market Intel test notification — everything is working!" }),
      });
      if (!r.ok) {
        let detail = r.statusText;
        try { detail = (await r.json()).detail ?? detail; } catch { /* not JSON */ }
        throw new Error(detail);
      }
      setTgMsg("Test message sent!");
      setTgState("ok");
    } catch (e: unknown) {
      setTgMsg(e instanceof Error ? e.message : "Error");
      setTgState("error");
    }
  };

  const prov = cfg.llm_provider || "anthropic";
  const provInfo = PROVIDERS.find(p => p.value === prov);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 100, backdropFilter: "blur(2px)",
        }}
      />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(640px, 94vw)", maxHeight: "88vh",
          background: "var(--paper)", border: "1px solid var(--line)",
          borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          zIndex: 101, overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "18px 24px", borderBottom: "1px solid var(--line)",
            background: "var(--blue-soft)", display: "flex",
            alignItems: "flex-start", justifyContent: "space-between",
          }}
        >
          <div>
            <div className="eyebrow">Configuration</div>
            <h2 style={{ fontSize: 22, marginTop: 2 }}>Settings</h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
              API keys, LLM provider, and preferences
            </div>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="scroll" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* LLM Provider */}
          <div className="card" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>AI / LLM Provider</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  onClick={() => set("llm_provider", p.value)}
                  style={{
                    padding: "9px 12px", borderRadius: 10, textAlign: "left",
                    border: `1px solid ${prov === p.value ? "var(--blue)" : "var(--line)"}`,
                    background: prov === p.value ? "var(--blue-soft)" : "var(--paper-2)",
                    cursor: "pointer", fontSize: 12.5, fontWeight: prov === p.value ? 600 : 400,
                    color: prov === p.value ? "var(--blue-ink)" : "var(--ink)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {provInfo?.keyName && (
              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
                  API Key for {provInfo.label}
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="sk-…"
                  value={cfg[provInfo.keyName] ?? ""}
                  onChange={e => set(provInfo.keyName as string, e.target.value)}
                />
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 4 }}>
                  Stored locally in your database — never sent anywhere except directly to the provider.
                </div>
              </div>
            )}

            {prov === "ollama" && (
              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
                  Ollama Base URL
                </label>
                <input
                  className="input"
                  placeholder="http://localhost:11434"
                  value={cfg.ollama_base_url ?? ""}
                  onChange={e => set("ollama_base_url", e.target.value)}
                />
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
                Model override (optional)
              </label>
              <input
                className="input"
                placeholder="e.g. claude-sonnet-4-5, gpt-4o, gemini-1.5-pro"
                value={cfg.llm_model ?? ""}
                onChange={e => set("llm_model", e.target.value)}
              />
            </div>
          </div>

          {/* n8n */}
          <div className="card" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>n8n Integration</div>
            <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
              n8n Base URL
            </label>
            <input
              className="input"
              placeholder="http://localhost:5678"
              value={cfg.n8n_url ?? ""}
              onChange={e => set("n8n_url", e.target.value)}
            />
          </div>

          {/* Google Sheets */}
          <div className="card" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Google Sheets</div>
            <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Service Account Credentials Path
            </label>
            <input
              className="input"
              placeholder="/path/to/credentials.json"
              value={cfg.gsheets_credentials ?? ""}
              onChange={e => set("gsheets_credentials", e.target.value)}
            />
          </div>

          {/* Telegram */}
          <div className="card" style={{ padding: 18, border: "1px solid var(--blue)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>✈️</span>
              <div className="eyebrow">Telegram Notifications</div>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.55 }}>
              Receive buy/sell signals, bearish/bullish news alerts, and scenario warnings directly in Telegram.
              <br />
              <span style={{ color: "var(--ink-3)" }}>
                First, send any message to <b>@mclawbot_bot</b>, then click "Auto-detect".
              </span>
            </p>

            <div className="col gap-3">
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
                  Bot Token
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="1234567890:AAE…"
                  value={cfg.telegram_bot_token ?? ""}
                  onChange={e => set("telegram_bot_token", e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 5 }}>
                  Your Chat ID
                </label>
                <div className="row gap-2">
                  <input
                    className="input"
                    placeholder="Auto-detected or enter manually"
                    value={cfg.telegram_chat_id ?? ""}
                    onChange={e => set("telegram_chat_id", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-sm"
                    onClick={detectChatId}
                    disabled={tgState === "detecting" || !cfg.telegram_bot_token}
                    title="Reads your chat ID from the latest bot message"
                  >
                    {tgState === "detecting" ? "…" : "Auto-detect"}
                  </button>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
                  Message the bot first, then click Auto-detect. Or find your ID at t.me/userinfobot.
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 8 }}>
                  Notification triggers
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    ["Buy / Sell signals", "confidence ≥ 60%"],
                    ["Bearish / Bullish news", "portfolio tickers only"],
                    ["Scenario impact", "≥ 3% portfolio change"],
                    ["Portfolio proposals", "when AI proposes"],
                  ].map(([label, hint]) => (
                    <div key={label} style={{
                      background: "var(--paper-2)", borderRadius: 8,
                      padding: "8px 10px", border: "1px solid var(--line)",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>✓ {label}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{hint}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="row gap-2" style={{ alignItems: "center" }}>
                <button
                  className="btn"
                  onClick={testTelegram}
                  disabled={tgState === "detecting" || !cfg.telegram_bot_token || !cfg.telegram_chat_id}
                  style={{ fontSize: 12.5 }}
                >
                  Send test message
                </button>
                {tgMsg && (
                  <span style={{
                    fontSize: 12.5,
                    color: tgState === "ok" ? "var(--ok)" : "var(--bad)",
                  }}>
                    {tgMsg}
                  </span>
                )}
              </div>
            </div>
          </div>

        </div>

        <div
          style={{
            padding: "12px 24px", borderTop: "1px solid var(--line)",
            background: "var(--paper-2)", display: "flex",
            justifyContent: "flex-end", gap: 10,
          }}
        >
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={save}
            disabled={saveState === "saving"} style={{ minWidth: 110 }}>
            {saveState === "saved" ? "✓ Saved"
              : saveState === "saving" ? "Saving…"
              : saveState === "error" ? "Error — retry"
              : "Save settings"}
          </button>
        </div>
      </div>
    </>
  );
}

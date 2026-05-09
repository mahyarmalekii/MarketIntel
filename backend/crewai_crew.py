"""
Intel Crew — 12 specialized agents, parallel execution groups, token-efficient context.

Execution phases (agents in same phase run in parallel threads):
  Phase 1 [parallel]:  Political Intel · Social Sentiment · Technical Patterns
  Phase 2 [parallel]:  Macro Economist · Options & Dark Pool
  Phase 3 [parallel]:  Equity Analyst · Sector Rotation
  Phase 4 [parallel]:  Prediction Arbitrageur · Earnings & Catalysts · Alternative Data
  Phase 5 [sequential]: Risk Manager → Intelligence Synthesizer

Token efficiency strategy:
  • Context is pre-compressed to 1-line facts (10x smaller than raw)
  • Each agent outputs compact structured JSON, not prose
  • Agents in later phases receive only upstream JSON summaries
  • Prompts are purposefully terse — every word earns its place
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed, wait, FIRST_COMPLETED
from typing import Any

import db
import market as mkt
from llm import call_raw_with_fallback
from logger import get_logger

_log = get_logger(__name__)

try:
    from crewai import Agent, Task, Crew, Process
    _HAS_CREWAI = True
except ImportError:
    _HAS_CREWAI = False

# ─── Token-efficient context compression ─────────────────────────────────────

def _compress_news(items: list[dict], n: int = 10) -> str:
    """Compress news to 1-line facts. ~10 tokens each vs ~80 for raw text."""
    SYM = {"bullish": "+", "bearish": "−", "neutral": "~"}
    out = []
    for item in items[:n]:
        sym    = SYM.get(item.get("sentiment", "neutral"), "~")
        title  = (item.get("title") or "")[:90]
        source = (item.get("source") or "")[:18]
        out.append(f"{sym} {title} [{source}]")
    return "\n".join(out) or "(none)"


def _compress_portfolio(holdings: list[dict], quotes: dict) -> str:
    """Single-line per holding. ~15 tokens each vs ~50 for formatted text."""
    lines = []
    for h in holdings[:12]:
        t      = h.get("ticker", "")
        q      = quotes.get(t, {})
        price  = float(q.get("last_price") or h.get("avg_cost") or 0)
        cost   = float(h.get("avg_cost") or 0)
        shares = float(h.get("shares") or 0)
        pnl    = ((price - cost) / cost * 100) if cost else 0
        sector = (q.get("sector") or "?")[:10]
        pe     = q.get("pe_ratio", "?")
        beta   = q.get("beta", "?")
        cap    = q.get("market_cap_tier", "?")
        lines.append(
            f"{t}:{shares:.0f}sh|cost${cost:.0f}|now${price:.0f}({pnl:+.0f}%)"
            f"|{sector}|pe{pe}|β{beta}|{cap}"
        )
    return "\n".join(lines) or "(empty portfolio)"


def _gather_and_compress(tickers: list[str]) -> tuple[dict, dict]:
    """Fetch all data and return both raw ctx and compressed cctx."""
    quotes: dict[str, Any] = {}
    for t in tickers[:10]:
        q = mkt.get_quote(t)
        if "error" not in q:
            quotes[t] = q

    holdings = db.list_holdings()
    all_news  = db.get_news(limit=80)

    # Domain-classify news
    pol_kw  = {"trump","biden","harris","congress","senate","election","white house","fed","powell",
               "treasury","policy","regulation","tariff","sanction","ukraine","china","nato","war","geopolit"}
    spt_kw  = {"nfl","nba","mlb","nhl","soccer","football","tennis","ufc","mma","boxing","f1",
               "formula","championship","draft","transfer","injury","match","tournament"}
    mac_kw  = {"inflation","cpi","pce","gdp","rate","yield","recession","ecb","boe","dollar",
               "euro","yen","oil","gold","copper","commodity","credit","spread","vix"}
    soc_kw  = {"reddit","wallstreetbets","wsb","retail","short squeeze","meme","sentiment",
               "twitter","x.com","trending","viral","unusual_whales","dark pool","options flow"}

    domains: dict[str, list] = {"politics": [], "macro": [], "sports": [], "social": [], "market": []}
    for item in all_news:
        txt = (item.get("title","") + " " + item.get("source","")).lower()
        if any(k in txt for k in soc_kw):   domains["social"].append(item)
        elif any(k in txt for k in pol_kw): domains["politics"].append(item)
        elif any(k in txt for k in mac_kw): domains["macro"].append(item)
        elif any(k in txt for k in spt_kw): domains["sports"].append(item)
        else:                               domains["market"].append(item)

    total_value = sum(
        float(h.get("shares",0) or 0) * float(h.get("avg_cost",0) or 0)
        for h in holdings
    )

    ctx = {
        "quotes": quotes, "holdings": holdings,
        "total_value": total_value, "tickers": tickers,
        **{f"news_{k}": v for k, v in domains.items()},
    }
    cctx = {
        "portfolio":     _compress_portfolio(holdings, quotes),
        "total_value":   total_value,
        "news_politics": _compress_news(domains["politics"], 10),
        "news_macro":    _compress_news(domains["macro"], 10),
        "news_sports":   _compress_news(domains["sports"], 8),
        "news_social":   _compress_news(domains["social"], 8),
        "news_market":   _compress_news(domains["market"], 10),
    }
    return ctx, cctx


# ─── Parallel LLM execution ───────────────────────────────────────────────────

def _llm(system: str, user: str) -> str:
    return call_raw_with_fallback(system, user)


def _parallel(*calls: tuple[str, str]) -> list[str]:
    """Run multiple LLM calls concurrently. Returns results in order."""
    results = [None] * len(calls)  # type: ignore
    with ThreadPoolExecutor(max_workers=min(len(calls), 4)) as pool:
        fmap = {pool.submit(_llm, s, u): i for i, (s, u) in enumerate(calls)}
        for f in as_completed(fmap):
            results[fmap[f]] = f.result() or ""
    return results  # type: ignore


def _json_extract(text: str) -> dict:
    """Extract first JSON object from LLM response."""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {"raw": text[:500]}


def _arr_extract(text: str) -> list:
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return []


# ─── Agent system prompts (terse role definitions) ───────────────────────────

_SYS = {
    "political": (
        "You are a political risk analyst at a macro hedge fund. "
        "Output compact JSON only. No prose."
    ),
    "sentiment": (
        "You are a social sentiment and crowd psychology analyst. "
        "Output compact JSON only. No prose."
    ),
    "technical": (
        "You are a technical analyst (CMT). Output compact JSON only. No prose."
    ),
    "macro": (
        "You are a PhD macro economist, ex-Fed. "
        "Output compact JSON only. No prose."
    ),
    "options": (
        "You are an options flow and dark pool specialist. "
        "Output compact JSON only. No prose."
    ),
    "equity": (
        "You are a senior equity analyst, CFA, 15yr experience. "
        "Output compact JSON only. No prose."
    ),
    "sector": (
        "You are a sector rotation strategist. "
        "Output compact JSON only. No prose."
    ),
    "prediction": (
        "You are a professional prediction market trader. "
        "Output compact JSON only. No prose."
    ),
    "earnings": (
        "You are an earnings intelligence specialist tracking catalysts. "
        "Output compact JSON only. No prose."
    ),
    "altdata": (
        "You are an alternative data analyst (credit, commodities, currencies, shipping). "
        "Output compact JSON only. No prose."
    ),
    "risk": (
        "You are a quant CRO who treats all risk as interconnected. "
        "Output compact JSON only. No prose."
    ),
    "synth": (
        "You are a senior PM synthesizing multi-agent intelligence into an action brief. "
        "Output compact JSON only. No prose. Fill all numeric fields with real estimates."
    ),
}

# ─── Compact output schemas (fed to each agent) ──────────────────────────────

_SCHEMA = {
    "political": '{"sector_impacts":{"SECTOR":{"score":-10,"timeline":"","reason":""}},"prediction_mispricings":[""],"tail_risks":[""]}',
    "sentiment": '{"overall_sentiment":"bullish|bearish|neutral","fear_greed":0,"retail_crowded_longs":[""],"retail_crowded_shorts":[""],"viral_themes":[""],"contrarian_signals":[""]}',
    "technical": '{"signals":[{"ticker":"","pattern":"","signal":"BUY|SELL|HOLD","rsi":0,"support":0,"resistance":0,"momentum":"bullish|bearish|neutral"}]}',
    "macro":     '{"rate_outlook":"hiking|pausing|cutting","inflation":"rising|falling|stable","risk_posture":"risk-on|risk-off|neutral","favored_sectors":[""],"avoid_sectors":[""],"currency_signal":"USD_strong|USD_weak|neutral","recession_prob":0}',
    "options":   '{"unusual_activity":[{"ticker":"","type":"calls|puts","magnitude":"large|moderate","implication":""}],"put_call_skew":"bearish|neutral|bullish","dark_pool_sentiment":"accumulating|distributing|neutral","top_tickers_with_flow":[""]}',
    "equity":    '[{"ticker":"","action":"BUY|SELL|HOLD|REDUCE","current_price":0,"target":0,"stop":0,"upside_pct":0,"entry":0,"confidence":0,"horizon":"days|weeks|months","catalyst":"","macro_link":""}]',
    "sector":    '{"rotation_into":[""],"rotation_out_of":[""],"top_sector_etfs":[{"etf":"","signal":"BUY|SELL","rationale":""}],"cycle_phase":"early|mid|late|recession"}',
    "prediction":'[{"question":"","platform":"","current_price":0,"fair_value":0,"edge_pct":0,"position":"YES|NO","confidence":0,"linked_equity":"","rationale":""}]',
    "earnings":  '[{"ticker":"","event":"earnings|dividend|guidance|spinoff|merger","date":"","expected_move_pct":0,"positioning":"long|short|neutral","catalyst_quality":"high|medium|low","note":""}]',
    "altdata":   '{"oil_signal":"bullish|bearish|neutral","gold_signal":"bullish|bearish|neutral","yield_curve":"normal|flat|inverted","credit_spreads":"tightening|widening|stable","shipping":"expanding|contracting|stable","macro_regime_confirm":"risk-on|risk-off|mixed"}',
    "risk":      '{"overall_risk":0,"portfolio_health":"STRONG|MODERATE|WEAK|CRITICAL","concentration_risk":"low|medium|high","tail_scenario":{"description":"","est_drawdown_pct":0},"hedges":[{"instrument":"","sizing_pct":0,"rationale":""}],"stop_losses":[{"ticker":"","stop_price":0}],"key_risk_factors":[""]}',
    "synth":     '{"regime_summary":"","overall_risk_level":0,"portfolio_health":"","equity_signals":[{"ticker":"","signal":"BUY|SELL|HOLD|REDUCE","current_price":0,"target_price":0,"stop_loss":0,"upside_pct":0,"confidence":0,"time_horizon":"","cross_domain_driver":"","entry_level":0}],"prediction_bets":[{"question":"","platform":"","current_yes_price":0,"fair_value":0,"edge_pct":0,"position":"YES|NO","confidence":0,"linked_equity":"","rationale":""}],"hedges":[{"instrument":"","sizing_pct":0,"rationale":""}],"macro_calls":[{"theme":"","direction":"bullish|bearish|neutral","affected_assets":[],"confidence":0}],"political_alerts":[{"event":"","market_impact":"","impact_score":0,"timeline":""}],"earnings_watch":[{"ticker":"","event":"","date":"","play":""}],"sector_rotation":{"into":[],"out_of":[]},"top_3_actions":["","",""],"watch_list":[]}',
}


# ─── Direct-LLM 12-agent chain (parallel groups) ─────────────────────────────

def _run_direct_chain(cctx: dict, tickers: list[str]) -> dict[str, Any]:
    port  = cctx["portfolio"]
    tval  = cctx["total_value"]
    pol_n = cctx["news_politics"]
    mac_n = cctx["news_macro"]
    spt_n = cctx["news_sports"]
    soc_n = cctx["news_social"]
    mkt_n = cctx["news_market"]
    ts    = ", ".join(tickers) or "(from portfolio)"

    # ── Phase 1: Political · Sentiment · Technical (parallel) ─────────────
    _log.info("Intel Crew Phase 1 — Political + Sentiment + Technical (parallel)")
    p1a, p1b, p1c = _parallel(
        (
            _SYS["political"],
            f"Political/geopolitical news → sector impacts + prediction market mispricings.\n"
            f"NEWS:\n{pol_n}\nSPORTS:\n{spt_n}\n"
            f"Return JSON: {_SCHEMA['political']}"
        ),
        (
            _SYS["sentiment"],
            f"Social/retail sentiment → fear/greed + crowded trades + contrarian signals.\n"
            f"NEWS:\n{soc_n}\nMARKET:\n{mkt_n}\n"
            f"Return JSON: {_SCHEMA['sentiment']}"
        ),
        (
            _SYS["technical"],
            f"Technical patterns for these tickers: {ts}\n"
            f"MARKET NEWS:\n{mkt_n}\n"
            f"Estimate RSI/support/resistance from price action context.\n"
            f"Return JSON: {_SCHEMA['technical']}"
        ),
    )
    pol_out  = _json_extract(p1a)
    sent_out = _json_extract(p1b)
    tech_out = _json_extract(p1c)

    # ── Phase 2: Macro · Options (parallel, uses Phase 1) ─────────────────
    _log.info("Intel Crew Phase 2 — Macro + Options (parallel)")
    p2a, p2b = _parallel(
        (
            _SYS["macro"],
            f"Build macro regime using political signals and macro news.\n"
            f"POLITICAL: {json.dumps(pol_out)[:400]}\n"
            f"MACRO NEWS:\n{mac_n}\n"
            f"Return JSON: {_SCHEMA['macro']}"
        ),
        (
            _SYS["options"],
            f"Identify options/dark-pool signals from social + market context.\n"
            f"SENTIMENT: {json.dumps(sent_out)[:400]}\n"
            f"MARKET NEWS:\n{mkt_n}\n"
            f"Return JSON: {_SCHEMA['options']}"
        ),
    )
    macro_out = _json_extract(p2a)
    opts_out  = _json_extract(p2b)

    # ── Phase 3: Equity · Sector Rotation (parallel, uses Phases 1-2) ─────
    _log.info("Intel Crew Phase 3 — Equity + Sector Rotation (parallel)")
    upstream_3 = (
        f"MACRO:{json.dumps(macro_out)[:350]} "
        f"TECHNICAL:{json.dumps(tech_out)[:350]} "
        f"OPTIONS:{json.dumps(opts_out)[:300]}"
    )
    p3a, p3b = _parallel(
        (
            _SYS["equity"],
            f"Per-stock signals with price targets grounded in real data.\n"
            f"PORTFOLIO:\n{port}\n"
            f"UPSTREAM: {upstream_3}\n"
            f"MARKET NEWS:\n{mkt_n}\n"
            f"Return JSON array: {_SCHEMA['equity']}"
        ),
        (
            _SYS["sector"],
            f"Sector rotation signals given macro regime.\n"
            f"MACRO: {json.dumps(macro_out)[:400]}\n"
            f"POLITICAL: {json.dumps(pol_out)[:300]}\n"
            f"Return JSON: {_SCHEMA['sector']}"
        ),
    )
    equity_out = _arr_extract(p3a) or _json_extract(p3a)
    sector_out = _json_extract(p3b)

    # ── Phase 4: Prediction · Earnings · AltData (parallel) ───────────────
    _log.info("Intel Crew Phase 4 — Prediction + Earnings + AltData (parallel)")
    upstream_4 = (
        f"MACRO:{json.dumps(macro_out)[:300]} "
        f"POLITICAL:{json.dumps(pol_out)[:300]} "
        f"EQUITY:{json.dumps(equity_out)[:300]}"
    )
    p4a, p4b, p4c = _parallel(
        (
            _SYS["prediction"],
            f"Find mispriced prediction markets using all upstream signals.\n"
            f"UPSTREAM: {upstream_4}\n"
            f"SPORTS:\n{spt_n}\n"
            f"Return JSON array: {_SCHEMA['prediction']}"
        ),
        (
            _SYS["earnings"],
            f"Identify upcoming earnings/events as catalysts for portfolio holdings.\n"
            f"TICKERS: {ts}\n"
            f"MARKET NEWS:\n{mkt_n}\n"
            f"MACRO: {json.dumps(macro_out)[:300]}\n"
            f"Return JSON array: {_SCHEMA['earnings']}"
        ),
        (
            _SYS["altdata"],
            f"Alternative data regime confirmation: commodities, credit, currencies.\n"
            f"MACRO NEWS:\n{mac_n}\n"
            f"POLITICAL: {json.dumps(pol_out)[:300]}\n"
            f"Return JSON: {_SCHEMA['altdata']}"
        ),
    )
    pred_out     = _arr_extract(p4a)
    earnings_out = _arr_extract(p4b)
    altdata_out  = _json_extract(p4c)

    # ── Phase 5a: Risk Manager (sequential, uses all above) ───────────────
    _log.info("Intel Crew Phase 5 — Risk Manager")
    all_upstream = (
        f"MACRO:{json.dumps(macro_out)[:250]} "
        f"POLITICAL:{json.dumps(pol_out)[:200]} "
        f"EQUITY:{json.dumps(equity_out)[:250]} "
        f"OPTIONS:{json.dumps(opts_out)[:200]} "
        f"ALTDATA:{json.dumps(altdata_out)[:200]} "
        f"SENTIMENT:{json.dumps(sent_out)[:200]}"
    )
    risk_raw  = _llm(
        _SYS["risk"],
        f"Full portfolio risk assessment using ALL agent outputs.\n"
        f"PORTFOLIO:\n{port}\nTOTAL VALUE: ${tval:,.0f}\n"
        f"UPSTREAM: {all_upstream}\n"
        f"Return JSON: {_SCHEMA['risk']}"
    )
    risk_out = _json_extract(risk_raw)

    # ── Phase 5b: Intelligence Synthesizer ────────────────────────────────
    _log.info("Intel Crew Phase 6 — Intelligence Synthesizer")
    synth_raw = _llm(
        _SYS["synth"],
        f"Synthesize 12-agent analysis into final actionable brief.\n"
        f"POLITICAL:{json.dumps(pol_out)[:200]}\n"
        f"SENTIMENT:{json.dumps(sent_out)[:200]}\n"
        f"TECHNICAL:{json.dumps(tech_out)[:200]}\n"
        f"MACRO:{json.dumps(macro_out)[:200]}\n"
        f"OPTIONS:{json.dumps(opts_out)[:200]}\n"
        f"EQUITY:{json.dumps(equity_out)[:300]}\n"
        f"SECTOR:{json.dumps(sector_out)[:200]}\n"
        f"PREDICTIONS:{json.dumps(pred_out)[:300]}\n"
        f"EARNINGS:{json.dumps(earnings_out)[:200]}\n"
        f"ALTDATA:{json.dumps(altdata_out)[:200]}\n"
        f"RISK:{json.dumps(risk_out)[:300]}\n"
        f"PORTFOLIO:\n{port}\n"
        f"Return JSON: {_SCHEMA['synth']}"
    )
    synth_out = _json_extract(synth_raw)

    return {
        "source":       "direct_llm_12agent",
        "agents_used":  12,
        "tickers":      tickers,
        "result":       synth_out,
        "agent_outputs": {
            "political":   pol_out,
            "sentiment":   sent_out,
            "technical":   tech_out,
            "macro":       macro_out,
            "options":     opts_out,
            "equity":      equity_out,
            "sector":      sector_out,
            "predictions": pred_out,
            "earnings":    earnings_out,
            "altdata":     altdata_out,
            "risk":        risk_out,
        },
    }


# ─── CrewAI path (12 agents, sequential process with context passing) ─────────

def _run_crew(cctx: dict, tickers: list[str]) -> dict:
    provider = db.get_setting("llm_provider") or "anthropic"
    model    = db.get_setting(f"{provider}_model") or ""
    api_key  = db.get_setting(f"{provider}_api_key") or ""
    import os
    if provider == "anthropic":
        if api_key: os.environ["ANTHROPIC_API_KEY"] = api_key
        llm = f"anthropic/{model or 'claude-sonnet-4-6'}"
    elif provider == "openai":
        if api_key: os.environ["OPENAI_API_KEY"] = api_key
        llm = model or "gpt-4o"
    else:
        llm = model or "anthropic/claude-sonnet-4-6"

    port  = cctx["portfolio"]
    tval  = cctx["total_value"]
    ts    = ", ".join(tickers)

    def mk_agent(role: str, goal: str, backstory: str) -> "Agent":
        return Agent(role=role, goal=goal, backstory=backstory,
                     llm=llm, verbose=False, allow_delegation=False)

    agents = {
        "pol":  mk_agent("Political Intelligence Officer",
            "Map every political/geopolitical event to sector impact scores and prediction market mispricings.",
            "20yr CIA political risk analyst, now head of geo-intelligence at a macro fund."),
        "sent": mk_agent("Social Sentiment Oracle",
            "Decode retail/social sentiment: fear-greed level, crowded trades, contrarian signals.",
            "Behavioural finance PhD, quant sentiment signals for hedge funds since 2010."),
        "tech": mk_agent("Technical Pattern Analyst",
            "Identify key technical patterns, RSI, support/resistance for portfolio tickers.",
            "CMT charterholder, 18yr technical analysis across equities and crypto."),
        "mac":  mk_agent("Macro Economist",
            "Synthesize political + macro signals into regime: rates, inflation, sector rotation.",
            "PhD economist, ex-Fed senior economist, now chief economist at a global AM."),
        "opts": mk_agent("Options & Dark Pool Decoder",
            "Identify unusual options activity and dark pool signals indicating smart money positioning.",
            "15yr options market maker, now runs vol-arb desk at a quant fund."),
        "eq":   mk_agent("Senior Equity Analyst",
            "Per-stock BUY/SELL/HOLD with price targets, entries, stops, cross-domain drivers.",
            "CFA, 15yr sell-side, covered tech/energy/financials across multiple cycles."),
        "sec":  mk_agent("Sector Rotation Strategist",
            "Identify optimal sector rotation given macro regime and political signals.",
            "GICS sector specialist, runs sector rotation models at a $10B fund."),
        "pred": mk_agent("Prediction Market Arbitrageur",
            "Find mispricings in prediction markets via cross-domain intelligence.",
            "Professional Polymarket/Kalshi trader since 2021, 60%+ win rate."),
        "earn": mk_agent("Earnings & Catalyst Strategist",
            "Identify upcoming earnings and events as high-impact portfolio catalysts.",
            "10yr event-driven PM, specialises in earnings drift and guidance surprises."),
        "alt":  mk_agent("Alternative Data Analyst",
            "Confirm macro regime via oil, gold, credit spreads, yield curve, shipping.",
            "Alt-data quant, builds signals from commodity, FX, and credit markets."),
        "risk": mk_agent("Chief Risk Officer",
            "Full portfolio risk assessment: concentration, tail, political, macro, with specific hedges.",
            "18yr quant risk manager, VaR and scenario models for billion-dollar books."),
        "syn":  mk_agent("Intelligence Synthesizer",
            "Synthesize all 11 agent outputs into final JSON action brief with real numbers.",
            "20yr senior PM, $20B multi-strategy fund, turns research into actual trades."),
    }

    T = {}
    T["pol"]  = Task(description=f"Analyze political/geopolitical news.\nNEWS:{cctx['news_politics']}\nSPORTS:{cctx['news_sports']}\nReturn JSON:{_SCHEMA['political']}",  expected_output="Political impact JSON",  agent=agents["pol"])
    T["sent"] = Task(description=f"Analyze social sentiment.\nSOCIAL:{cctx['news_social']}\nMARKET:{cctx['news_market']}\nReturn JSON:{_SCHEMA['sentiment']}", expected_output="Sentiment JSON",  agent=agents["sent"])
    T["tech"] = Task(description=f"Technical patterns for {ts}.\nNEWS:{cctx['news_market']}\nReturn JSON:{_SCHEMA['technical']}", expected_output="Technical signals JSON", agent=agents["tech"])
    T["mac"]  = Task(description=f"Macro regime.\nMACRO NEWS:{cctx['news_macro']}\nPORTFOLIO:{port}\nReturn JSON:{_SCHEMA['macro']}", expected_output="Macro JSON", agent=agents["mac"],  context=[T["pol"]])
    T["opts"] = Task(description=f"Options/dark pool signals.\nMARKET:{cctx['news_market']}\nReturn JSON:{_SCHEMA['options']}", expected_output="Options JSON", agent=agents["opts"], context=[T["sent"]])
    T["eq"]   = Task(description=f"Per-stock signals.\nPORTFOLIO:{port}\nReturn JSON array:{_SCHEMA['equity']}", expected_output="Equity JSON", agent=agents["eq"],  context=[T["mac"], T["tech"], T["opts"]])
    T["sec"]  = Task(description=f"Sector rotation.\nReturn JSON:{_SCHEMA['sector']}", expected_output="Sector JSON", agent=agents["sec"], context=[T["mac"], T["pol"]])
    T["pred"] = Task(description=f"Mispriced prediction markets.\nSPORTS:{cctx['news_sports']}\nReturn JSON array:{_SCHEMA['prediction']}", expected_output="Predictions JSON", agent=agents["pred"], context=[T["pol"], T["mac"], T["eq"]])
    T["earn"] = Task(description=f"Earnings/catalyst calendar for {ts}.\nNEWS:{cctx['news_market']}\nReturn JSON array:{_SCHEMA['earnings']}", expected_output="Earnings JSON", agent=agents["earn"], context=[T["mac"], T["eq"]])
    T["alt"]  = Task(description=f"Alt data regime confirmation.\nMACRO:{cctx['news_macro']}\nReturn JSON:{_SCHEMA['altdata']}", expected_output="AltData JSON", agent=agents["alt"],  context=[T["mac"]])
    T["risk"] = Task(description=f"Full risk assessment.\nPORTFOLIO:{port}\nVALUE:${tval:,.0f}\nReturn JSON:{_SCHEMA['risk']}", expected_output="Risk JSON", agent=agents["risk"], context=list(T.values()))
    T["syn"]  = Task(description=f"Final synthesis.\nPORTFOLIO:{port}\nReturn JSON:{_SCHEMA['synth']}", expected_output="Final JSON brief", agent=agents["syn"],  context=list(T.values()))

    try:
        crew   = Crew(agents=list(agents.values()), tasks=list(T.values()),
                      process=Process.sequential, verbose=False)
        raw    = str(crew.kickoff())
        result = _json_extract(raw)
        return {"source": "crewai_12agent", "agents_used": 12,
                "tickers": tickers, "result": result}
    except Exception as e:
        _log.warning("CrewAI failed (%s), falling back to direct chain", e)
        return _run_direct_chain(cctx, tickers)


# ─── Public entry points ──────────────────────────────────────────────────────

def run_intel_crew(tickers: list[str], task: str = "full_cross_analysis") -> dict:
    """Run the full 12-agent Intel Crew. Returns structured result dict."""
    ctx, cctx = _gather_and_compress(tickers)
    if _HAS_CREWAI:
        return _run_crew(cctx, tickers or list(ctx["quotes"].keys()))
    return _run_direct_chain(cctx, tickers or list(ctx["quotes"].keys()))


def run_market_crew(tickers: list[str], task: str = "full_analysis") -> dict:
    """Backwards-compatible alias."""
    return run_intel_crew(tickers, task)


def crew_ready_status() -> dict:
    """Check whether the crew is configured and ready to run."""
    from llm import _resolve  # type: ignore

    provider, api_key, model = _resolve()
    has_key      = bool(api_key)
    holdings     = db.list_holdings()
    news         = db.get_news(limit=5)

    issues: list[str] = []
    if not has_key:
        issues.append(f"No API key found for provider '{provider}'. Set it in Settings.")
    if not holdings:
        issues.append("Portfolio is empty — add holdings so agents have stocks to analyze.")
    if not news:
        issues.append("No news cached — click 'Refresh News' to populate the news feed.")

    return {
        "ready":           len(issues) == 0,
        "issues":          issues,
        "agent_count":     12,
        "has_crewai":      _HAS_CREWAI,
        "llm_provider":    provider,
        "llm_model":       model,
        "has_llm_key":     has_key,
        "portfolio_size":  len(holdings),
        "news_items":      len(db.get_news(limit=200)),
        "parallel_phases": 4,
    }

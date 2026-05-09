"""n8n webhook bridge — fires POST requests to n8n workflows.

Workflow IDs (configure these in your n8n instance):
  portfolio-digest          Daily portfolio summary
  price-alert               Single-ticker price threshold crossed
  cross-analysis-complete   Full 6-agent intel crew finished — rich payload
  high-conviction-signal    Equity signal with confidence >= 75
  prediction-bet-alert      Prediction market bet with edge >= 10%
  political-market-alert    Political event with sector impact >= 7
  risk-alert                Portfolio risk level >= 8
  news-sentiment-spike      Bearish/bullish sentiment spike on a held ticker
"""
from __future__ import annotations

import httpx
import db
from logger import get_logger

_log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


async def _fire(workflow_id: str, payload: dict) -> dict:
    base = (db.get_setting("n8n_url") or "http://localhost:5678").rstrip("/")
    url  = f"{base}/webhook/{workflow_id}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(url, json=payload)
        _log.info("n8n %s → %s", workflow_id, r.status_code)
        return {"status": r.status_code, "body": r.text[:500]}
    except Exception as e:
        _log.warning("n8n %s failed: %s", workflow_id, e)
        return {"status": 0, "error": str(e)}


# ─── Original workflows (backwards compatible) ────────────────────────────────

async def trigger_workflow(workflow_id: str, payload: dict | None = None) -> dict:
    return await _fire(workflow_id, payload or {})


async def send_portfolio_digest(portfolio: dict) -> dict:
    return await _fire("portfolio-digest", portfolio)


async def send_price_alert(ticker: str, price: float, threshold: float) -> dict:
    return await _fire("price-alert", {
        "ticker": ticker, "price": price, "threshold": threshold,
    })


# ─── New cross-analysis workflows ─────────────────────────────────────────────

async def send_cross_analysis_complete(result: dict) -> dict:
    """Fire when the 6-agent intel crew completes. Sends the full structured result."""
    r = result.get("result", {})
    return await _fire("cross-analysis-complete", {
        "source":          result.get("source", "unknown"),
        "agents_used":     result.get("agents_used", 0),
        "tickers":         result.get("tickers", []),
        "regime_summary":  r.get("regime_summary", ""),
        "overall_risk":    r.get("overall_risk_level", 0),
        "portfolio_health":r.get("portfolio_health", ""),
        "top_3_actions":   r.get("top_3_actions", []),
        "equity_signals":  r.get("equity_signals", []),
        "prediction_bets": r.get("prediction_bets", []),
        "hedges":          r.get("hedges", []),
        "political_alerts":r.get("political_alerts", []),
    })


async def send_high_conviction_signals(result: dict) -> list[dict]:
    """Fire individual alerts for equity signals with confidence >= 75."""
    signals = result.get("result", {}).get("equity_signals", [])
    fired: list[dict] = []
    for s in signals:
        if (s.get("confidence") or 0) >= 75:
            resp = await _fire("high-conviction-signal", {
                "ticker":             s.get("ticker"),
                "signal":             s.get("signal"),
                "current_price":      s.get("current_price"),
                "target_price":       s.get("target_price"),
                "stop_loss":          s.get("stop_loss"),
                "upside_pct":         s.get("upside_pct"),
                "confidence":         s.get("confidence"),
                "time_horizon":       s.get("time_horizon"),
                "cross_domain_driver":s.get("cross_domain_driver"),
                "entry_level":        s.get("entry_level"),
            })
            fired.append(resp)
    return fired


async def send_prediction_bet_alerts(result: dict) -> list[dict]:
    """Fire alerts for prediction bets with edge >= 10%."""
    bets = result.get("result", {}).get("prediction_bets", [])
    fired: list[dict] = []
    for b in bets:
        if (b.get("edge_pct") or 0) >= 10:
            resp = await _fire("prediction-bet-alert", {
                "question":         b.get("question"),
                "platform":         b.get("platform"),
                "current_yes_price":b.get("current_yes_price"),
                "fair_value":       b.get("fair_value"),
                "edge_pct":         b.get("edge_pct"),
                "position":         b.get("position"),
                "confidence":       b.get("confidence"),
                "linked_equity":    b.get("linked_equity"),
                "rationale":        b.get("rationale"),
            })
            fired.append(resp)
    return fired


async def send_political_alerts(result: dict) -> list[dict]:
    """Fire alerts for political events with sector impact >= 7."""
    alerts = result.get("result", {}).get("political_alerts", [])
    fired: list[dict] = []
    for a in alerts:
        if abs(a.get("impact_score") or 0) >= 7:
            resp = await _fire("political-market-alert", {
                "event":         a.get("event"),
                "market_impact": a.get("market_impact"),
                "impact_score":  a.get("impact_score"),
                "timeline":      a.get("timeline"),
            })
            fired.append(resp)
    return fired


async def send_risk_alert(result: dict) -> dict | None:
    """Fire risk alert when overall risk level >= 8."""
    risk = result.get("result", {}).get("overall_risk_level", 0)
    if risk >= 8:
        return await _fire("risk-alert", {
            "overall_risk_level": risk,
            "portfolio_health":   result.get("result", {}).get("portfolio_health"),
            "hedges":             result.get("result", {}).get("hedges", []),
            "top_3_actions":      result.get("result", {}).get("top_3_actions", []),
        })
    return None


async def dispatch_all_alerts(result: dict) -> dict:
    """Convenience: fire all relevant n8n alerts from a single crew result."""
    responses: dict = {}

    responses["cross_analysis"] = await send_cross_analysis_complete(result)
    responses["high_conviction"] = await send_high_conviction_signals(result)
    responses["prediction_bets"] = await send_prediction_bet_alerts(result)
    responses["political"]       = await send_political_alerts(result)
    risk_resp = await send_risk_alert(result)
    if risk_resp:
        responses["risk_alert"] = risk_resp

    total_fired = (
        1
        + len(responses["high_conviction"])
        + len(responses["prediction_bets"])
        + len(responses["political"])
        + (1 if risk_resp else 0)
    )
    responses["total_workflows_triggered"] = total_fired
    return responses

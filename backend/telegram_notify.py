"""
Telegram notification module.

Bot token is read from:
  1. TELEGRAM_BOT_TOKEN env var
  2. DB setting "telegram_bot_token"

Chat ID is stored in DB setting "telegram_chat_id".
Call `get_my_chat_id()` once to auto-detect it from recent /start messages.
"""
import asyncio
import os
import httpx
from logger import get_logger

_log = get_logger(__name__)

_BOT_TOKEN_ENV = os.environ.get("TELEGRAM_BOT_TOKEN", "")
_BASE = "https://api.telegram.org/bot{token}/{method}"


def _token(db_token: str = "") -> str:
    return _BOT_TOKEN_ENV or db_token or ""


async def send_message(chat_id: str, text: str, token: str = "", parse_mode: str = "HTML") -> bool:
    """Send a Telegram message. Returns True on success."""
    tok = _token(token)
    if not tok or not chat_id:
        _log.debug("Telegram: no token or chat_id — skipping")
        return False
    url = _BASE.format(token=tok, method="sendMessage")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            })
        if not r.is_success:
            _log.warning("Telegram sendMessage failed: %s", r.text)
            return False
        return True
    except Exception as e:
        _log.error("Telegram error: %s", e)
        return False


async def get_chat_id(token: str = "") -> str | None:
    """
    Fetch the most recent chat_id from bot updates.
    The user must have sent at least one message to the bot first.
    """
    tok = _token(token)
    if not tok:
        return None
    url = _BASE.format(token=tok, method="getUpdates")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params={"limit": 10, "offset": -10})
        data = r.json()
        updates = data.get("result", [])
        if not updates:
            return None
        # Return chat_id from the most recent message
        for upd in reversed(updates):
            msg = upd.get("message") or upd.get("channel_post")
            if msg:
                return str(msg["chat"]["id"])
    except Exception as e:
        _log.error("Telegram getUpdates: %s", e)
    return None


# ─── Pre-formatted message builders ─────────────────────────────────────────

def fmt_insight(ticker: str, action: str, confidence: int, rationale: str,
                target_price=None, bull_case: str = "", bear_case: str = "") -> str:
    action_emoji = {"buy": "🟢", "sell": "🔴", "hold": "🟡", "watch": "🔵"}.get(action, "⚪")
    lines = [
        f"{action_emoji} <b>Market Intel · {ticker}</b>",
        f"<b>Signal:</b> {action.upper()}  <b>Confidence:</b> {confidence}%",
        "",
        f"<b>Rationale:</b> {rationale}",
    ]
    if target_price:
        lines.append(f"<b>Target price:</b> ${target_price:,.2f}")
    if bull_case:
        lines.append(f"📈 <b>Bull case:</b> {bull_case}")
    if bear_case:
        lines.append(f"📉 <b>Bear case:</b> {bear_case}")
    return "\n".join(lines)


def fmt_news(title: str, source: str, sentiment: str, tickers: list[str], url: str = "") -> str:
    sentiment_emoji = {"bullish": "📈", "bearish": "📉", "neutral": "📰"}.get(sentiment, "📰")
    tickers_str = " ".join(f"${t}" for t in tickers) if tickers else ""
    lines = [
        f"{sentiment_emoji} <b>Market News · {sentiment.upper()}</b>",
        f"{title}",
        f"<i>Source: {source}</i>",
    ]
    if tickers_str:
        lines.append(f"<b>Tickers:</b> {tickers_str}")
    if url:
        lines.append(f"<a href='{url}'>Read more</a>")
    return "\n".join(lines)


def fmt_scenario(name: str, impact_pct: float, summary: str = "") -> str:
    direction = "📈" if impact_pct >= 0 else "📉"
    lines = [
        f"{direction} <b>Scenario Analysis: {name}</b>",
        f"<b>Portfolio impact:</b> {impact_pct:+.1f}%",
    ]
    if summary:
        lines.append(f"\n{summary}")
    return "\n".join(lines)


def fmt_propose(count: int, regions: list[str]) -> str:
    return (
        f"🤖 <b>AI Portfolio Proposal Ready</b>\n"
        f"{count} positions proposed across {', '.join(regions)}\n"
        f"Open Market Intel to review and add to your portfolio."
    )

"""
Market Intel — FastAPI backend.
Flat architecture: no agent hierarchy, pure async functions + sqlite.

Environment variables
---------------------
PORT            int     TCP port to listen on (default: 2860 locally, Railway sets this)
API_SECRET      str     When set, used as the WS/auth token instead of generating one.
                        Set this on your hosting provider for security.
DATABASE_URL    str     Path to SQLite file (default: ./data/market.db)
ALLOWED_ORIGINS str     Comma-separated CORS origins, default "*"
"""
import asyncio
import json
import os
import re
import secrets
import socket
import time
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
import market as mkt
import export as exp
import predictions as pred
from llm import call_raw_with_fallback
from logger import get_logger
import telegram_notify as tg

_log = get_logger(__name__)
_UP = time.monotonic()

# Use a fixed secret when API_SECRET is set in env (production), otherwise generate one.
_API_TOKEN: str = os.environ.get("API_SECRET") or secrets.token_hex(32)

_sched = AsyncIOScheduler()
_clients: set[WebSocket] = set()

_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",")]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _stock_risk(beta: float | None, cap_tier: str, sector: str,
                pe_ratio: float | None, pnl_pct: float) -> int:
    """1 = lowest, 10 = highest risk for a stock holding."""
    score = 5.0

    # Beta (volatility vs market) — biggest driver
    if beta is not None:
        if   beta < 0:    score += 1.5   # inverse
        elif beta < 0.5:  score -= 2.0
        elif beta < 0.8:  score -= 0.8
        elif beta < 1.2:  pass           # market-like
        elif beta < 1.5:  score += 1.2
        elif beta < 2.0:  score += 2.2
        else:             score += 3.2

    # Market cap tier
    score += {"penny": 3.2, "small": 1.5, "mid": 0.0, "large": -1.5, "unknown": 0.6}.get(
        (cap_tier or "").lower(), 0.6)

    # Sector
    sec = (sector or "").lower()
    if   any(k in sec for k in ("crypto", "digital asset", "biotech", "cannabis", "meme")):
        score += 1.8
    elif any(k in sec for k in ("oil", "gas", "energy", "mining", "material")):
        score += 0.8
    elif any(k in sec for k in ("util", "consumer staple", "real estate")):
        score -= 1.0
    elif any(k in sec for k in ("tech", "software", "semiconductor", "ai")):
        score += 0.4

    # Negative or extreme P/E
    if pe_ratio is not None:
        if   pe_ratio < 0:   score += 1.2
        elif pe_ratio > 100: score += 0.6

    # Currently deep in loss adds uncertainty
    if pnl_pct < -25: score += 0.8

    return max(1, min(10, round(score)))


def _tg() -> tuple[str, str]:
    """Return (bot_token, chat_id) from DB settings or env."""
    token = db.get_setting("telegram_bot_token", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = db.get_setting("telegram_chat_id", "")
    return token, chat_id


async def _tg_send(text: str):
    """Send a Telegram message if configured."""
    token, chat_id = _tg()
    if token and chat_id:
        await tg.send_message(chat_id, text, token)


async def _broadcast(msg: dict):
    dead = set()
    for ws in list(_clients):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)


async def _auto_news():
    try:
        holdings = db.get_holdings()
        tickers  = [h["ticker"] for h in holdings]
        items    = mkt.fetch_news(tickers)
        nitter   = db.get_setting("x_nitter_instance") or ""
        x_accs   = db.get_setting("x_accounts") or ""
        accs     = [a.strip() for a in x_accs.split(",") if a.strip()] if x_accs else None
        if nitter:
            items.extend(mkt.fetch_x_news(nitter, accs))
        db.upsert_news(items)
        db.log_activity(f"Auto-fetched {len(items)} news items", "scheduler")
    except Exception as e:
        _log.error("auto news: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    _log.info("DB ready at %s", db.DB_PATH)
    _sched.add_job(_auto_news, "interval", hours=1, id="auto_news")
    _sched.add_job(_generate_picks, "interval", hours=6, id="auto_picks")
    _sched.start()
    # Auto-generate picks on startup (in background so server starts fast)
    asyncio.get_event_loop().create_task(_generate_picks())
    yield
    _sched.shutdown(wait=False)


app = FastAPI(title="Market Intel API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════ WebSocket ═══════════════════════

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    if token != _API_TOKEN:
        await ws.close(code=4401, reason="invalid token")
        return
    await ws.accept()
    _clients.add(ws)
    beat = 0
    try:
        while True:
            beat += 1
            await ws.send_json({
                "type": "heartbeat",
                "beat": beat,
                "uptime_seconds": time.monotonic() - _UP,
            })
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(ws)


# ═══════════════════════ System ═══════════════════════

@app.get("/api/v1/health")
def health():
    return {"status": "ok", "uptime": round(time.monotonic() - _UP, 1)}


@app.get("/api/v1/token")
def token():
    return {"token": _API_TOKEN}


# ═══════════════════════ Telegram ═══════════════════════

class TelegramBody(BaseModel):
    message: str = "👋 Market Intel connected! You'll receive buy/sell signals and news alerts here."


@app.post("/api/v1/telegram/test")
async def telegram_test(body: TelegramBody):
    token_val, chat_id = _tg()
    if not token_val:
        raise HTTPException(400, "No Telegram bot token configured")
    if not chat_id:
        raise HTTPException(400, "No Telegram chat_id configured — click 'Auto-detect chat ID' first")
    ok = await tg.send_message(chat_id, body.message, token_val)
    if not ok:
        raise HTTPException(502, "Telegram API call failed — check your token and chat_id")
    return {"ok": True}


@app.post("/api/v1/telegram/detect-chat-id")
async def telegram_detect():
    """Read the most recent Telegram update to auto-detect the user's chat_id."""
    token_val = db.get_setting("telegram_bot_token", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token_val:
        raise HTTPException(400, "No bot token configured")
    chat_id = await tg.get_chat_id(token_val)
    if not chat_id:
        raise HTTPException(404, "No messages found — send any message to the bot first, then retry")
    db.set_setting("telegram_chat_id", chat_id)
    return {"chat_id": chat_id}


# ═══════════════════════ Settings ═══════════════════════

class SettingBody(BaseModel):
    key: str
    value: str


@app.get("/api/v1/settings")
def get_settings():
    return db.get_all_settings()


@app.post("/api/v1/settings")
def post_setting(body: SettingBody):
    db.set_setting(body.key, body.value)
    return {"ok": True}


# ═══════════════════════ Market Data ═══════════════════════

@app.get("/api/v1/market/quote/{ticker}")
def quote(ticker: str):
    data = mkt.get_quote(ticker.upper())
    if "error" in data:
        raise HTTPException(422, data["error"])
    db.upsert_stock(data)
    return data


@app.get("/api/v1/market/history/{ticker}")
def history(ticker: str, period: str = "3mo"):
    return mkt.get_history(ticker.upper(), period)


@app.get("/api/v1/market/scan")
def scan(region: str = "US", cap_tier: str | None = None):
    results = mkt.scan_region(region, cap_tier)
    for r in results:
        db.upsert_stock(r)
    return results


@app.get("/api/v1/market/penny")
def penny(region: str = "US"):
    return mkt.get_penny_stocks(region)


@app.get("/api/v1/market/watchlist")
def watchlist():
    return db.get_stocks()


@app.delete("/api/v1/market/watchlist/{ticker}")
def remove_watchlist(ticker: str):
    db.delete_stock(ticker.upper())
    return {"ok": True}


# ═══════════════════════ Portfolio ═══════════════════════

class HoldingBody(BaseModel):
    ticker: str
    shares: float
    avg_cost: float
    region: str = "US"
    currency: str = "USD"
    notes: str = ""


class UpdateHoldingBody(BaseModel):
    shares: float | None = None
    avg_cost: float | None = None
    notes: str | None = None


@app.get("/api/v1/portfolio")
def portfolio():
    holdings = db.get_holdings()
    enriched = []
    total_value = total_cost = 0.0
    for h in holdings:
        # Try cached DB data first for speed, fall back to live quote
        cached = db.get_stock(h["ticker"])
        if cached and cached.get("last_price"):
            q = cached
        else:
            q = mkt.get_quote(h["ticker"])
        price = q.get("last_price") or h["avg_cost"]
        value = price * h["shares"]
        cost = h["avg_cost"] * h["shares"]
        pnl = value - cost
        pnl_pct = round(pnl / cost * 100, 2) if cost else 0
        enriched.append({
            **h,
            "current_price": price,
            "current_value": round(value, 2),
            "cost_basis": round(cost, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": pnl_pct,
            "name": q.get("name", ""),
            "sector": q.get("sector", ""),
            "market_cap_tier": q.get("market_cap_tier", ""),
            "currency": q.get("currency", h.get("currency", "USD")),
            "risk": _stock_risk(
                q.get("beta"), q.get("market_cap_tier", ""),
                q.get("sector", ""), q.get("pe_ratio"), pnl_pct,
            ),
        })
        total_value += value
        total_cost += cost
    total_pnl = total_value - total_cost
    return {
        "holdings": enriched,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl / total_cost * 100, 2) if total_cost else 0,
    }


# ═══════════════════════ Daily Stock Picks (Auto-Suggestions) ═══════════════════════

_daily_picks: list[dict] = []
_picks_generated_at: float = 0


@app.get("/api/v1/picks")
def get_picks():
    """Return cached daily stock picks instantly."""
    return {"picks": _daily_picks, "generated_at": _picks_generated_at}


@app.post("/api/v1/picks/refresh")
async def refresh_picks(bg: BackgroundTasks):
    bg.add_task(_generate_picks)
    return {"status": "queued"}


async def _generate_picks():
    global _daily_picks, _picks_generated_at
    await _broadcast({"type": "agent", "event": "picks_start", "msg": "Scanning markets for today's top stock picks..."})
    try:
        # Quick scan: grab a handful of tickers from each category
        hot_tickers = ["NVDA", "AAPL", "TSLA", "AMD", "META", "GOOGL", "AMZN", "MSFT",
                        "JPM", "V", "AVGO", "CRM", "NFLX", "COST", "XOM",
                        "SNDL", "AMC", "CLOV", "PLTR", "SOFI", "RIVN", "LCID",
                        "SAP.DE", "ASML.AS", "SHEL.L", "AZN.L"]
        
        # Fetch quotes in parallel-ish (cache will help on repeats)
        quick_data = []
        for t in hot_tickers[:20]:
            q = mkt.get_quote(t)
            if "error" not in q and q.get("last_price"):
                hist = mkt.get_history(t, "1mo")
                mom = "N/A"
                if len(hist) >= 2:
                    pct = (hist[-1]["close"] - hist[0]["close"]) / hist[0]["close"] * 100
                    mom = f"{pct:+.1f}%"
                quick_data.append({
                    "ticker": t, "name": q.get("name"), "price": q.get("last_price"),
                    "sector": q.get("sector", ""), "cap": q.get("market_cap_tier", ""),
                    "pe": q.get("pe_ratio", "N/A"), "beta": q.get("beta", "N/A"),
                    "mom_1mo": mom,
                })

        data_text = "\n".join(
            f"{d['ticker']} ({d['name']}): {d['sector']} | Cap: {d['cap']} | ${d['price']} | PE: {d['pe']} | Beta: {d['beta']} | 1mo: {d['mom_1mo']}"
            for d in quick_data
        )

        system = (
            "You are an elite, hyper-specialized equity strategist at a Tier-1 quantitative hedge fund. "
            "You provide SPECIFIC, ACTIONABLE daily stock picks — not generic advice. "
            "Include a mix of blue-chips, growth stocks, AND penny/micro-cap plays. "
            "For each pick, give a precise entry price, target price, stop-loss, and time horizon. "
            "Use advanced terminology. No emojis. Respond ONLY with valid JSON array."
        )
        user = (
            f"Based on this LIVE market data, give me exactly 6 stock picks for today.\n\n"
            f"LIVE DATA:\n{data_text}\n\n"
            f"Include:\n"
            f"- 2 large-cap conviction plays (blue-chip or mega-cap)\n"
            f"- 2 growth/momentum plays (mid-cap, high-beta)\n"
            f"- 2 speculative/penny stock plays (micro-cap, high risk/reward)\n\n"
            f'Return JSON array:\n'
            f'[{{"ticker":"NVDA","name":"NVIDIA Corp","action":"BUY","conviction":"HIGH",'
            f'"entry_price":130.0,"target_price":155.0,"stop_loss":118.0,'
            f'"time_horizon":"2-4 weeks","risk_level":"Medium",'
            f'"category":"large-cap","sector":"Semiconductors",'
            f'"rationale":"Specific technical and fundamental reasoning here"}}]'
        )

        resp = call_raw_with_fallback(system, user)
        match = re.search(r'\[.*\]', resp, re.DOTALL)
        if match:
            picks = json.loads(match.group())
            _daily_picks = picks
            _picks_generated_at = time.time()
            db.log_activity(f"Generated {len(picks)} daily stock picks", "picks", "agent")
            await _broadcast({
                "type": "agent", "event": "picks_done",
                "msg": f"Generated {len(picks)} daily stock picks",
                "data": picks,
            })
        else:
            raise ValueError("AI returned no valid picks JSON")
    except Exception as e:
        _log.error("picks: %s", e)
        await _broadcast({"type": "agent", "event": "picks_error", "msg": str(e)})


@app.post("/api/v1/portfolio/holding")
def add_holding(body: HoldingBody):
    hid = db.add_holding(body.model_dump())
    return {"id": hid}


@app.patch("/api/v1/portfolio/holding/{hid}")
def update_holding(hid: str, body: UpdateHoldingBody):
    db.update_holding(hid, body.model_dump(exclude_none=True))
    return {"ok": True}


@app.delete("/api/v1/portfolio/holding/{hid}")
def delete_holding(hid: str):
    db.delete_holding(hid)
    return {"ok": True}


class ProposeBody(BaseModel):
    regions: list[str] = Field(default=["US", "EU", "UK"])
    risk_level: str = "moderate"
    include_penny: bool = True
    budget: float = 10000.0
    currency: str = "USD"
    industries: str = ""
    feedback: str | None = None
    previous_portfolio: list[dict] | None = None


@app.post("/api/v1/portfolio/propose")
async def propose_portfolio(body: ProposeBody, bg: BackgroundTasks):
    bg.add_task(_propose_task, body)
    return {"status": "queued"}


async def _propose_task(body: ProposeBody):
    if body.feedback:
        msg = f"Consulting Analyst on feedback: '{body.feedback[:30]}...' "
    else:
        msg = f"Scanning global markets for {body.risk_level} opportunities..."
    await _broadcast({"type": "agent", "event": "propose_start", "msg": msg})
    
    holdings = db.get_holdings()
    avoid_str = ', '.join(h['ticker'] for h in holdings) or 'none'

    # STEP 1: Get Candidate Tickers
    system_1 = "You are a quantitative stock screener. Return ONLY a valid JSON array of 12-15 ticker symbols (strings) fitting the criteria, and nothing else."
    user_1 = (
        f"Identify 12-15 diverse stock tickers for a {body.risk_level} portfolio.\n"
        f"Regions: {', '.join(body.regions)}.\n"
        f"Include penny stocks / micro-caps: {body.include_penny}.\n"
        f"Include massive large-caps: Yes.\n"
        f"Preferred Industries/Focus: {body.industries if body.industries else 'Diversified across multiple sectors'}.\n"
        f"Avoid these tickers: {avoid_str}.\n"
    )
    if body.feedback:
        user_1 += f"CRITICAL - The Senior PM provided this feedback on the previous proposal: '{body.feedback}'. Ensure your ticker selection heavily leans into these instructions.\n"
    
    user_1 += 'Return exactly this format: ["AAPL", "NVDA", "JPM", "SNDL"]'
    
    try:
        resp_1 = ""
        for attempt in range(3):
            resp_1 = call_raw_with_fallback(system_1, user_1)
            if resp_1.strip():
                break
            _log.warning("propose: LLM returned empty on attempt %d, retrying in 5s...", attempt + 1)
            await _broadcast({"type": "agent", "event": "propose_status",
                              "msg": f"LLM temporarily unavailable, retrying... (attempt {attempt + 2}/3)"})
            await asyncio.sleep(5)
        match_1 = re.search(r"\[.*\]", resp_1, re.DOTALL)
        if not match_1:
            raise ValueError("No tickers generated — LLM provider may be down. Check your API key in Settings.")
        tickers = json.loads(match_1.group())[:15]
        
        await _broadcast({"type": "agent", "event": "propose_status", "msg": f"Fetching live market data for {len(tickers)} assets..."})

        # STEP 2: Fetch real-time data
        live_data = []
        for t in tickers:
            q = mkt.get_quote(t)
            if "error" not in q:
                # Get quick momentum proxy from 1mo history
                hist = mkt.get_history(t, "1mo")
                mom = "N/A"
                if len(hist) >= 2:
                    pct = (hist[-1]["close"] - hist[0]["close"]) / hist[0]["close"] * 100
                    mom = f"{pct:+.1f}%"
                
                live_data.append({
                    "ticker": t,
                    "name": q.get("name"),
                    "sector": q.get("sector") or "Equity",
                    "price": q.get("last_price") or 0.0,
                    "pe": q.get("pe_ratio") or "N/A",
                    "beta": q.get("beta") or "N/A",
                    "52w_high": q.get("52w_high") or "N/A",
                    "52w_low": q.get("52w_low") or "N/A",
                    "1mo_momentum": mom,
                    "cap_tier": q.get("market_cap_tier") or "unknown",
                })
        
        if not live_data:
            raise ValueError("Failed to fetch live data for candidates")

        await _broadcast({"type": "agent", "event": "propose_status", "msg": "Performing institutional fundamental & technical modeling..."})

        # STEP 3: JP Morgan Analyst Modeling
        news = db.get_news(limit=12)
        news_text = "\n".join(n.get("title", "") + " - " + n.get("sentiment", "") for n in news)
        
        data_text = "\n".join(
            f"{d['ticker']} ({d['name']}): {d['sector']} | Cap: {d['cap_tier']} | Price: ${d['price']} | PE: {d['pe']} | Beta: {d['beta']} | 52w High: {d['52w_high']} | 52w Low: {d['52w_low']} | 1mo Mom: {d['1mo_momentum']}"
            for d in live_data
        )

        system_2 = (
            "You are an elite, hyper-specialized Portfolio Manager at a Tier-1 Quantitative Hedge Fund. "
            "You ignore generic retail advice and focus on highly specific, niche fundamental anomalies and structural tailwinds. "
            "Provide rigorous, advanced institutional-grade modeling (e.g., specific multiples, idiosyncratic risks, exact technical levels). "
            "Build a high-conviction portfolio. Respond ONLY with a valid JSON array, no prose outside the JSON."
        )
        
        user_2 = (
            f"Build a {body.currency} {body.budget:,.0f} portfolio matching a '{body.risk_level}' risk profile.\n"
            f"Preferred Industries/Focus: {body.industries if body.industries else 'Diversified'}.\n\n"
            f"LIVE CANDIDATE UNIVERSE (Use ONLY these exact true prices):\n{data_text}\n\n"
            f"MACRO NEWS HEADLINES (Use for sentiment analysis):\n{news_text}\n\n"
        )
        if body.feedback:
            prev_tickers = [p.get("ticker") for p in (body.previous_portfolio or [])]
            user_2 += (
                f"CRITICAL INSTRUCTION FROM SENIOR PORTFOLIO MANAGER:\n"
                f"'{body.feedback}'\n"
                f"Previous portfolio tickers were: {', '.join(prev_tickers)}.\n"
                f"You MUST adjust allocations, sector focus, or liquidity based entirely on this feedback. Defer to the Senior PM.\n\n"
            )

        user_2 += (
            "Select 6-10 assets from the universe (or fewer if the Senior PM requested high liquidity/cash). "
            f"For each, allocate a specific {body.currency} amount.\n"
            "Provide rigorous, institutional-grade reasoning in `detailed_analysis`, incorporating:\n"
            "1. Fundamental Modeling: (P/E expansion, valuation multiples, sector tailwinds).\n"
            "2. Technical Analysis: (TradingView-style price action, momentum, 52-week ranges).\n"
            "3. Alternative Data & Geopolitics: Combine political and financial news to explain how macro/political events directly impact this asset.\n"
            "4. Exit Strategy: Recommend a specific hold duration and price target to sell at, with bull/bear/base scenarios.\n\n"
            "Return JSON array format exactly:\n"
            '[{"ticker":"AAPL","allocation_amount":2500.0,"shares":13,"time_horizon":"6-12 months",'
            '"risk_level":"Medium","estimated_price":190.0,"action":"BUY",'
            '"rationale":"Strong free cash flow...",'
            '"target_price_bull":220.0,"target_price_base":200.0,"target_price_bear":165.0,'
            '"exit_strategy":"Hold 6-12mo. Sell if price hits $220 (bull) or cut loss at $165 (bear). Re-evaluate at earnings.",'
            '"detailed_analysis":"**Fundamental Modeling:** Trading at 25x FWD P/E... \\n\\n**Technical Analysis:** Breakout above 50-DMA... \\n\\n**Social Sentiment:** High retail interest... \\n\\n**Scenario Analysis:** Bull: $220 (+15%) if AI revenue accelerates. Base: $200 (+5%). Bear: $165 (-13%) on macro slowdown."}]'
        )

        resp_2 = call_raw_with_fallback(system_2, user_2)
        match_2 = re.search(r"\[.*\]", resp_2, re.DOTALL)
        proposed = json.loads(match_2.group()) if match_2 else []
        await _broadcast({
            "type": "agent", "event": "propose_done",
            "msg": f"Proposed {len(proposed)} positions across {', '.join(body.regions)}",
            "data": proposed,
        })
        await _tg_send(tg.fmt_propose(len(proposed), body.regions))
    except Exception as e:
        _log.error("propose: %s", e)
        await _broadcast({"type": "agent", "event": "propose_error", "msg": str(e)})


# ═══════════════════════ News ═══════════════════════

@app.get("/api/v1/news")
def news(sentiment: str | None = None, limit: int = 50):
    return db.get_news(sentiment, limit)


@app.get("/api/v1/news/{ticker}")
def news_ticker(ticker: str):
    return db.get_news_for_ticker(ticker.upper())


@app.post("/api/v1/news/refresh")
async def refresh_news(bg: BackgroundTasks):
    bg.add_task(_news_task)
    return {"status": "queued"}


async def _news_task():
    await _broadcast({"type": "agent", "event": "news_start", "msg": "Fetching financial news..."})
    try:
        holdings = db.get_holdings()
        items = mkt.fetch_news([h["ticker"] for h in holdings])

        # X / Twitter via Nitter (optional — only runs when x_nitter_instance is set)
        nitter  = db.get_setting("x_nitter_instance") or ""
        x_accs  = db.get_setting("x_accounts") or ""
        accs    = [a.strip() for a in x_accs.split(",") if a.strip()] if x_accs else None
        if nitter:
            x_items = mkt.fetch_x_news(nitter, accs)
            items.extend(x_items)

        db.upsert_news(items)
        db.log_activity(f"Fetched {len(items)} news items", "news", "agent")
        await _broadcast({"type": "agent", "event": "news_done",
                          "msg": f"Fetched {len(items)} news items"})
        # Notify on high-signal news (bullish or bearish with portfolio tickers)
        holdings_tickers = {h["ticker"] for h in db.get_holdings()}
        for item in items:
            sentiment = item.get("sentiment", "neutral")
            item_tickers = item.get("tickers", [])
            relevant = holdings_tickers & set(item_tickers) if item_tickers else set()
            if sentiment != "neutral" and relevant:
                await _tg_send(tg.fmt_news(
                    item.get("title", ""),
                    item.get("source", ""),
                    sentiment,
                    list(relevant),
                    item.get("url", ""),
                ))
    except Exception as e:
        await _broadcast({"type": "agent", "event": "news_error", "msg": str(e)})


# ═══════════════════════ Insights ═══════════════════════

class InsightBody(BaseModel):
    ticker: str
    scenario: str = "base"


@app.get("/api/v1/insights")
def get_insights(ticker: str | None = None):
    return db.get_insights(ticker)


@app.post("/api/v1/insights/generate")
async def gen_insight(body: InsightBody, bg: BackgroundTasks):
    bg.add_task(_insight_task, body.ticker.upper(), body.scenario)
    return {"status": "queued"}


@app.delete("/api/v1/insights/{iid}")
def del_insight(iid: str):
    db.delete_insight(iid)
    return {"ok": True}


async def _insight_task(ticker: str, scenario: str):
    await _broadcast({"type": "agent", "event": "insight_start",
                      "msg": f"Analysing {ticker} ({scenario} scenario)..."})
    try:
        q = mkt.get_quote(ticker)
        news = db.get_news_for_ticker(ticker, limit=5)
        hist = mkt.get_history(ticker, "1mo")
        price_change = ""
        if len(hist) >= 2:
            pct = (hist[-1]["close"] - hist[0]["close"]) / hist[0]["close"] * 100
            price_change = f"1-month change: {pct:+.1f}%"

        system = (
            "You are a quantitative equity analyst. Give clear, actionable investment insights. "
            "Return ONLY valid JSON — no markdown, no prose outside the JSON."
        )
        user = (
            f"Analyse {ticker} ({q.get('name','')}) under a {scenario} scenario.\n\n"
            f"Price: {q.get('last_price')} {q.get('currency','USD')} | {price_change}\n"
            f"Sector: {q.get('sector','?')} | Cap tier: {q.get('market_cap_tier','?')}\n"
            f"P/E: {q.get('pe_ratio','N/A')} | Beta: {q.get('beta','N/A')}\n"
            f"52w: {q.get('52w_low','?')} – {q.get('52w_high','?')}\n\n"
            "Recent news:\n" + "\n".join(n.get("title","") for n in news) + "\n\n"
            'Return JSON: {"action":"buy|hold|sell|watch","confidence":0-100,'
            '"rationale":"2-3 sentences","target_price":number,'
            '"bull_case":"string","bear_case":"string","key_risks":["string"]}'
        )

        resp = call_raw_with_fallback(system, user)
        match = re.search(r"\{.*\}", resp, re.DOTALL)
        if not match:
            raise ValueError("no JSON in LLM response")

        data = json.loads(match.group())
        provider = db.get_setting("llm_provider", "anthropic")
        insight = {
            "ticker": ticker,
            "action": data.get("action", "watch"),
            "confidence": int(data.get("confidence", 50)),
            "rationale": data.get("rationale", ""),
            "target_price": data.get("target_price"),
            "scenario": scenario,
            "model_used": provider,
        }
        iid = db.save_insight(insight)
        db.log_activity(
            f"Insight {ticker}: {insight['action']} ({insight['confidence']}%)", "insight", "agent"
        )
        await _broadcast({
            "type": "agent", "event": "insight_done",
            "msg": f"{ticker}: {insight['action'].upper()} — {insight['confidence']}% confidence",
            "data": {
                **insight, "id": iid,
                "bull_case": data.get("bull_case", ""),
                "bear_case": data.get("bear_case", ""),
                "key_risks": data.get("key_risks", []),
            },
        })
        # Notify on actionable signals (buy/sell) with decent confidence
        if insight["action"] in ("buy", "sell") and insight["confidence"] >= 60:
            await _tg_send(tg.fmt_insight(
                ticker,
                insight["action"],
                insight["confidence"],
                insight["rationale"],
                insight.get("target_price"),
                data.get("bull_case", ""),
                data.get("bear_case", ""),
            ))
    except Exception as e:
        _log.error("insight %s: %s", ticker, e)
        await _broadcast({"type": "agent", "event": "insight_error", "msg": str(e)})


# ═══════════════════════ Scenarios ═══════════════════════

class ScenarioBody(BaseModel):
    name: str
    description: str = ""


@app.get("/api/v1/scenarios")
def get_scenarios():
    return db.get_scenarios()


@app.post("/api/v1/scenarios/analyze")
async def analyze_scenario(body: ScenarioBody, bg: BackgroundTasks):
    bg.add_task(_scenario_task, body.name, body.description)
    return {"status": "queued"}


@app.delete("/api/v1/scenarios/{sid}")
def del_scenario(sid: str):
    db.delete_scenario(sid)
    return {"ok": True}


async def _scenario_task(name: str, description: str):
    await _broadcast({"type": "agent", "event": "scenario_start",
                      "msg": f"Running scenario: {name}..."})
    try:
        holdings = db.get_holdings()
        if holdings:
            stocks_text = "\n".join(
                f"- {h['ticker']}: {h['shares']} shares @ ${h['avg_cost']:.2f}"
                for h in holdings[:12]
            )
            portfolio_label = "USER PORTFOLIO"
        else:
            # No holdings — use a representative market basket for analysis
            default_universe = [
                ("AAPL", "Apple", "Technology"), ("NVDA", "NVIDIA", "Semiconductors"),
                ("MSFT", "Microsoft", "Technology"), ("GOOGL", "Alphabet", "Technology"),
                ("AMZN", "Amazon", "Consumer Cyclical"), ("JPM", "JP Morgan", "Financials"),
                ("XOM", "Exxon Mobil", "Energy"), ("JNJ", "Johnson & Johnson", "Healthcare"),
                ("TSLA", "Tesla", "Auto/EV"), ("SNDL", "Sundial Growers", "Cannabis/Penny"),
                ("AMC", "AMC Entertainment", "Entertainment/Penny"), ("PLTR", "Palantir", "AI/Defense"),
            ]
            stocks_text = "\n".join(
                f"- {t}: {n} ({s})" for t, n, s in default_universe
            )
            portfolio_label = "REFERENCE MARKET BASKET (user has no holdings yet)"

        # Fetch live news + prediction signals to ground the analysis
        news = db.get_news(limit=20)
        news_text = "\n".join(
            f"- [{n.get('sentiment','neutral')}] {n.get('title','')} ({n.get('source','')})"
            for n in news[:15]
        ) or "No recent news available."

        # Try to get prediction market signals for extra context
        pred_text = ""
        try:
            pred_markets = await pred.fetch_all(10)
            if pred_markets:
                pred_text = "\n".join(
                    f"- {m['question']} → YES {m['yes_price']}% ({m['platform']})"
                    for m in pred_markets[:8]
                )
        except Exception:
            pred_text = ""

        system = (
            "You are a hyper-specialized macro risk analyst at a Tier-1 quantitative hedge fund. "
            "You model scenario impacts with extreme precision, including peer group comparisons, "
            "sector rotation effects, and second-order consequences. "
            "CRITICAL: You must use the LIVE NEWS HEADLINES and PREDICTION MARKET SIGNALS provided below "
            "to ground your analysis in current real-world events. Explain how specific current events "
            "(e.g. oil price movements, Fed policy, earnings, geopolitical tensions, trade policy) "
            "amplify or dampen the scenario's impact on each stock. Think like a senior junior analyst "
            "at Goldman Sachs who connects dots across domains. "
            "No emojis. Return ONLY valid JSON — no markdown, no prose outside the JSON."
        )
        user = (
            f"Scenario: {name}\n{description}\n\n"
            f"{portfolio_label}:\n{stocks_text}\n\n"
            f"LIVE NEWS HEADLINES (use these to ground your analysis):\n{news_text}\n\n"
        )
        if pred_text:
            user += f"PREDICTION MARKET SIGNALS (use as leading indicators):\n{pred_text}\n\n"
        user += (
            'Return JSON with EXACTLY this structure:\n'
            '{\n'
            '  "affected_sectors": ["Technology", "Energy", "Financials"],\n'
            '  "assumptions": "Detailed macro assumptions grounded in the live news above",\n'
            '  "portfolio_impact_pct": -5.2,\n'
            '  "news_catalysts": "Which specific news headlines above are most relevant to this scenario and why",\n'
            '  "per_stock": [\n'
            '    {\n'
            '      "ticker": "AAPL",\n'
            '      "impact_pct": -3.5,\n'
            '      "peer_comparison": "Outperforms MSFT (-5.1%) and GOOGL (-4.8%) due to services revenue resilience",\n'
            '      "news_link": "How a specific headline above directly affects this stock",\n'
            '      "reasoning": "Specific fundamental reasoning for this stock under this scenario"\n'
            '    }\n'
            '  ],\n'
            '  "sector_rotation": "Where capital flows TO and FROM under this scenario",\n'
            '  "hedge_recommendations": "Specific hedging strategies (e.g., put spreads, sector ETFs, inverse ETFs)",\n'
            '  "summary": "Comprehensive 3-4 sentence scenario analysis summary referencing current events"\n'
            '}'
        )

        resp = call_raw_with_fallback(system, user)
        match = re.search(r"\{.*\}", resp, re.DOTALL)
        if not match:
            raise ValueError("no JSON in LLM response")

        data = json.loads(match.group())
        sid = db.save_scenario({
            "name": name,
            "description": description,
            "affected_sectors": data.get("affected_sectors", []),
            "assumptions": data.get("assumptions", ""),
            "portfolio_impact": data.get("portfolio_impact_pct"),
        })
        db.log_activity(
            f"Scenario '{name}': {data.get('portfolio_impact_pct', 0):+.1f}% impact",
            "scenario", "agent",
        )
        await _broadcast({
            "type": "agent", "event": "scenario_done",
            "msg": f"'{name}': {data.get('portfolio_impact_pct', 0):+.1f}% portfolio impact",
            "data": {**data, "id": sid, "name": name},
        })
        # Notify on significant portfolio impact (>= 3% in either direction)
        impact = data.get("portfolio_impact_pct", 0) or 0
        if abs(impact) >= 3:
            await _tg_send(tg.fmt_scenario(name, impact, data.get("summary", "")))
    except Exception as e:
        _log.error("scenario: %s", e)
        await _broadcast({"type": "agent", "event": "scenario_error", "msg": str(e)})


# ═══════════════════════ Export ═══════════════════════

@app.post("/api/v1/export/excel")
async def export_excel():
    try:
        holdings_raw = db.get_holdings()
        enriched = []
        for h in holdings_raw:
            q = mkt.get_quote(h["ticker"])
            price = q.get("last_price") or h["avg_cost"]
            val = price * h["shares"]
            cost = h["avg_cost"] * h["shares"]
            enriched.append({
                **h,
                "current_price": price,
                "current_value": val,
                "pnl": val - cost,
                "pnl_pct": (val - cost) / cost * 100 if cost else 0,
                "name": q.get("name", ""),
                "sector": q.get("sector", ""),
                "market_cap_tier": q.get("market_cap_tier", ""),
            })
        path = exp.export_to_excel(
            enriched, db.get_news(limit=30),
            db.get_insights(limit=30), db.get_scenarios(),
        )
        return FileResponse(
            path, filename="portfolio.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as e:
        raise HTTPException(500, str(e))


class GSheetBody(BaseModel):
    sheet_id: str
    credentials_path: str = ""


@app.post("/api/v1/export/gsheets")
async def export_gsheets(body: GSheetBody):
    try:
        holdings = db.get_holdings()
        insights = db.get_insights(limit=20)
        creds = body.credentials_path or db.get_setting("gsheets_credentials", "")
        exp.export_to_gsheets(body.sheet_id, holdings, insights, creds)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ═══════════════════════ n8n ═══════════════════════

@app.post("/api/v1/n8n/trigger/{workflow_id}")
async def n8n_trigger(workflow_id: str, payload: dict = {}):
    try:
        from n8n import trigger_workflow
        return await trigger_workflow(workflow_id, payload)
    except Exception as e:
        raise HTTPException(500, str(e))


# ═══════════════════════ CrewAI ═══════════════════════

class CrewBody(BaseModel):
    tickers: list[str]
    task: str = "full_analysis"


@app.post("/api/v1/crewai/analyze")
async def crewai_analyze(body: CrewBody, bg: BackgroundTasks):
    bg.add_task(_crewai_task, body.tickers, body.task)
    return {"status": "queued"}


async def _crewai_task(tickers: list[str], task: str):
    await _broadcast({"type": "agent", "event": "crewai_start",
                      "msg": f"CrewAI analysing {', '.join(tickers)}..."})
    try:
        from crewai_crew import run_market_crew
        result = run_market_crew(tickers, task)
        db.log_activity(f"CrewAI done for {', '.join(tickers)}", "crewai", "agent")
        await _broadcast({"type": "agent", "event": "crewai_done",
                          "msg": "CrewAI analysis complete", "data": result})
    except Exception as e:
        _log.error("crewai: %s", e)
        await _broadcast({"type": "agent", "event": "crewai_error", "msg": str(e)})


class IntelCrewBody(BaseModel):
    tickers: list[str] = Field(default=[])
    fire_n8n: bool = Field(default=True)
    fast_mode: bool = Field(default=False)


@app.post("/api/v1/predictions/full-cross-analysis")
async def full_cross_analysis(body: IntelCrewBody, bg: BackgroundTasks):
    """Run 12-agent Intel Crew across 4 parallel phases: political/sentiment/technical → macro/options → equity/sector → prediction/earnings/altdata → risk → synthesis."""
    async def _run():
        tickers = body.tickers or [h["ticker"] for h in db.get_holdings()][:8]
        if body.fast_mode:
            tickers = tickers[:4]
        mode_label = "fast mode (4 tickers)" if body.fast_mode else "12 agents, 4 parallel phases"
        await _broadcast({
            "type": "agent", "event": "intel_crew_start",
            "msg": f"Intel Crew starting — {mode_label}, {len(tickers)} tickers: {', '.join(tickers[:5])}...",
        })
        try:
            from crewai_crew import run_intel_crew
            import n8n as n8n_mod

            # Broadcast phase progress markers
            for step in [
                (8,  "Phase 1 [parallel]: Political Intelligence · Social Sentiment · Technical Patterns"),
                (22, "Phase 2 [parallel]: Macro Economist · Options & Dark Pool"),
                (38, "Phase 3 [parallel]: Equity Analyst · Sector Rotation"),
                (55, "Phase 4 [parallel]: Prediction Arbitrageur · Earnings · Alternative Data"),
                (72, "Phase 5: Risk Manager assessing portfolio exposure..."),
                (90, "Phase 6: Intelligence Synthesizer producing final brief..."),
            ]:
                await _broadcast({"type": "agent", "event": "intel_crew_progress",
                                  "pct": step[0], "msg": step[1]})

            result = run_intel_crew(tickers)
            db.log_activity(
                f"Intel Crew complete ({result.get('source','?')}, "
                f"{result.get('agents_used',0)} agents)",
                "intel_crew", "agent"
            )

            # Fire n8n workflows if enabled
            n8n_responses: dict = {}
            if body.fire_n8n and (db.get_setting("n8n_url") or "").strip():
                try:
                    n8n_responses = await n8n_mod.dispatch_all_alerts(result)
                except Exception as n8n_err:
                    _log.warning("n8n dispatch: %s", n8n_err)

            await _broadcast({
                "type":         "agent",
                "event":        "intel_crew_done",
                "msg":          "Intel Crew analysis complete",
                "data":         result,
                "n8n":          n8n_responses,
            })
        except Exception as e:
            _log.error("intel crew: %s", e)
            await _broadcast({"type": "agent", "event": "intel_crew_error", "msg": str(e)})

    bg.add_task(_run)
    return {"status": "queued"}


# ═══════════════════════ Predictions ═══════════════════════

@app.get("/api/v1/predictions")
async def get_predictions(category: str | None = None, platform: str | None = None, limit: int = 25):
    """Fetch live prediction markets by category (financial/sports/politics/tech) or platform."""
    try:
        if category == "financial":
            markets = await pred.fetch_financial(limit)
        elif category == "sports":
            markets = await pred.fetch_sports(limit)
        elif category == "politics":
            markets = await pred.fetch_politics(limit)
        elif category == "tech":
            markets = await pred.fetch_tech(limit)
        elif platform == "polymarket":
            markets = await pred.fetch_polymarket(limit)
        elif platform == "kalshi":
            markets = await pred.fetch_kalshi(limit)
        elif platform == "predictit":
            markets = await pred.fetch_predictit()
        elif platform == "metaculus":
            markets = await pred.fetch_metaculus(limit)
        elif platform == "manifold":
            markets = await pred.fetch_manifold("tech", limit)
        else:
            markets = await pred.fetch_all(limit)
        return markets
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/v1/predictions/suggest")
async def suggest_bets(limit: int = 15):
    """Return top 'good bet' markets across all sources sorted by risk ascending."""
    try:
        return await pred.fetch_suggestions(limit)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/v1/predictions/generate")
async def generate_ai_predictions(bg: BackgroundTasks):
    """Generate novel predictions based on latest news."""
    async def _generate():
        await _broadcast({"type": "agent", "event": "predictions_start", "msg": "Reading cross-domain news to generate AI predictions..."})
        try:
            news = mkt.fetch_news(None)
            news_text = json.dumps([{"source": n["source"], "title": n["title"], "sentiment": n["sentiment"]} for n in news[:50]])
            system = (
                "You are an elite, institutional-grade quantitative forecaster at a top investment bank. "
                "Your analysis is rigorous, data-driven, and devoid of fluff or emojis. "
                "You analyze breaking macro, political, and sports news to find arbitrage or high-conviction trade opportunities."
            )
            user = (
                f"LATEST CROSS-DOMAIN NEWS FEED:\n{news_text}\n\n"
                "Based on this news universe, generate 5 high-conviction predictions/trade setups.\n"
                "For each item, you MUST provide:\n"
                "1. Decision: Explicitly state 'BET' or 'NO BET' based on the risk/reward.\n"
                "2. Specificity: Which exact ticker or market is affected?\n"
                "3. Rationale: A detailed institutional-grade explanation of the causal link between the news and the trade.\n"
                "4. Counter-Argument: Why this trade might fail (Risk analysis).\n\n"
                "CRITICAL: DO NOT use emojis. Return exactly a JSON array of objects with keys: "
                "['news_event', 'prediction', 'decision', 'actionable_trade', 'ticker', 'rationale', 'risk_analysis']."
            )
            resp = call_raw_with_fallback(system, user)
            match = re.search(r"\[.*\]", resp, re.DOTALL)
            if not match:
                raise ValueError("AI failed to generate predictions.")
            data = json.loads(match.group())
            await _broadcast({"type": "agent", "event": "predictions_done", "msg": "Generated 5 AI predictions.", "data": data})
        except Exception as e:
            _log.error("prediction generate: %s", e)
            await _broadcast({"type": "agent", "event": "predictions_error", "msg": str(e)})

    bg.add_task(_generate)
    return {"status": "queued"}


@app.get("/api/v1/predictions/sources")
async def prediction_sources():
    """Metadata about prediction market platforms and news sources."""
    return {
        "prediction_markets": [
            {
                "id": "polymarket", "name": "Polymarket", "color": "#00b4b4",
                "categories": ["financial", "politics", "tech", "sports"],
                "description": "Largest crypto-native real-money prediction market. USDC-denominated binary contracts. Strong crowd wisdom due to financial incentives.",
                "data_type": "Real-money binary YES/NO contracts (USDC)",
                "reliability": "High — real money at stake enforces accuracy",
                "covers": ["US/Global politics", "Crypto prices", "Tech milestones", "Sports", "Macro economics"],
            },
            {
                "id": "kalshi", "name": "Kalshi", "color": "#6c5ce7",
                "categories": ["financial", "economics"],
                "description": "CFTC-regulated US exchange. Focuses on economic indicators, Fed decisions, and earnings events. Institutional participants.",
                "data_type": "Regulated USD binary contracts",
                "reliability": "Very High — CFTC-regulated, institutional money",
                "covers": ["Fed rate decisions", "CPI/Inflation", "GDP", "US economic calendar", "Earnings"],
            },
            {
                "id": "predictit", "name": "PredictIt", "color": "#e84393",
                "categories": ["politics"],
                "description": "Academic-research-focused US political prediction market. Track record since 2014 for election and legislative outcomes.",
                "data_type": "USD binary contracts (max $850/contract per CFTC waiver)",
                "reliability": "High for US politics — well-established track record",
                "covers": ["US elections", "Congressional votes", "Executive actions", "Primaries", "Senate races"],
            },
            {
                "id": "metaculus", "name": "Metaculus", "color": "#f39c12",
                "categories": ["tech", "politics", "science"],
                "description": "Community forecasting platform. Strong on AI/tech timelines and geopolitical events. No real money but strong track record via superforecasters.",
                "data_type": "Community probability estimates (no real money)",
                "reliability": "Medium-High — superforecaster community, proven track record",
                "covers": ["AI milestones", "Geopolitics", "Science", "Technology", "Long-range forecasts"],
            },
            {
                "id": "manifold", "name": "Manifold", "color": "#3498db",
                "categories": ["tech", "sports", "politics"],
                "description": "Play-money market with very diverse topics. Best for niche/unusual questions not covered elsewhere.",
                "data_type": "Play-money contracts (Mana currency)",
                "reliability": "Medium — play money reduces incentives but useful for niche topics",
                "covers": ["AI/ML events", "Niche tech", "Sports", "Entertainment", "Unusual community questions"],
            },
        ],
        "news_sources": [
            {"id": "yahoo",       "name": "Yahoo Finance",   "color": "#6001d2", "category": "finance",   "covers": ["US stocks", "Market headlines", "Earnings"]},
            {"id": "cnbc",        "name": "CNBC",            "color": "#004b87", "category": "finance",   "covers": ["Markets", "Economy", "Business"]},
            {"id": "wsj",         "name": "WSJ Markets",     "color": "#000000", "category": "finance",   "covers": ["Markets", "Equities", "Bonds"]},
            {"id": "bloomberg",   "name": "Bloomberg",       "color": "#1f1f1f", "category": "finance",   "covers": ["Global markets", "Macro", "Commodities"]},
            {"id": "marketwatch", "name": "MarketWatch",     "color": "#ff3300", "category": "finance",   "covers": ["Stocks", "Personal finance", "Retirement"]},
            {"id": "investing",   "name": "Investing.com",   "color": "#e84040", "category": "finance",   "covers": ["Forex", "Commodities", "Crypto", "Stocks", "Analysis"]},
            {"id": "investopedia","name": "Investopedia",    "color": "#007bff", "category": "finance",   "covers": ["Market analysis", "Financial education", "News"]},
            {"id": "bbc",         "name": "BBC World",       "color": "#bb1919", "category": "politics",  "covers": ["Global politics", "International affairs"]},
            {"id": "nyt",         "name": "NYT Politics",    "color": "#1a1a1a", "category": "politics",  "covers": ["US politics", "Congress", "Elections"]},
            {"id": "foxnews",     "name": "Fox News",        "color": "#003366", "category": "politics",  "covers": ["US politics", "Conservative perspective"]},
            {"id": "guardian",    "name": "The Guardian",    "color": "#005689", "category": "politics",  "covers": ["World news", "Progressive perspective"]},
            {"id": "espn",        "name": "ESPN",            "color": "#cc0000", "category": "sports",    "covers": ["NFL", "NBA", "MLB", "NHL", "Soccer"]},
            {"id": "skysports",   "name": "Sky Sports",      "color": "#e8002d", "category": "sports",    "covers": ["Football", "Boxing", "MMA", "Cricket"]},
            {"id": "bbc_sport",   "name": "BBC Sport",       "color": "#bb1919", "category": "sports",    "covers": ["Football", "F1", "Tennis", "Olympics"]},
            {"id": "goal",        "name": "Goal.com",        "color": "#00a651", "category": "sports",    "covers": ["Soccer / Football worldwide"]},
            {"id": "90min",       "name": "90min",           "color": "#ff6600", "category": "sports",    "covers": ["Soccer news", "Transfer rumors"]},
            {"id": "bleacher",    "name": "Bleacher Report", "color": "#f47321", "category": "sports",    "covers": ["NFL", "NBA", "Soccer", "Combat sports"]},
            {"id": "autosport",   "name": "Autosport",       "color": "#e4002b", "category": "sports",    "covers": ["Formula 1", "Motorsport"]},
            {"id": "atp",         "name": "ATP Tour",        "color": "#00305e", "category": "sports",    "covers": ["Tennis rankings", "Tournament results"]},
            {"id": "wsb",         "name": "r/wallstreetbets","color": "#ff4500", "category": "social",    "covers": ["Retail sentiment", "Meme stocks", "Options plays"]},
            {"id": "rinvesting",  "name": "r/investing",     "color": "#ff4500", "category": "social",    "covers": ["Long-term investing", "Portfolio advice"]},
            {"id": "rstocks",     "name": "r/stocks",        "color": "#ff4500", "category": "social",    "covers": ["Stock picks", "Market discussion"]},
            {"id": "roptions",    "name": "r/options",       "color": "#ff4500", "category": "social",    "covers": ["Options trading", "Derivatives"]},
            {"id": "rcrypto",     "name": "r/CryptoCurrency","color": "#ff4500", "category": "social",    "covers": ["Crypto news", "Altcoins", "DeFi"]},
            {"id": "rpolitics",   "name": "r/politics",      "color": "#ff4500", "category": "social",    "covers": ["US politics", "Policy debate"]},
            {"id": "rworldnews",  "name": "r/worldnews",     "color": "#ff4500", "category": "social",    "covers": ["Global news", "International events"]},
            {"id": "rsoccer",     "name": "r/soccer",        "color": "#ff4500", "category": "social",    "covers": ["Football worldwide", "Transfers", "Match threads"]},
            {"id": "rnfl",        "name": "r/nfl",           "color": "#ff4500", "category": "social",    "covers": ["NFL news", "Game analysis", "Fantasy"]},
            {"id": "rnba",        "name": "r/nba",           "color": "#ff4500", "category": "social",    "covers": ["NBA news", "Trades", "Game threads"]},
            {"id": "rf1",         "name": "r/formula1",      "color": "#ff4500", "category": "social",    "covers": ["F1 news", "Race results", "Team news"]},
            {"id": "rmma",        "name": "r/MMA",           "color": "#ff4500", "category": "social",    "covers": ["UFC", "Bellator", "Fight analysis"]},
            # TradingView
            {"id": "tradingview", "name": "TradingView News", "color": "#2962ff", "category": "finance",
             "covers": ["Market analysis", "Chart insights", "Economic events", "Crypto", "Forex"]},
            # X / Twitter (Nitter)
            {"id": "x_unusual",  "name": "X @unusual_whales","color": "#000000", "category": "social",    "covers": ["Options flow", "Dark pool prints", "Unusual activity"]},
            {"id": "x_zerohedge","name": "X @zerohedge",     "color": "#000000", "category": "social",    "covers": ["Macro", "Contrarian finance", "Market stress"]},
            {"id": "x_wsj",      "name": "X @WSJmarkets",    "color": "#000000", "category": "social",    "covers": ["WSJ breaking market news"]},
            {"id": "x_reuters",  "name": "X @ReutersFinance","color": "#000000", "category": "social",    "covers": ["Reuters financial headlines"]},
            {"id": "x_ft",       "name": "X @FT",            "color": "#000000", "category": "social",    "covers": ["Financial Times headlines"]},
            {"id": "x_espn",     "name": "X @espn",          "color": "#000000", "category": "social",    "covers": ["ESPN sports breaking news"]},
            {"id": "x_f1",       "name": "X @F1",            "color": "#000000", "category": "social",    "covers": ["Formula 1 official updates"]},
            {"id": "x_ufc",      "name": "X @UFC",           "color": "#000000", "category": "social",    "covers": ["UFC official fight news"]},
        ],
        "x_configured": bool(db.get_setting("x_nitter_instance")),
    }


@app.get("/api/v1/predictions/crew-ready")
async def crew_ready():
    """Check if the 12-agent Intel Crew is ready: LLM key, portfolio, news pre-warmed."""
    from crewai_crew import crew_ready_status
    return crew_ready_status()


class PredAnalyzeBody(BaseModel):
    id: str
    question: str
    yes_price: float
    platform: str
    category: str
    volume_24h: float = 0
    hours_left: float | None = None
    url: str = ""


@app.post("/api/v1/predictions/analyze")
async def analyze_prediction(body: PredAnalyzeBody, bg: BackgroundTasks):
    """Deep-analyze a specific prediction market: related news, AI edge assessment, cross-portfolio signals."""
    async def _analyze():
        await _broadcast({"type": "agent", "event": "pred_analyze_start",
                          "market_id": body.id,
                          "msg": f"Analyzing: {body.question[:60]}..."})
        try:
            all_news  = mkt.fetch_news(None)
            keywords  = [w.lower() for w in re.split(r'\W+', body.question) if len(w) > 3]
            related   = [n for n in all_news
                         if any(k in (n.get("title", "") + n.get("source", "")).lower()
                                for k in keywords[:6])][:8]

            holdings  = db.get_holdings()
            port_ctx  = json.dumps([{"ticker": h["ticker"], "sector": h.get("sector", ""),
                                      "notes": h.get("notes", "")} for h in holdings[:12]])
            news_ctx  = "\n".join(
                f"- [{n['sentiment']}] {n['title']} ({n['source']})" for n in related
            ) or "No directly related news found in database."

            system = (
                "You are a hyper-specialized derivatives trader and prediction market quantitative expert at a leading multistrategy hedge fund. "
                "You do not give generic advice. You hunt for niche, asymmetric risk-reward setups, highly specific mispricings, "
                "and hidden structural inefficiencies. Use advanced financial and statistical terminology (e.g. implied volatility, "
                "gamma squeeze, tail risk, beta-neutral, arbitrage). "
                "Provide institutional-level, hyper-specific insights. NO generic commentary. No emojis."
            )
            user = f"""PREDICTION MARKET TO ANALYZE:
Platform: {body.platform} | Category: {body.category}
Question: {body.question}
Current YES price: {body.yes_price}¢ (implies {body.yes_price}% probability)
24h Volume: ${body.volume_24h:,.0f} | Hours left: {body.hours_left or 'unknown'}

RELATED NEWS FROM DATABASE:
{news_ctx}

PORTFOLIO HOLDINGS:
{port_ctx}

Return a JSON object with EXACTLY these keys (no markdown, no extra text):
{{
  "edge_assessment": "Is the market mispriced? Where is the edge?",
  "bull_case": "Strongest argument for YES outcome",
  "bear_case": "Strongest argument for NO outcome",
  "recommended_position": "BET YES / BET NO / AVOID with target entry price in cents",
  "confidence": 0,
  "rational_alternative": {{
    "description": "A more rational or higher-edge alternative bet in the same theme",
    "rationale": "Why this alternative has better risk/reward"
  }},
  "niche_angle": "An unusual or contrarian angle most bettors are ignoring",
  "portfolio_cross_impact": "How does this prediction outcome affect the listed portfolio holdings?",
  "political_financial_link": "If political market: how does the outcome affect financial markets and specific sectors?",
  "signal": "BUY or SELL or HOLD or WATCH",
  "signal_rationale": "Brief explanation of portfolio action",
  "key_dates": "Important upcoming dates or catalysts to watch"
}}"""

            resp  = call_raw_with_fallback(system, user)
            match = re.search(r'\{.*\}', resp, re.DOTALL)
            if not match:
                raise ValueError("AI returned no valid JSON analysis")
            analysis = json.loads(match.group())

            await _broadcast({
                "type": "agent",
                "event": "pred_analyze_done",
                "market_id": body.id,
                "msg": "Market analysis complete",
                "analysis": analysis,
                "related_news": related,
            })
        except Exception as e:
            _log.error("pred analyze: %s", e)
            await _broadcast({"type": "agent", "event": "pred_analyze_error",
                               "market_id": body.id, "msg": str(e)})

    bg.add_task(_analyze)
    return {"status": "queued"}


@app.post("/api/v1/predictions/cross-signals")
async def cross_domain_signals(bg: BackgroundTasks):
    """Generate live BUY/SELL/HOLD portfolio signals from prediction markets and news cross-analysis."""
    async def _signals():
        await _broadcast({"type": "agent", "event": "cross_signals_start",
                          "msg": "Scanning prediction markets and news for portfolio signals..."})
        try:
            news     = mkt.fetch_news(None)
            holdings = db.get_holdings()
            markets  = await pred.fetch_all(20)

            news_text = json.dumps([
                {"title": n["title"], "sentiment": n["sentiment"], "source": n["source"]}
                for n in news[:30]
            ])
            port_text = json.dumps([
                {"ticker": h["ticker"], "sector": h.get("sector", ""),
                 "shares": h.get("shares", 0), "avg_cost": h.get("avg_cost", 0)}
                for h in holdings[:15]
            ])
            mkt_text = json.dumps([
                {"question": m["question"], "yes_price": m["yes_price"],
                 "category": m["category"], "platform": m["platform"]}
                for m in markets[:15]
            ])

            system = (
                "You are a ruthless, hyper-niche macro strategist at a top-tier quantitative hedge fund. "
                "Your job is to find obscure, highly specific cross-domain correlations that retail investors miss. "
                "Do not state the obvious. Provide highly technical, contrarian, and specific portfolio signals "
                "based on complex second-order effects of prediction markets. Use advanced quantitative finance terminology. "
                "No emojis. Name extremely specific tickers and exact technical triggers."
            )
            user = f"""CURRENT PREDICTION MARKET SIGNALS:
{mkt_text}

LATEST CROSS-DOMAIN NEWS:
{news_text}

PORTFOLIO HOLDINGS:
{port_text}

Generate actionable cross-domain portfolio signals showing how prediction market outcomes and news affect the portfolio.
Return a JSON array (5-8 items):
[
  {{
    "ticker": "AAPL",
    "signal": "SELL",
    "strength": 7,
    "trigger": "What prediction market or news event is driving this signal",
    "category": "political or macro or earnings or sentiment or sector",
    "time_horizon": "immediate or days or weeks or months",
    "rationale": "Detailed causal explanation",
    "linked_prediction": "Related prediction market question if applicable"
  }}
]
CRITICAL: Return ONLY a valid JSON array. No markdown."""

            resp  = call_raw_with_fallback(system, user)
            match = re.search(r'\[.*\]', resp, re.DOTALL)
            if not match:
                raise ValueError("AI returned no valid signals JSON")
            signals = json.loads(match.group())

            await _broadcast({
                "type": "agent",
                "event": "cross_signals_done",
                "msg": f"Generated {len(signals)} portfolio signals",
                "signals": signals,
            })
        except Exception as e:
            _log.error("cross signals: %s", e)
            await _broadcast({"type": "agent", "event": "cross_signals_error", "msg": str(e)})

    bg.add_task(_signals)
    return {"status": "queued"}


# ═══════════════════════ Anthropic Agents ═══════════════════════

@app.get("/api/v1/anthropic/agents")
def get_anthropic_agents():
    """Discover agents from the financial-services repository."""
    agents = []
    base_path = os.path.join(os.path.dirname(__file__), "financial-services", "plugins", "vertical-plugins")
    if not os.path.exists(base_path):
        return []
    
    for folder in os.listdir(base_path):
        folder_path = os.path.join(base_path, folder)
        if not os.path.isdir(folder_path):
            continue
            
        # Try to find plugin.json in .claude-plugin or root of the folder
        plugin_json_paths = [
            os.path.join(folder_path, ".claude-plugin", "plugin.json"),
            os.path.join(folder_path, "plugin.json")
        ]
        
        for p in plugin_json_paths:
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        agents.append({
                            "id": folder,
                            "name": data.get("name", folder.replace("-", " ").title()),
                            "description": data.get("description", ""),
                            "version": data.get("version", "0.1.0"),
                        })
                    break
                except Exception as e:
                    _log.error(f"Error reading plugin.json in {folder}: {e}")
    return agents


class RunAgentBody(BaseModel):
    query: str = "Analyze current market conditions"

@app.post("/api/v1/anthropic/agents/{agent_id}/run")
async def run_anthropic_agent(agent_id: str, body: RunAgentBody, bg: BackgroundTasks):
    async def _run_agent():
        await _broadcast({"type": "agent", "event": "anthropic_agent_start", "msg": f"Starting Anthropic Agent: {agent_id}..."})
        try:
            # Stub logic for now
            await asyncio.sleep(2)
            await _broadcast({"type": "agent", "event": "anthropic_agent_done", "msg": f"Agent {agent_id} completed task: {body.query}"})
        except Exception as e:
            await _broadcast({"type": "agent", "event": "anthropic_agent_error", "msg": str(e)})
            
    bg.add_task(_run_agent)
    return {"status": "queued"}


# ═══════════════════════ Activity ═══════════════════════

@app.get("/api/v1/activity")
def activity(limit: int = 100):
    return db.get_activity(limit)


# ═══════════════════════ Serve frontend (production) ═══════════════════════
# When SERVE_FRONTEND=1, serve the compiled React app from ../frontend/dist
# so a single Railway/Render service handles both API and UI.

if os.environ.get("SERVE_FRONTEND") == "1":
    _dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
    if os.path.isdir(_dist):
        app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
        _log.info("Serving frontend from %s", _dist)

        @app.exception_handler(404)
        async def spa_fallback(request, exc):
            return JSONResponse(
                {"detail": "Not Found"},
                status_code=404,
            )


# ═══════════════════════ Entry point ═══════════════════════

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", os.environ.get("BACKEND_PORT", 2860)))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"PORT={port}", flush=True)
    print(f"TOKEN={_API_TOKEN}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")

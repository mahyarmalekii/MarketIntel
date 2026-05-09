"""
Prediction markets module — multi-source, all free, no API keys required.

Sources by category
-------------------
Financial  : Polymarket (gamma-api), Kalshi (public)
Sports     : Polymarket sports markets, Manifold Markets sports group
Politics   : PredictIt (official free API), Metaculus, Manifold politics group
Tech       : Manifold tech/AI group, Polymarket tech/crypto markets

All APIs are public and require no authentication.
"""
import asyncio
import re
from datetime import datetime, timezone
from typing import Any
import httpx
from logger import get_logger

_log = get_logger(__name__)

_H = {"User-Agent": "MarketIntel/1.0 (open-source research tool)"}

# ─── Risk rating ──────────────────────────────────────────────────────────────

def _risk(yes_price: float, volume: float, hours_left: float | None,
          category: str = "") -> int:
    """1 = lowest, 10 = highest risk."""
    p    = max(0.01, min(0.99, yes_price))
    dist = abs(p - 0.5) * 2                         # 0 at 50%, 1 at extremes

    liq = min(volume / 50_000, 1.0) if volume > 0 else 0.0

    if hours_left is None:        tf = 0.3
    elif hours_left < 6:          tf = 1.0
    elif hours_left < 24:         tf = 0.7
    elif hours_left < 168:        tf = 0.4
    else:                         tf = 0.1

    cat = (category or "").lower()
    mult = (1.4 if any(k in cat for k in ("crypto", "bitcoin", "eth", "meme", "nft")) else
            1.2 if any(k in cat for k in ("sport", "nfl", "nba", "soccer", "football", "tennis", "ufc")) else
            1.15 if any(k in cat for k in ("politi", "election", "vote", "congress", "president")) else
            1.1  if any(k in cat for k in ("tech", "ai ", "software", "apple", "google", "nvidia")) else
            1.0)

    raw = (1 + dist * 3.5 + (1 - liq) * 2.5 + tf * 2.5) * mult
    return max(1, min(10, round(raw)))


def _good_bet(yes_price: float, volume: float, risk: int) -> bool:
    return 0.15 <= yes_price <= 0.85 and volume >= 3_000 and risk <= 7


def _hours(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        h  = (dt - datetime.now(tz=timezone.utc)).total_seconds() / 3600
        return max(0.0, h)
    except Exception:
        return None


def _mkt(platform: str, category: str, mid: str, question: str,
         yes_price: float, volume: float, end_date: str | None,
         url: str, extra: dict | None = None) -> dict:
    h      = _hours(end_date)
    r      = _risk(yes_price, volume, h, category)
    gb     = _good_bet(yes_price, volume, r)
    niche  = volume < 50_000 and 0.10 <= yes_price <= 0.90
    big    = volume >= 500_000
    return {
        "id":         mid,
        "platform":   platform,
        "category":   category,
        "question":   question,
        "yes_price":  round(yes_price * 100, 1),
        "no_price":   round((1 - yes_price) * 100, 1),
        "volume_24h": round(volume),
        "end_date":   end_date,
        "hours_left": round(h, 1) if h is not None else None,
        "url":        url,
        "risk":       r,
        "good_bet":   gb,
        "niche_bet":  niche,
        "big_bet":    big,
        **(extra or {}),
    }


# ─── Polymarket ───────────────────────────────────────────────────────────────

_POLY = "https://gamma-api.polymarket.com/markets"

_POLY_CAT_MAP = {
    "crypto": "financial", "finance": "financial", "stocks": "financial",
    "economics": "financial", "business": "financial",
    "sports":  "sports",  "nba": "sports",  "nfl": "sports",  "soccer": "sports",
    "tennis": "sports", "ufc": "sports", "golf": "sports", "baseball": "sports",
    "politics": "politics", "elections": "politics", "government": "politics",
    "tech": "tech", "ai": "tech", "technology": "tech", "science": "tech",
}

def _poly_category(raw: Any) -> str:
    s = " ".join(raw) if isinstance(raw, list) else str(raw or "")
    s_low = s.lower()
    for kw, cat in _POLY_CAT_MAP.items():
        if kw in s_low:
            return cat
    return "financial"   # default for Polymarket


async def fetch_polymarket(limit: int = 40) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15, headers=_H) as c:
            r = await c.get(_POLY, params={
                "active": "true", "closed": "false",
                "limit": limit, "order": "volume24hr", "ascending": "false",
            })
        if not r.is_success:
            return []
        out = []
        for m in r.json():
            try:
                import json as _j
                prices = _j.loads(m.get("outcomePrices") or "[]")
                yp = float(prices[0]) if prices else 0.5
            except Exception:
                yp = 0.5
            vol  = float(m.get("volume24hr") or m.get("volume") or 0)
            tags = m.get("tags") or m.get("category") or []
            cat  = _poly_category(tags)
            slug = m.get("slug", "")
            out.append(_mkt(
                "polymarket", cat,
                str(m.get("id") or m.get("conditionId", "")),
                m.get("question", ""),
                yp, vol, m.get("endDate") or m.get("endDateIso"),
                f"https://polymarket.com/event/{slug}",
            ))
        return out
    except Exception as e:
        _log.error("Polymarket: %s", e)
        return []


# ─── Kalshi ───────────────────────────────────────────────────────────────────

_KALSHI = "https://trading-api.kalshi.com/trade-api/v2/markets"

async def fetch_kalshi(limit: int = 30) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15, headers=_H) as c:
            r = await c.get(_KALSHI, params={"status": "open", "limit": limit,
                                              "sort_by": "liquidity", "order_by": "desc"})
        if not r.is_success:
            return []
        data    = r.json()
        markets = data.get("markets") or (data if isinstance(data, list) else [])
        out = []
        for m in markets:
            yp   = float(m.get("yes_ask") or m.get("yes_bid") or 50) / 100
            vol  = float(m.get("volume") or m.get("dollar_volume") or 0)
            tick = str(m.get("ticker") or m.get("id", ""))
            raw_cat = (m.get("category") or m.get("series_ticker", "")).lower()
            cat = (_poly_category(raw_cat) if raw_cat else "financial")
            out.append(_mkt(
                "kalshi", cat, tick,
                m.get("title") or m.get("question", ""),
                yp, vol,
                m.get("close_time") or m.get("expiration_time"),
                f"https://kalshi.com/markets/{tick}",
            ))
        return out
    except Exception as e:
        _log.error("Kalshi: %s", e)
        return []


# ─── PredictIt (politics + US events) ────────────────────────────────────────

_PREDICTIT = "https://www.predictit.org/api/marketdata/all"

async def fetch_predictit() -> list[dict]:
    """Official PredictIt free data API — no key required."""
    try:
        async with httpx.AsyncClient(timeout=15, headers=_H) as c:
            r = await c.get(_PREDICTIT)
        if not r.is_success:
            return []
        out = []
        for m in r.json().get("markets", []):
            if m.get("status") != "Open":
                continue
            contracts = m.get("contracts") or []
            if not contracts:
                continue
            # Use the best-priced YES contract
            best = max(contracts, key=lambda c: float(c.get("bestBuyYesCost") or 0) or 0.5)
            yp   = float(best.get("bestBuyYesCost") or 0.5)
            if yp == 0:
                yp = 0.5

            name_low = (m.get("name") or "").lower()
            cat = ("sports"   if any(k in name_low for k in ("nfl", "nba", "mlb", "soccer", "sport", "super bowl")) else
                   "politics")

            out.append(_mkt(
                "predictit", cat,
                str(m.get("id", "")),
                m.get("name") or m.get("shortName", ""),
                yp, 0,                     # PredictIt doesn't expose 24h volume
                m.get("timeStamp"),
                m.get("url") or f"https://www.predictit.org/markets/detail/{m.get('id','')}",
            ))
        return out
    except Exception as e:
        _log.error("PredictIt: %s", e)
        return []


# ─── Metaculus (science / tech / world) ───────────────────────────────────────

_META = "https://www.metaculus.com/api2/questions/"

async def fetch_metaculus(limit: int = 20) -> list[dict]:
    """Metaculus public API — no key required."""
    try:
        async with httpx.AsyncClient(timeout=15, headers=_H) as c:
            r = await c.get(_META, params={
                "status": "active",
                "has_community_prediction": "true",
                "order_by": "-activity",
                "limit": limit,
                "forecast_type": "binary",
            })
        if not r.is_success:
            return []
        out = []
        for q in r.json().get("results", []):
            cp = q.get("community_prediction") or {}
            yp = float(cp.get("full", {}).get("q2") or cp.get("q2") or 0.5)
            title_low = (q.get("title") or "").lower()
            cat = ("tech"     if any(k in title_low for k in ("ai", "gpt", "llm", "tech", "software", "apple", "google", "openai", "gpu")) else
                   "politics" if any(k in title_low for k in ("election", "president", "congress", "war", "nato", "ukraine", "trump", "biden")) else
                   "sports"   if any(k in title_low for k in ("nfl", "nba", "fifa", "world cup", "championship", "olympics")) else
                   "tech")

            close_time = q.get("close_time")
            out.append(_mkt(
                "metaculus", cat,
                str(q.get("id", "")),
                q.get("title", ""),
                yp, 0,
                close_time,
                f"https://www.metaculus.com/questions/{q.get('id','')}/",
            ))
        return out
    except Exception as e:
        _log.error("Metaculus: %s", e)
        return []


# ─── Manifold Markets (tech / sports / politics) ─────────────────────────────

_MANIFOLD = "https://api.manifold.markets/v0/markets"

_MANIFOLD_GROUPS = {
    "tech":     ["technology", "ai-and-ml", "programming", "science"],
    "sports":   ["sports", "soccer", "nba", "nfl", "esports"],
    "politics": ["politics", "us-politics", "world", "geopolitics"],
}

async def fetch_manifold(category: str, limit: int = 15) -> list[dict]:
    """Manifold Markets public API — no key required."""
    group_slugs = _MANIFOLD_GROUPS.get(category, [category])
    out: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=20, headers=_H) as c:
            for slug in group_slugs[:2]:   # max 2 groups to stay fast
                r = await c.get(_MANIFOLD, params={
                    "groupSlug": slug,
                    "limit": limit,
                    "sort": "liquidity",
                    "order": "desc",
                    "outcomeType": "BINARY",
                    "isResolved": "false",
                })
                if not r.is_success:
                    continue
                for m in r.json():
                    if m.get("isResolved") or m.get("isClosed"):
                        continue
                    yp  = float(m.get("probability") or 0.5)
                    vol = float(m.get("volume24Hours") or m.get("volume") or 0)
                    out.append(_mkt(
                        "manifold", category,
                        str(m.get("id", "")),
                        m.get("question", ""),
                        yp, vol,
                        m.get("closeTime") and
                            datetime.fromtimestamp(m["closeTime"] / 1000,
                                                   tz=timezone.utc).isoformat(),
                        m.get("url") or f"https://manifold.markets/{m.get('slug','')}",
                    ))
    except Exception as e:
        _log.error("Manifold %s: %s", category, e)
    # deduplicate by id
    seen: set[str] = set()
    deduped = []
    for m in out:
        if m["id"] not in seen:
            seen.add(m["id"])
            deduped.append(m)
    return deduped


# ─── Aggregators ─────────────────────────────────────────────────────────────

async def fetch_financial(limit: int = 25) -> list[dict]:
    poly, kalshi = await asyncio.gather(
        fetch_polymarket(limit),
        fetch_kalshi(limit),
    )
    combined = [m for m in poly + kalshi if m["category"] == "financial"]
    combined.sort(key=lambda m: (-int(m["good_bet"]), -m["volume_24h"]))
    return combined


async def fetch_sports(limit: int = 20) -> list[dict]:
    poly_all, predictit, manifold = await asyncio.gather(
        fetch_polymarket(60),
        fetch_predictit(),
        fetch_manifold("sports", limit),
    )
    sports = ([m for m in poly_all if m["category"] == "sports"]
              + [m for m in predictit if m["category"] == "sports"]
              + manifold)
    sports.sort(key=lambda m: (-int(m["good_bet"]), -m["volume_24h"]))
    return _dedup(sports)[:limit]


async def fetch_politics(limit: int = 20) -> list[dict]:
    poly_all, predictit, metaculus, manifold = await asyncio.gather(
        fetch_polymarket(60),
        fetch_predictit(),
        fetch_metaculus(limit),
        fetch_manifold("politics", limit),
    )
    politics = ([m for m in poly_all if m["category"] == "politics"]
                + [m for m in predictit if m["category"] == "politics"]
                + [m for m in metaculus if m["category"] == "politics"]
                + manifold)
    politics.sort(key=lambda m: (-int(m["good_bet"]), -m["volume_24h"]))
    return _dedup(politics)[:limit]


async def fetch_tech(limit: int = 20) -> list[dict]:
    poly_all, metaculus, manifold = await asyncio.gather(
        fetch_polymarket(60),
        fetch_metaculus(limit),
        fetch_manifold("tech", limit),
    )
    tech = ([m for m in poly_all if m["category"] == "tech"]
            + [m for m in metaculus if m["category"] == "tech"]
            + manifold)
    tech.sort(key=lambda m: (-int(m["good_bet"]), -m["volume_24h"]))
    return _dedup(tech)[:limit]


async def fetch_all(limit: int = 25) -> list[dict]:
    financial, sports, politics, tech = await asyncio.gather(
        fetch_financial(limit),
        fetch_sports(limit),
        fetch_politics(limit),
        fetch_tech(limit),
    )
    combined = financial + sports + politics + tech
    combined.sort(key=lambda m: (-int(m["good_bet"]), -m["volume_24h"]))
    return _dedup(combined)[:limit * 2]


async def fetch_suggestions(limit: int = 15) -> list[dict]:
    """Top suggested bets across all categories, sorted by risk asc."""
    all_markets = await fetch_all(30)
    good = [m for m in all_markets if m["good_bet"]]
    good.sort(key=lambda m: (m["risk"], -m["volume_24h"]))
    return good[:limit]


def _dedup(markets: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for m in markets:
        key = f"{m['platform']}:{m['id']}"
        if key not in seen:
            seen.add(key)
            out.append(m)
    return out

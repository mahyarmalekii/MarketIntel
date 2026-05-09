"""
Flat SQLite layer — no ORM, no graph DB, no vector store.
All public functions return plain dicts; all writes are auto-committed.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

# DATABASE_URL: local path or sqlite:///path/to/file
# Defaults to ./data/market.db so it works both locally and in containers.
_DEFAULT_DB = os.path.join(os.path.dirname(__file__), "data", "market.db")
_DB_URL = os.environ.get("DATABASE_URL", _DEFAULT_DB).removeprefix("sqlite:///")
_BASE = os.path.dirname(os.path.abspath(_DB_URL))
os.makedirs(_BASE, exist_ok=True)
DB_PATH = _DB_URL

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stocks (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    exchange TEXT,
    sector TEXT,
    industry TEXT,
    region TEXT,
    market_cap_tier TEXT,
    last_price REAL,
    prev_close REAL,
    currency TEXT DEFAULT 'USD',
    last_updated TEXT
);
CREATE TABLE IF NOT EXISTS holdings (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    shares REAL NOT NULL,
    avg_cost REAL NOT NULL,
    region TEXT DEFAULT 'US',
    currency TEXT DEFAULT 'USD',
    added_at TEXT,
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT DEFAULT '',
    url TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    sentiment TEXT DEFAULT 'neutral',
    tickers TEXT DEFAULT '[]',
    published_at TEXT DEFAULT '',
    fetched_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    action TEXT DEFAULT 'watch',
    confidence INTEGER DEFAULT 50,
    rationale TEXT DEFAULT '',
    target_price REAL,
    scenario TEXT DEFAULT 'base',
    created_at TEXT,
    model_used TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    affected_sectors TEXT DEFAULT '[]',
    assumptions TEXT DEFAULT '',
    portfolio_impact REAL,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    msg TEXT NOT NULL,
    src TEXT DEFAULT 'system',
    kind TEXT DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    val TEXT DEFAULT ''
);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _conn() as c:
        c.executescript(_SCHEMA)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ──────────────────────── settings ────────────────────────

def get_setting(key: str, default: str = "") -> str:
    with _conn() as c:
        row = c.execute("SELECT val FROM settings WHERE key=?", (key,)).fetchone()
        return row["val"] if row else default


def set_setting(key: str, val: str):
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO settings(key,val) VALUES(?,?)", (key, val))


def get_all_settings() -> dict[str, str]:
    with _conn() as c:
        return {r["key"]: r["val"] for r in c.execute("SELECT key,val FROM settings").fetchall()}


# ──────────────────────── stocks / watchlist ────────────────────────

def upsert_stock(data: dict):
    with _conn() as c:
        c.execute(
            """INSERT OR REPLACE INTO stocks
               (ticker,name,exchange,sector,industry,region,market_cap_tier,
                last_price,prev_close,currency,last_updated)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                data.get("ticker", ""), data.get("name", ""), data.get("exchange", ""),
                data.get("sector", ""), data.get("industry", ""), data.get("region", "US"),
                data.get("market_cap_tier", "unknown"), data.get("last_price"),
                data.get("prev_close"), data.get("currency", "USD"), _now(),
            ),
        )


def get_stocks(region: str | None = None) -> list[dict]:
    with _conn() as c:
        if region:
            rows = c.execute(
                "SELECT * FROM stocks WHERE region=? ORDER BY last_updated DESC", (region,)
            ).fetchall()
        else:
            rows = c.execute("SELECT * FROM stocks ORDER BY last_updated DESC").fetchall()
        return [dict(r) for r in rows]


def get_stock(ticker: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM stocks WHERE ticker=?", (ticker,)).fetchone()
        return dict(row) if row else None


def delete_stock(ticker: str):
    with _conn() as c:
        c.execute("DELETE FROM stocks WHERE ticker=?", (ticker,))


# ──────────────────────── holdings ────────────────────────

def add_holding(data: dict) -> str:
    hid = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            """INSERT INTO holdings (id,ticker,shares,avg_cost,region,currency,added_at,notes)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                hid, data["ticker"].upper(), float(data["shares"]), float(data["avg_cost"]),
                data.get("region", "US"), data.get("currency", "USD"),
                _now(), data.get("notes", ""),
            ),
        )
    return hid


def get_holdings() -> list[dict]:
    with _conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM holdings ORDER BY added_at DESC").fetchall()]


def update_holding(hid: str, data: dict):
    allowed = {k: v for k, v in data.items() if k in ("shares", "avg_cost", "notes") and v is not None}
    if not allowed:
        return
    with _conn() as c:
        sets = ", ".join(f"{k}=?" for k in allowed)
        c.execute(f"UPDATE holdings SET {sets} WHERE id=?", (*allowed.values(), hid))


def delete_holding(hid: str):
    with _conn() as c:
        c.execute("DELETE FROM holdings WHERE id=?", (hid,))


# ──────────────────────── news ────────────────────────

def upsert_news(items: list[dict]):
    now = _now()
    with _conn() as c:
        for item in items:
            c.execute(
                """INSERT OR IGNORE INTO news
                   (id,title,source,url,summary,sentiment,tickers,published_at,fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    item["id"], item.get("title", ""), item.get("source", ""),
                    item.get("url", ""), item.get("summary", "")[:400],
                    item.get("sentiment", "neutral"),
                    json.dumps(item.get("tickers", [])),
                    item.get("published_at", ""), now,
                ),
            )


def get_news(sentiment: str | None = None, limit: int = 50) -> list[dict]:
    with _conn() as c:
        if sentiment:
            rows = c.execute(
                "SELECT * FROM news WHERE sentiment=? ORDER BY fetched_at DESC LIMIT ?",
                (sentiment, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM news ORDER BY fetched_at DESC LIMIT ?", (limit,)
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["tickers"] = json.loads(d.get("tickers", "[]"))
            except Exception:
                d["tickers"] = []
            result.append(d)
        return result


def get_news_for_ticker(ticker: str, limit: int = 20) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM news WHERE tickers LIKE ? ORDER BY fetched_at DESC LIMIT ?",
            (f'%"{ticker}"%', limit),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["tickers"] = json.loads(d.get("tickers", "[]"))
            except Exception:
                d["tickers"] = []
            result.append(d)
        return result


# ──────────────────────── insights ────────────────────────

def save_insight(data: dict) -> str:
    iid = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            """INSERT INTO insights (id,ticker,action,confidence,rationale,target_price,scenario,created_at,model_used)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                iid, data["ticker"], data.get("action", "watch"),
                int(data.get("confidence", 50)), data.get("rationale", ""),
                data.get("target_price"), data.get("scenario", "base"),
                _now(), data.get("model_used", ""),
            ),
        )
    return iid


def get_insights(ticker: str | None = None, limit: int = 50) -> list[dict]:
    with _conn() as c:
        if ticker:
            rows = c.execute(
                "SELECT * FROM insights WHERE ticker=? ORDER BY created_at DESC LIMIT ?",
                (ticker, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM insights ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]


def delete_insight(iid: str):
    with _conn() as c:
        c.execute("DELETE FROM insights WHERE id=?", (iid,))


# ──────────────────────── scenarios ────────────────────────

def save_scenario(data: dict) -> str:
    sid = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            """INSERT INTO scenarios (id,name,description,affected_sectors,assumptions,portfolio_impact,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                sid, data["name"], data.get("description", ""),
                json.dumps(data.get("affected_sectors", [])),
                data.get("assumptions", ""), data.get("portfolio_impact"),
                _now(),
            ),
        )
    return sid


def get_scenarios(limit: int = 20) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM scenarios ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["affected_sectors"] = json.loads(d.get("affected_sectors", "[]"))
            except Exception:
                d["affected_sectors"] = []
            result.append(d)
        return result


def delete_scenario(sid: str):
    with _conn() as c:
        c.execute("DELETE FROM scenarios WHERE id=?", (sid,))


# ──────────────────────── activity log ────────────────────────

def log_activity(msg: str, src: str = "system", kind: str = "system"):
    with _conn() as c:
        c.execute(
            "INSERT INTO activity_log (ts,msg,src,kind) VALUES (?,?,?,?)",
            (_now(), msg, src, kind),
        )


def get_activity(limit: int = 100) -> list[dict]:
    with _conn() as c:
        return [
            dict(r)
            for r in c.execute(
                "SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        ]

"""
Market data: yfinance for quotes/history, feedparser for RSS news.
All free, all local — no API keys required.
"""
import hashlib
from datetime import datetime, timezone
from logger import get_logger

_log = get_logger(__name__)

# ──────────────────────── ticker lists ────────────────────────

US_LARGE = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "V",
    "UNH", "JNJ", "XOM", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "PEP",
    "KO", "AVGO", "COST", "MCD", "CRM", "CSCO", "TMO", "WMT", "BAC", "DIS",
    "ADBE", "NFLX", "AMD", "INTC", "ORCL", "IBM", "QCOM", "TXN", "HON", "GE",
]

EU_LARGE = [
    "VOW3.DE", "BMW.DE", "MBG.DE", "SAP.DE", "SIE.DE", "ALV.DE", "BAS.DE",
    "LVMH.PA", "MC.PA", "OR.PA", "TTE.PA", "BNP.PA", "SAN.PA", "AIR.PA",
    "ASML.AS", "PHIA.AS", "SHELL.AS", "UNA.AS", "INGA.AS", "HEIA.AS",
]

UK_LARGE = [
    "BP.L", "SHEL.L", "HSBA.L", "AZN.L", "ULVR.L", "GSK.L", "RIO.L",
    "BATS.L", "LLOY.L", "BARC.L", "VOD.L", "REL.L", "NG.L", "SSE.L",
    "EXPN.L", "DGE.L", "IMB.L", "AAL.L", "LSEG.L", "CRH.L", "STAN.L",
]

US_PENNY = [
    "AMC", "SNDL", "CLOV", "WKHS", "BBIG", "EXPR", "ASTI", "MMAT",
    "CLNE", "FFIE", "GOEV", "XELA", "IDEX", "ILUS", "EEENF", "VERB",
]

EU_PENNY = ["TUI1.DE", "RNO.PA", "HO.PA"]
UK_PENNY = ["ITV.L", "WPP.L", "OCDO.L"]

ALL_LARGE: dict[str, list[str]] = {"US": US_LARGE, "EU": EU_LARGE, "UK": UK_LARGE}
ALL_PENNY: dict[str, list[str]] = {"US": US_PENNY, "EU": EU_PENNY, "UK": UK_PENNY}

NEWS_FEEDS = [
    # Finance
    "https://feeds.finance.yahoo.com/rss/2.0/headline?region=US&lang=en-US",
    "https://finance.yahoo.com/news/rssindex",
    "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", # CNBC Finance
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",                                        # WSJ Markets
    "https://feeds.bloomberg.com/markets/news.rss",                                          # Bloomberg Markets
    "https://feeds.content.dowjones.io/public/rss/mw_topstories",                           # MarketWatch

    # Investing.com (market news, analysis, commodities, forex, crypto)
    "https://www.investing.com/rss/news.rss",                 # Investing.com top news
    "https://www.investing.com/rss/news_25.rss",              # Investing.com forex
    "https://www.investing.com/rss/news_14.rss",              # Investing.com commodities
    "https://www.investing.com/rss/news_301.rss",             # Investing.com crypto
    "https://www.investing.com/rss/stock_market_news.rss",    # Investing.com stocks

    # Investopedia
    "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline",  # Investopedia headlines
    "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_markets",   # Investopedia markets

    # Politics (Center/Global)
    "https://feeds.bbci.co.uk/news/world/rss.xml",            # BBC World
    "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", # NYT Politics

    # Politics (Right)
    "https://moxie.foxnews.com/google-publisher/politics.xml", # Fox News
    "https://www.washingtontimes.com/rss/headlines/news/politics/", # Washington Times

    # Politics (Left)
    "https://www.msnbc.com/feeds/latest",                      # MSNBC
    "https://www.theguardian.com/world/rss",                   # The Guardian

    # Sports — Football / Soccer
    "https://www.goal.com/feeds/en/news",                      # Goal.com
    "https://www.skysports.com/rss/12040",                     # Sky Sports Football
    "https://feeds.bbci.co.uk/sport/football/rss.xml",         # BBC Sport Football
    "https://www.football365.com/feed",                        # Football365
    "https://www.90min.com/feed",                              # 90min Soccer

    # Sports — US (NFL, NBA, MLB, NHL)
    "https://www.espn.com/espn/rss/news",                      # ESPN All Sports
    "https://www.espn.com/espn/rss/nfl/news",                  # ESPN NFL
    "https://www.espn.com/espn/rss/nba/news",                  # ESPN NBA
    "https://www.espn.com/espn/rss/mlb/news",                  # ESPN MLB
    "https://www.espn.com/espn/rss/nhl/news",                  # ESPN NHL
    "https://bleacherreport.com/articles/feed",                # Bleacher Report

    # Sports — Tennis & Combat
    "https://www.atptour.com/en/media/rss-feed/xml-feed",      # ATP Tour Tennis
    "https://www.skysports.com/rss/12433",                     # Sky Sports Boxing/MMA

    # Sports — F1 & Motor
    "https://www.autosport.com/rss/feed/f1",                   # Autosport F1
    "https://feeds.bbci.co.uk/sport/formula1/rss.xml",         # BBC F1

    # Social/Alt Data — Finance Reddit
    "https://www.reddit.com/r/wallstreetbets/hot/.rss?limit=10",
    "https://www.reddit.com/r/investing/hot/.rss?limit=10",
    "https://www.reddit.com/r/stocks/hot/.rss?limit=10",
    "https://www.reddit.com/r/options/hot/.rss?limit=10",
    "https://www.reddit.com/r/StockMarket/hot/.rss?limit=10",
    "https://www.reddit.com/r/Economics/hot/.rss?limit=10",
    "https://www.reddit.com/r/CryptoCurrency/hot/.rss?limit=10",

    # Social/Alt Data — Politics Reddit
    "https://www.reddit.com/r/politics/hot/.rss?limit=10",
    "https://www.reddit.com/r/worldnews/hot/.rss?limit=10",

    # Social/Alt Data — Sports Reddit
    "https://www.reddit.com/r/soccer/hot/.rss?limit=10",
    "https://www.reddit.com/r/nfl/hot/.rss?limit=10",
    "https://www.reddit.com/r/nba/hot/.rss?limit=10",
    "https://www.reddit.com/r/baseball/hot/.rss?limit=10",
    "https://www.reddit.com/r/hockey/hot/.rss?limit=10",
    "https://www.reddit.com/r/tennis/hot/.rss?limit=10",
    "https://www.reddit.com/r/formula1/hot/.rss?limit=10",
    "https://www.reddit.com/r/MMA/hot/.rss?limit=10",
    "https://www.reddit.com/r/boxing/hot/.rss?limit=10",

    # TradingView (market news, analysis, economic events)
    "https://news.tradingview.com/rss/",              # TradingView top news
]

# Default X/Twitter accounts to follow via Nitter RSS.
# Finance: market intelligence, macro, institutional flow
# Sports: major outlets for prediction market context
DEFAULT_X_ACCOUNTS: list[str] = [
    # ── Finance / Markets ──────────────────────────────────────
    "unusual_whales",   # Options flow & dark pool prints
    "zerohedge",        # Macro / contrarian / market stress
    "marketwatch",      # MarketWatch official
    "WSJmarkets",       # WSJ Markets desk
    "ReutersFinance",   # Reuters Finance
    "business",         # Bloomberg Business
    "FT",               # Financial Times
    "CNBC",             # CNBC
    "StockMKTNewz",     # Real-time market news aggregator
    "DeItaone",         # Breaking financial headlines
    "GoldmanSachs",     # Goldman Sachs research & commentary
    "jpmorgan",         # JPMorgan official
    "elerianm",         # Mohamed El-Erian (macro strategist, ex-PIMCO CEO)
    "jimcramer",        # Jim Cramer (market-moving retail sentiment)
    "KobeissiLetter",   # The Kobeissi Letter (macro analysis)
    "TaviCosta",        # Tavi Costa (global macro / commodities)
    "LynAldenContact",  # Lyn Alden (macro / monetary policy)
    "profgalloway",     # Scott Galloway (tech/business commentary)

    # ── Finance Reporters & Journalists ───────────────────────
    "byHeatherlong",    # Washington Post economics reporter
    "jennablan",        # Reuters markets reporter
    "NickTimiraos",     # WSJ Fed reporter (market-moving)
    "colbyLsmith",      # FT markets correspondent
    "ericwallerstein",  # WSJ markets correspondent
    "RobinWigg",        # Bloomberg macro reporter

    # ── Politics / Geopolitics ─────────────────────────────────
    "axios",            # Axios breaking politics
    "politico",         # Politico US politics
    "thehill",          # The Hill political news
    "HuffPost",         # HuffPost politics
    "Vox",              # Vox policy analysis
    "AP",               # Associated Press
    "Reuters",          # Reuters geopolitics
    "BBCBreaking",      # BBC breaking news
    "AFP",              # Agence France-Presse
    "spectatorindex",   # Global political events feed
    "sentdefender",     # Geopolitical analyst (widely followed)
    "TruthAbtMkts",     # Political + market cross-analysis
    "KyleAnzalone_",    # Foreign policy journalist

    # ── Politics Reporters & Columnists ───────────────────────
    "maggieNYT",        # Maggie Haberman (NYT White House)
    "jonkarl",          # Jon Karl (ABC News chief Washington)
    "JakeTapper",       # Jake Tapper (CNN anchor)
    "chucktodd",        # Chuck Todd (political analyst)
    "ezraklein",        # Ezra Klein (policy/economics)
    "natesilver538",    # Nate Silver (political forecasting)

    # ── Sports ─────────────────────────────────────────────────
    "espn",             # ESPN all sports
    "BBCSport",         # BBC Sport
    "SkySports",        # Sky Sports
    "goal",             # Goal.com soccer
    "F1",               # Formula 1 official
    "UFC",              # UFC official
    "BleacherReport",   # Bleacher Report
    "SportsCenter",     # ESPN SportsCenter

    # ── Sports Reporters & Insiders ───────────────────────────
    "AdamSchefter",     # ESPN NFL insider (most influential)
    "RapSheet",         # NFL Network insider
    "ShamsCharania",    # NBA insider (The Athletic / TNT)
    "wojespn",          # Adrian Wojnarowski ESPN NBA insider
    "Ken_Rosenthal",    # MLB insider (The Athletic)
    "JeffPassan",       # ESPN MLB reporter
    "PierreLeBlancNHL", # NHL insider
    "FabrizioRomano",   # Soccer transfer specialist ("here we go")
    "david_ornstein",   # The Athletic soccer insider
    "MikeColangelo",    # F1 & motorsport reporter
    "arielhelwani",     # MMA / combat sports journalist
    "SteveBerryMMA",    # MMA journalist

    # ── Crypto / Digital Assets ───────────────────────────────
    "VitalikButerin",   # Ethereum co-founder
    "saylor",           # Michael Saylor (Bitcoin maximalist)
    "CryptoBirb",       # Crypto technical analysis
    "DocumentingBTC",   # Bitcoin on-chain data
    "WuBlockchain",     # Wu Blockchain (Asia crypto news)
]

# ──────────────────────── helpers ────────────────────────

def _cap_tier(market_cap: float | None) -> str:
    if not market_cap:
        return "unknown"
    if market_cap < 3e8:
        return "penny"
    if market_cap < 2e9:
        return "small"
    if market_cap < 10e9:
        return "mid"
    return "large"


def _region(ticker: str) -> str:
    if ticker.endswith(".L"):
        return "UK"
    if any(ticker.endswith(x) for x in (".DE", ".PA", ".AS", ".MI", ".MC", ".SW")):
        return "EU"
    return "US"


def _news_id(url: str, title: str) -> str:
    return hashlib.md5(f"{url}{title}".encode()).hexdigest()


_BULL = {"rise", "gain", "surge", "rally", "bull", "beat", "profit", "growth",
         "up", "positive", "record", "strong", "soar", "jump", "boost"}
_BEAR = {"fall", "drop", "loss", "decline", "bear", "miss", "weak", "cut",
         "down", "risk", "concern", "crash", "plunge", "warn", "slump"}


def _sentiment(text: str) -> str:
    words = set(text.lower().split())
    b = len(words & _BULL)
    d = len(words & _BEAR)
    if b > d:
        return "bullish"
    if d > b:
        return "bearish"
    return "neutral"


# ──────────────────────── quotes ────────────────────────

def get_quote(ticker: str) -> dict:
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.info
        price = (
            info.get("currentPrice")
            or info.get("regularMarketPrice")
            or info.get("previousClose")
        )
        return {
            "ticker": ticker,
            "name": info.get("longName") or info.get("shortName", ""),
            "exchange": info.get("exchange", ""),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "region": _region(ticker),
            "market_cap_tier": _cap_tier(info.get("marketCap")),
            "last_price": price,
            "prev_close": info.get("previousClose"),
            "currency": info.get("currency", "USD"),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
            "avg_volume": info.get("averageVolume"),
            "beta": info.get("beta"),
            "dividend_yield": info.get("dividendYield"),
            "description": (info.get("longBusinessSummary", "") or "")[:500],
        }
    except Exception as e:
        _log.warning("get_quote %s: %s", ticker, e)
        return {"ticker": ticker, "error": str(e)}


def get_history(ticker: str, period: str = "3mo") -> list[dict]:
    try:
        import yfinance as yf
        hist = yf.Ticker(ticker).history(period=period)
        result = []
        for idx, row in hist.iterrows():
            result.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]),
            })
        return result
    except Exception as e:
        _log.warning("get_history %s: %s", ticker, e)
        return []


# ──────────────────────── scanning ────────────────────────

def scan_region(region: str, cap_tier: str | None = None, limit: int = 25) -> list[dict]:
    tickers = ALL_LARGE.get(region.upper(), US_LARGE)[:limit]
    results = []
    for ticker in tickers:
        q = get_quote(ticker)
        if "error" in q:
            continue
        if cap_tier and q.get("market_cap_tier") != cap_tier:
            continue
        results.append(q)
    return results


def get_penny_stocks(region: str = "US") -> list[dict]:
    tickers = ALL_PENNY.get(region.upper(), US_PENNY)
    results = []
    for ticker in tickers:
        q = get_quote(ticker)
        if "error" not in q:
            results.append(q)
    return results


# ──────────────────────── news ────────────────────────

def fetch_news(watchlist_tickers: list[str] | None = None) -> list[dict]:
    try:
        import feedparser
    except ImportError:
        _log.error("feedparser not installed")
        return []

    items: list[dict] = []
    seen: set[str] = set()

    # Per-ticker Yahoo Finance RSS
    for ticker in (watchlist_tickers or [])[:8]:
        url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:6]:
                nid = _news_id(entry.get("link", ""), entry.get("title", ""))
                if nid in seen:
                    continue
                seen.add(nid)
                items.append({
                    "id": nid,
                    "title": entry.get("title", ""),
                    "source": "Yahoo Finance",
                    "url": entry.get("link", ""),
                    "summary": (entry.get("summary", "") or "")[:350],
                    "sentiment": _sentiment(
                        entry.get("title", "") + " " + entry.get("summary", "")
                    ),
                    "tickers": [ticker],
                    "published_at": entry.get("published", ""),
                })
        except Exception as e:
            _log.warning("ticker news %s: %s", ticker, e)

    # General finance feeds
    for feed_url in NEWS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:20]:
                nid = _news_id(entry.get("link", ""), entry.get("title", ""))
                if nid in seen:
                    continue
                seen.add(nid)
                items.append({
                    "id": nid,
                    "title": entry.get("title", ""),
                    "source": feed.feed.get("title", "Finance News"),
                    "url": entry.get("link", ""),
                    "summary": (entry.get("summary", "") or "")[:350],
                    "sentiment": _sentiment(
                        entry.get("title", "") + " " + entry.get("summary", "")
                    ),
                    "tickers": [],
                    "published_at": entry.get("published", ""),
                })
        except Exception as e:
            _log.warning("feed %s: %s", feed_url, e)

    return items


def fetch_x_news(nitter_instance: str, accounts: list[str] | None = None) -> list[dict]:
    """Fetch posts from X/Twitter accounts via a Nitter RSS instance (free, no API key).

    nitter_instance: base URL of a running Nitter instance, e.g. "https://nitter.privacydev.net"
    Silently returns [] if the instance is unavailable or not configured.
    """
    if not nitter_instance:
        return []

    try:
        import feedparser
    except ImportError:
        return []

    instance = nitter_instance.rstrip("/")
    accs     = accounts or DEFAULT_X_ACCOUNTS
    items: list[dict] = []
    seen:  set[str]   = set()

    for acc in accs[:20]:
        rss_url = f"{instance}/{acc}/rss"
        try:
            feed = feedparser.parse(rss_url)
            if not feed.entries:
                continue
            for entry in feed.entries[:6]:
                nid = _news_id(entry.get("link", ""), entry.get("title", ""))
                if nid in seen:
                    continue
                seen.add(nid)
                text = entry.get("title", "") + " " + (entry.get("summary", "") or "")
                items.append({
                    "id":           nid,
                    "title":        (entry.get("title") or "")[:280],
                    "source":       f"X @{acc}",
                    "url":          entry.get("link", ""),
                    "summary":      (entry.get("summary", "") or "")[:350],
                    "sentiment":    _sentiment(text),
                    "tickers":      [],
                    "published_at": entry.get("published", ""),
                    "fetched_at":   datetime.now(tz=timezone.utc).isoformat(),
                })
        except Exception as e:
            _log.debug("x nitter %s/%s: %s", instance, acc, e)

    _log.info("X nitter: fetched %d posts from %d accounts", len(items), len(accs))
    return items

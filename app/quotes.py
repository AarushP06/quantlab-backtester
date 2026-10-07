"""Cached provider quotes for symbols listed in the market explorer."""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

QUOTE_URL = "https://finnhub.io/api/v1/quote"
CANDLE_URL = "https://finnhub.io/api/v1/stock/candle"
NEW_YORK = ZoneInfo("America/New_York")


class QuoteUnavailable(Exception):
    """The upstream provider did not supply a usable quote."""


class UnknownSymbol(Exception):
    """A symbol is outside the configured public market explorer."""


class MarketQuoteService:
    def __init__(
        self, api_key: str | None, symbols: set[str],
        opener=urlopen, ttl_seconds: int = 60,
    ):
        self.api_key = api_key
        self.symbols = frozenset(symbols)
        self.opener = opener
        self.ttl_seconds = ttl_seconds
        self._cached: dict[str, tuple[float, dict]] = {}
        self._candle_cache: dict[str, tuple[float, dict]] = {}
        self._lock = Lock()

    def _check_symbol(self, symbol: str) -> str:
        symbol = symbol.upper()
        if symbol not in self.symbols:
            raise UnknownSymbol(f"Symbol {symbol!r} is not in the market explorer.")
        if not self.api_key:
            raise QuoteUnavailable("Quote provider is not configured.")
        return symbol

    def get(self, symbol: str) -> dict:
        symbol = self._check_symbol(symbol)
        with self._lock:
            now = time.monotonic()
            cached = self._cached.get(symbol)
            if cached is not None and now < cached[0]:
                return cached[1]
            request = Request(
                f"{QUOTE_URL}?{urlencode({'symbol': symbol})}",
                headers={"X-Finnhub-Token": self.api_key, "Accept": "application/json"},
            )
            try:
                with self.opener(request, timeout=5) as response:
                    raw = json.loads(response.read(65536))
                price = float(raw["c"])
                previous = float(raw["pc"])
                if not math.isfinite(price) or not math.isfinite(previous):
                    raise ValueError("non-finite price")
                if price <= 0 or previous <= 0:
                    raise ValueError("missing price")
                timestamp = raw.get("t")
                quote_time = (
                    datetime.fromtimestamp(float(timestamp), timezone.utc).isoformat()
                    if timestamp and float(timestamp) > 0 else None
                )
            except (
                HTTPError, URLError, OSError, ValueError, KeyError, TypeError,
                OverflowError,
            ) as exc:
                raise QuoteUnavailable("Quote provider is temporarily unavailable.") from exc

            quote = {
                "symbol": symbol,
                "price": price,
                "previous_close": previous,
                "change": round(price - previous, 6),
                "change_percent": round((price / previous - 1) * 100, 6),
                "quote_time": quote_time,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "source": "Finnhub",
            }
            self._cached[symbol] = (now + self.ttl_seconds, quote)
            return quote

    def get_candles(self, symbol: str) -> dict:
        """Return provider one-minute OHLC bars from the latest available session."""
        symbol = self._check_symbol(symbol)
        with self._lock:
            now = time.monotonic()
            cached = self._candle_cache.get(symbol)
            if cached is not None and now < cached[0]:
                return cached[1]
            end = int(time.time())
            request = Request(
                f"{CANDLE_URL}?{urlencode({'symbol': symbol, 'resolution': '1', 'from': end - 7 * 86400, 'to': end})}",
                headers={"X-Finnhub-Token": self.api_key, "Accept": "application/json"},
            )
            try:
                with self.opener(request, timeout=8) as response:
                    raw = json.loads(response.read(1_000_000))
                if raw.get("s") != "ok":
                    raise ValueError("no candle data")
                columns = [raw[key] for key in ("t", "o", "h", "l", "c", "v")]
                count = len(columns[0])
                if not 0 < count <= 10000 or any(len(col) != count for col in columns):
                    raise ValueError("invalid candle lengths")
                dates = [datetime.fromtimestamp(int(stamp), NEW_YORK).date() for stamp in columns[0]]
                last_day = max(dates)
                candles = []
                for index, session in enumerate(dates):
                    if session != last_day:
                        continue
                    stamp = int(columns[0][index])
                    open_, high, low, close, volume = (
                        float(col[index]) for col in columns[1:]
                    )
                    if (
                        not all(math.isfinite(value) for value in (open_, high, low, close, volume))
                        or low <= 0 or volume < 0 or high < max(open_, close)
                        or low > min(open_, close)
                    ):
                        raise ValueError("invalid candle prices")
                    candles.append({
                        "time": datetime.fromtimestamp(stamp, timezone.utc).isoformat(),
                        "open": open_, "high": high, "low": low,
                        "close": close, "volume": volume,
                    })
                if not candles:
                    raise ValueError("no candles for latest session")
                candles.sort(key=lambda candle: candle["time"])
            except (
                HTTPError, URLError, OSError, ValueError, KeyError, TypeError,
                OverflowError,
            ) as exc:
                raise QuoteUnavailable("One-minute candles are unavailable from the provider.") from exc

            result = {
                "symbol": symbol,
                "resolution": "1 minute",
                "session_date": last_day.isoformat(),
                "latest_bar_time": candles[-1]["time"],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "source": "Finnhub",
                "candles": candles,
            }
            self._candle_cache[symbol] = (now + self.ttl_seconds, result)
            return result

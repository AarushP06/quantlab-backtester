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

QUOTE_URL = "https://finnhub.io/api/v1/quote"


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
        self._lock = Lock()

    def get(self, symbol: str) -> dict:
        symbol = symbol.upper()
        if symbol not in self.symbols:
            raise UnknownSymbol(f"Symbol {symbol!r} is not in the market explorer.")
        if not self.api_key:
            raise QuoteUnavailable("Quote provider is not configured.")
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

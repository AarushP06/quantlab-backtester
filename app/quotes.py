"""A small, cached adapter for one provider quote.

The backtest snapshot stays fixed. This adapter is used only for the public
GOOGL quote displayed alongside the historical market explorer.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

QUOTE_URL = "https://finnhub.io/api/v1/quote?symbol=GOOGL"


class QuoteUnavailable(Exception):
    """The upstream provider did not supply a usable quote."""


class GoogleQuoteService:
    def __init__(self, api_key: str | None, opener=urlopen, ttl_seconds: int = 60):
        self.api_key = api_key
        self.opener = opener
        self.ttl_seconds = ttl_seconds
        self._cached: dict | None = None
        self._expires_at = 0.0
        self._lock = Lock()

    def get(self) -> dict:
        if not self.api_key:
            raise QuoteUnavailable("Quote provider is not configured.")
        with self._lock:
            now = time.monotonic()
            if self._cached is not None and now < self._expires_at:
                return self._cached
            request = Request(
                QUOTE_URL,
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

            self._cached = {
                "symbol": "GOOGL",
                "price": price,
                "previous_close": previous,
                "change": round(price - previous, 6),
                "change_percent": round((price / previous - 1) * 100, 6),
                "quote_time": quote_time,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "source": "Finnhub",
            }
            self._expires_at = now + self.ttl_seconds
            return self._cached

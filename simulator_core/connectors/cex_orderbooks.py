from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple
import time


DEPTH_LEVELS_PCT = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0)

def _curve_key(pct: float) -> str:
    return (str(pct).rstrip('0').rstrip('.'))


@dataclass
class BookSnapshot:
    symbol: str
    venue: str
    base: str
    quote: str
    mid: float
    spread_bps: float
    daily_volume_usd: Optional[float]
    depth_1pct_usd: float
    depth_2pct_usd: float
    quality: str
    volume_status: str = "unknown"
    note: str = ""


def _split_symbol(symbol: str) -> Tuple[str, str]:
    if '/' in symbol:
        return tuple(symbol.split('/', 1))  # type: ignore[return-value]
    return symbol[:3], symbol[3:]


def _num(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        n = float(v)
        return n if n > 0 else None
    except Exception:
        return None


def _pick_num(d: Dict[str, Any], keys: List[str]) -> Optional[float]:
    for k in keys:
        if k in d:
            n = _num(d.get(k))
            if n is not None:
                return n
    return None


def _extract_ticker_volume_usd(ticker: Dict[str, Any], mid: float, fx: float) -> Tuple[Optional[float], str]:
    """Return USD 24h volume from ccxt ticker using normalized fields + exchange-specific info.

    Correct rule: never return 0 for a live market unless the exchange explicitly gives no volume.
    If volume cannot be read, return None so UI does not print a false `$0`.
    """
    if not ticker or mid <= 0:
        return None, "ticker_missing"

    qv = _num(ticker.get('quoteVolume'))
    if qv is not None:
        return qv * fx, "ticker_quoteVolume"

    bv = _num(ticker.get('baseVolume'))
    if bv is not None:
        return bv * mid * fx, "ticker_baseVolume"

    info = ticker.get('info') or {}
    if isinstance(info, dict):
        quote_keys = [
            'quoteVolume', 'quote_volume', 'quote_volume_24h', 'quoteVolume24h',
            'volume_quote', 'volumeQuote', 'turnover', 'turnover24h', 'quoteVol',
            'quote_vol', 'notional', 'notionalVolume', 'notional_volume', 'amount_24h'
        ]
        base_keys = [
            'baseVolume', 'base_volume', 'base_volume_24h', 'baseVolume24h',
            'volume', 'volume_24h', 'vol', 'vol24h', 'amount', 'baseVol', 'base_vol'
        ]
        qv = _pick_num(info, quote_keys)
        if qv is not None:
            return qv * fx, "ticker_info_quote_volume"
        bv = _pick_num(info, base_keys)
        if bv is not None:
            return bv * mid * fx, "ticker_info_base_volume"

    return None, "ticker_volume_unavailable"


def _fetch_ohlcv_volume_usd(ex: Any, symbol: str, fx: float) -> Tuple[Optional[float], str]:
    """Fallback: daily candle volume is base volume in ccxt."""
    try:
        if not getattr(ex, 'has', {}).get('fetchOHLCV'):
            return None, "ohlcv_not_supported"
        candles = ex.fetch_ohlcv(symbol, timeframe='1d', limit=3)
        # Prefer the latest candle with non-zero close and volume.
        for c in reversed(candles or []):
            if len(c) >= 6:
                close = _num(c[4])
                vol_base = _num(c[5])
                if close is not None and vol_base is not None:
                    return close * vol_base * fx, "ohlcv_1d_base_volume"
    except Exception as exc:
        return None, f"ohlcv_failed:{exc}"
    return None, "ohlcv_volume_unavailable"


def _depth_usd(orderbook: Dict[str, Any], mid: float, quote_fx: float, pct: float) -> float:
    if not mid or mid <= 0:
        return 0.0
    lower = mid * (1 - pct)
    upper = mid * (1 + pct)
    bid_depth = sum(float(l[0]) * float(l[1]) * quote_fx for l in orderbook.get('bids', []) if len(l) >= 2 and float(l[0]) >= lower)
    ask_depth = sum(float(l[0]) * float(l[1]) * quote_fx for l in orderbook.get('asks', []) if len(l) >= 2 and float(l[0]) <= upper)
    return float(bid_depth + ask_depth)


def _depth_curve_usd(orderbook: Dict[str, Any], mid: float, quote_fx: float) -> Dict[str, float]:
    """Depth curve around mid price. Keys are percentage bands: 0.1, 0.25, 0.5, 1, 2, 5.

    This lets the UI depth cursor calculate slippage from the selected band instead
    of forcing every scenario to use only ±1% or ±2%.
    """
    return {_curve_key(p): _depth_usd(orderbook, mid, quote_fx, p / 100.0) for p in DEPTH_LEVELS_PCT}


def fetch_cex_orderbooks(config: Dict[str, Any], timeout_ms: int = 14000) -> List[Dict[str, Any]]:
    """Fetch CEX orderbooks via ccxt if installed. Returns normalized dictionaries.

    Defensive behavior: if a market's depth is live but volume is unavailable, we keep the live depth
    and mark the volume as None instead of showing a false zero.
    """
    try:
        import ccxt  # type: ignore
    except Exception as exc:
        return [asdict(BookSnapshot('CEX_DISABLED', 'ccxt', 'XRP', 'USD', 0, 0, None, 0, 0, f'ccxt_missing:{exc}', 'unavailable'))]

    cex_cfg = config.get('cex', {})
    quote_fx = cex_cfg.get('quote_fx', {})
    timeout_ms = int(cex_cfg.get('timeout_ms', timeout_ms))
    limit = int(cex_cfg.get('depth_limit', 100))
    out: List[Dict[str, Any]] = []

    for ex_id, symbols in cex_cfg.get('exchanges', {}).items():
        try:
            ex_class = getattr(ccxt, ex_id)
            ex = ex_class({'enableRateLimit': True, 'timeout': timeout_ms})
            ex.load_markets()
        except Exception as exc:
            out.append(asdict(BookSnapshot('XRP/USD', ex_id, 'XRP', 'USD', 0, 0, None, 0, 0, f'exchange_init_failed:{exc}', 'unavailable')))
            continue

        for symbol in symbols:
            base, quote = _split_symbol(symbol)
            if symbol not in getattr(ex, 'markets', {}):
                out.append(asdict(BookSnapshot(symbol, ex_id, base, quote, 0, 0, None, 0, 0, 'symbol_not_listed', 'unavailable')))
                continue
            try:
                ob_limit = limit
                if ex_id in ('kucoin',):
                    ob_limit = 100
                if ex_id in ('okx',):
                    ob_limit = 400

                ob = ex.fetch_order_book(symbol, limit=ob_limit)
                raw_bids = ob.get('bids') or []
                raw_asks = ob.get('asks') or []
                bids = [[float(l[0]), float(l[1])] for l in raw_bids if len(l) >= 2]
                asks = [[float(l[0]), float(l[1])] for l in raw_asks if len(l) >= 2]
                if not bids or not asks:
                    out.append(asdict(BookSnapshot(symbol, ex_id, base, quote, 0, 0, None, 0, 0, 'empty_book', 'unavailable')))
                    continue

                bid, ask = float(bids[0][0]), float(asks[0][0])
                mid_quote = (bid + ask) / 2
                spread = ((ask - bid) / mid_quote) * 10000 if mid_quote else 0
                fx = float(quote_fx.get(quote, 1.0))
                curve = _depth_curve_usd(ob, mid_quote, fx)
                depth1 = curve.get('1', 0.0)
                depth2 = curve.get('2', 0.0)

                vol_usd: Optional[float] = None
                vol_status = 'ticker_not_called'
                try:
                    ticker = ex.fetch_ticker(symbol)
                    vol_usd, vol_status = _extract_ticker_volume_usd(ticker, mid_quote, fx)
                except Exception as exc:
                    vol_status = f'ticker_failed:{exc}'

                if vol_usd is None:
                    vol_usd, ohlcv_status = _fetch_ohlcv_volume_usd(ex, symbol, fx)
                    vol_status = ohlcv_status if vol_usd is not None else f'{vol_status}|{ohlcv_status}'

                note = '' if vol_usd is not None else 'Volumen 24h no expuesto por esta API; profundidad y spread sí son live.'
                row = asdict(BookSnapshot(symbol, ex_id, base, quote, mid_quote * fx, spread, vol_usd, depth1, depth2, 'live_cex', vol_status, note))
                row['depth_curve_usd'] = curve
                row['depth_cursor_source'] = 'live_cex_orderbook'
                row['orderbook_updated_at'] = int(time.time())
                out.append(row)
                time.sleep(getattr(ex, 'rateLimit', 200) / 1000)
            except Exception as exc:
                out.append(asdict(BookSnapshot(symbol, ex_id, base, quote, 0, 0, None, 0, 0, f'fetch_failed:{exc}', 'unavailable')))
    return out

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
import json
import time
import urllib.parse
import urllib.request


@dataclass
class ETFMarketRow:
    symbol: str
    venue: str
    base: str
    quote: str
    mid: float
    spread_bps: Optional[float]
    daily_volume_usd: Optional[float]
    depth_1pct_usd: Optional[float]
    depth_2pct_usd: Optional[float]
    quality: str
    ticker: str
    volume_status: str = "unknown"
    note: str = ""
    source_url: str = ""


def _num(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        n = float(v)
        return n if n > 0 else None
    except Exception:
        return None


def _get_json(url: str, timeout: int) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 RippleInfrastructureTwin/10.8',
            'Accept': 'application/json,text/plain,*/*',
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _yahoo_chart_quote(ticker: str, timeout: int) -> Dict[str, Any]:
    q = urllib.parse.quote(ticker, safe='')
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=5d&interval=1d'
    js = _get_json(url, timeout)
    result = (js.get('chart') or {}).get('result') or []
    if not result:
        raise RuntimeError('empty_yahoo_chart')
    r0 = result[0]
    meta = r0.get('meta') or {}
    quote = ((r0.get('indicators') or {}).get('quote') or [{}])[0]
    volumes = quote.get('volume') or []
    closes = quote.get('close') or []

    price = _num(meta.get('regularMarketPrice'))
    if price is None:
        for c in reversed(closes):
            price = _num(c)
            if price is not None:
                break

    shares = None
    for v in reversed(volumes):
        shares = _num(v)
        if shares is not None:
            break

    currency = meta.get('currency') or 'USD'
    return {
        'price': price,
        'shares_volume': shares,
        'currency': currency,
        'exchange': meta.get('exchangeName') or meta.get('fullExchangeName') or 'Yahoo Finance',
        'regularMarketTime': meta.get('regularMarketTime'),
    }


def fetch_etf_market_rows(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch ETF/ETP share-market quotes.

    Important modeling rule: ETF share liquidity is NOT XRP spot orderbook depth.
    We update ETF price/volume as a separate proxy and leave depth fields empty.
    """
    cfg = config.get('etf', {})
    if not cfg.get('enabled', True):
        return []
    timeout = int(cfg.get('timeout_sec', 10))
    quote_fx = (config.get('cex') or {}).get('quote_fx', {})
    rows: List[Dict[str, Any]] = []

    for item in cfg.get('tickers', []):
        ticker = item.get('ticker')
        if not ticker:
            continue
        name = item.get('name') or ticker
        source_url = item.get('source_url') or ''
        try:
            q = _yahoo_chart_quote(ticker, timeout)
            price = q.get('price')
            shares = q.get('shares_volume')
            currency = q.get('currency') or 'USD'
            fx = float(quote_fx.get(currency, 1.0))
            vol_usd = price * shares * fx if price and shares else None
            status = 'yahoo_chart_price_volume' if vol_usd is not None else 'yahoo_chart_price_only'
            note = 'Volumen secundario de acciones ETF/ETP; no es profundidad spot XRP.' if vol_usd is not None else 'Precio ETF/ETP live; volumen de acciones no disponible en la consulta.'
            rows.append(asdict(ETFMarketRow(
                symbol=item.get('symbol', 'ETF/XRP-US'),
                venue=name,
                base='ETF',
                quote='USD',
                mid=float(price or 0) * fx,
                spread_bps=None,
                daily_volume_usd=vol_usd,
                depth_1pct_usd=None,
                depth_2pct_usd=None,
                quality='etf_live_quote' if price else 'etf_quote_unavailable',
                ticker=ticker,
                volume_status=status,
                note=note,
                source_url=source_url,
            )))
        except Exception as exc:
            rows.append(asdict(ETFMarketRow(
                symbol=item.get('symbol', 'ETF/XRP-US'),
                venue=name,
                base='ETF',
                quote='USD',
                mid=0,
                spread_bps=None,
                daily_volume_usd=None,
                depth_1pct_usd=None,
                depth_2pct_usd=None,
                quality='etf_quote_unavailable',
                ticker=ticker,
                volume_status=f'fetch_failed:{exc}',
                note='No se pudo actualizar el ETF/ETP en esta ejecución. No se usa como orderbook spot XRP.',
                source_url=source_url,
            )))
        time.sleep(float(cfg.get('sleep_sec', 0.15)))
    return rows

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
import json
import time
import urllib.request

DEPTH_LEVELS_PCT = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0)

def _curve_key(pct: float) -> str:
    return (str(pct).rstrip('0').rstrip('.'))


@dataclass
class XRPLBookSnapshot:
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
    volume_status: str = "not_computed"
    note: str = ""


def _post_json(url: str, payload: Dict[str, Any], timeout: int) -> Dict[str, Any]:
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _issuer_amount_to_float(v: Any) -> float:
    if isinstance(v, dict):
        try: return float(v.get('value', 0))
        except Exception: return 0.0
    try:
        # XRP drops
        return float(v) / 1_000_000
    except Exception:
        return 0.0


def _fetch_book(url: str, taker_gets: Dict[str, Any], taker_pays: Dict[str, Any], limit: int, timeout: int) -> List[Dict[str, Any]]:
    payload = {"method":"book_offers", "params":[{"taker_gets": taker_gets, "taker_pays": taker_pays, "limit": limit}]}
    js = _post_json(url, payload, timeout)
    return js.get('result', {}).get('offers', []) or []


def _normalize_book(symbol: str, label: str, currency: str, issuer: str, usd_factor: float, offers_buy: List[Dict[str,Any]], offers_sell: List[Dict[str,Any]]) -> Dict[str, Any]:
    # Buy side: offers where taker_gets issued asset and pays XRP, or the reverse depending orientation.
    quotes = []
    depth1 = depth2 = 0.0
    # We approximate price = issued asset per XRP. This is enough for relative depth/slippage.
    rows = []
    for off in offers_buy + offers_sell:
        gets = off.get('TakerGets')
        pays = off.get('TakerPays')
        gets_f = _issuer_amount_to_float(gets)
        pays_f = _issuer_amount_to_float(pays)
        if gets_f <= 0 or pays_f <= 0: continue
        # If one side is XRP drops and one is issued asset, infer XRP price in issued quote.
        gets_is_xrp = not isinstance(gets, dict)
        pays_is_xrp = not isinstance(pays, dict)
        if gets_is_xrp and not pays_is_xrp:
            xrp_amt = gets_f; quote_amt = pays_f
        elif pays_is_xrp and not gets_is_xrp:
            xrp_amt = pays_f; quote_amt = gets_f
        else:
            continue
        price_usd = (quote_amt / xrp_amt) * usd_factor if xrp_amt else 0
        notional = quote_amt * usd_factor
        if price_usd > 0:
            rows.append((price_usd, notional))
            quotes.append(price_usd)
    if not rows:
        return asdict(XRPLBookSnapshot(symbol, label, 'XRP', symbol.split('/')[-1], 0, 0, None, 0, 0, 'xrpl_empty_or_unfunded', 'not_computed', 'Sin ofertas suficientes en book_offers.'))
    quotes.sort()
    mid = quotes[len(quotes)//2]
    bid = min(quotes, key=lambda x: abs(x - mid*0.999))
    ask = min(quotes, key=lambda x: abs(x - mid*1.001))
    spread = abs(ask-bid)/mid*10000 if mid else 0
    curve = {}
    for pct in DEPTH_LEVELS_PCT:
        band = pct / 100.0
        curve[_curve_key(pct)] = sum(notional for price, notional in rows if abs(price-mid)/mid <= band)
    depth1 = curve.get('1', 0.0)
    depth2 = curve.get('2', 0.0)
    row = asdict(XRPLBookSnapshot(symbol, label, 'XRP', symbol.split('/')[-1], mid, spread, None, depth1, depth2, 'live_xrpl_dex', 'requires_trade_indexer', 'Profundidad live por book_offers; volumen 24h XRPL requiere indexador histórico de trades/AMM.'))
    row['depth_curve_usd'] = curve
    row['depth_cursor_source'] = 'live_xrpl_book_offers'
    row['orderbook_updated_at'] = int(time.time())
    return row


def fetch_xrpl_books(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    xrpl = config.get('xrpl', {})
    if not xrpl.get('enabled', True): return []
    nodes = [xrpl.get('rpc_url')] + xrpl.get('fallback_nodes', [])
    nodes = [n for n in nodes if n]
    limit = int(xrpl.get('limit', 400)); timeout = int(xrpl.get('timeout_sec', 12))
    out: List[Dict[str, Any]] = []
    for book in xrpl.get('books', []):
        if not book.get('enabled', False):
            continue  # skip disabled pairs — they are tracked in scenarios_v86.json disabled_pairs
        currency, issuer = book['currency'], book['issuer']
        quote_obj = {"currency": currency, "issuer": issuer}
        xrp_obj = {"currency":"XRP"}
        last_exc = None
        for node in nodes:
            try:
                # both directions because orderbook direction can be counterintuitive
                a = _fetch_book(node, xrp_obj, quote_obj, limit, timeout)
                b = _fetch_book(node, quote_obj, xrp_obj, limit, timeout)
                snap = _normalize_book(book.get('symbol','XRP/?'), book.get('label','XRPL'), currency, issuer, float(book.get('usd_factor',1)), a, b)
                out.append(snap)
                break
            except Exception as exc:
                last_exc = exc
                continue
        else:
            out.append(asdict(XRPLBookSnapshot(book.get('symbol','XRP/?'), book.get('label','XRPL'), 'XRP', book.get('currency_display') or currency, 0, 0, None, 0, 0, f'xrpl_fetch_failed:{last_exc}', 'unavailable')))
        time.sleep(0.25)
    return out

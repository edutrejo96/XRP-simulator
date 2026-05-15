from __future__ import annotations

import argparse, json, math, shutil, time
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List

from connectors.cex_orderbooks import fetch_cex_orderbooks
from connectors.xrpl_orderbooks import fetch_xrpl_books
from connectors.etf_markets import fetch_etf_market_rows

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
WEB_DATA = ROOT.parent / 'web' / 'data'
REPORTS = ROOT / 'reports'


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)


DEPTH_LEVELS_PCT = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0)

def _curve_key(pct: float) -> str:
    return str(pct).rstrip('0').rstrip('.')

def _depth_at(row: Dict[str, Any], pct: float) -> float:
    curve = row.get('depth_curve_usd') or {}
    key = _curve_key(pct)
    try:
        if key in curve and curve[key] is not None:
            return float(curve[key] or 0)
    except Exception:
        pass
    d1 = float(row.get('depth_1pct_usd') or 0)
    d2 = float(row.get('depth_2pct_usd') or 0)
    if pct <= 1.0:
        return d1 * max(pct, 0.0)
    if pct <= 2.0:
        return d1 + (d2 - d1) * ((pct - 1.0) / 1.0)
    return d2 * ((pct / 2.0) ** 0.75)

def _spot_depth_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rows that are allowed to feed public XRP spot depth/slippage.

    Excludes synthetic aggregate rows, ETF/ETP shares, institutional estimates and failed rows.
    This prevents double counting: the aggregate row is display-only.
    """
    out = []
    for b in rows:
        q = str(b.get('quality', ''))
        sym = str(b.get('symbol', ''))
        if q == 'live_aggregate' or b.get('is_aggregate'):
            continue
        if q.startswith('etf_') or sym.startswith('ETF/') or sym.startswith('ETP/'):
            continue
        if q == 'institutional_estimate' or q == 'static_estimate' or 'failed' in q or 'disabled' in q:
            continue
        if not q.startswith('live'):
            continue
        if (b.get('depth_1pct_usd') or 0) <= 0 or (b.get('mid') or 0) <= 0:
            continue
        out.append(b)
    return out



INSTITUTIONAL_LIQUIDITY_ROWS = [
    {
        "symbol": "XRP/USD",
        "venue": "Ripple Prime / Hidden Road (OTC)",
        "base": "XRP", "quote": "USD",
        "mid": 0,  # filled from live price
        "spread_bps": 2.5,
        "daily_volume_usd": 120_000_000,  # est. $120M/day — Hidden Road processes $3B/day total
        "depth_1pct_usd": 480_000_000,    # institutional: depth >> public books
        "depth_2pct_usd": 960_000_000,
        "quality": "institutional_estimate",
        "note": "OTC/institutional. Not a public orderbook. Estimated from Hidden Road $3B/day volume and XRP allocation."
    },
    {
        "symbol": "XRP/USD",
        "venue": "Ripple Treasury / GTreasury",
        "base": "XRP", "quote": "USD",
        "mid": 0,
        "spread_bps": 5.0,
        "daily_volume_usd": 35_000_000,
        "depth_1pct_usd": 80_000_000,
        "depth_2pct_usd": 150_000_000,
        "quality": "institutional_estimate",
        "note": "Corporate treasury management. Estimated depth from Ripple Treasury/GTreasury operations."
    },
    {
        "symbol": "XRP/USD",
        "venue": "Ripple Custody (institutional)",
        "base": "XRP", "quote": "USD",
        "mid": 0,
        "spread_bps": 3.0,
        "daily_volume_usd": 25_000_000,
        "depth_1pct_usd": 60_000_000,
        "depth_2pct_usd": 110_000_000,
        "quality": "institutional_estimate",
        "note": "Custody desk. Institutional clients with XRP custody use this for settlement."
    },
    {
        "symbol": "XRP/USD",
        "venue": "RLUSD / ODL Institutional",
        "base": "XRP", "quote": "RLUSD",
        "mid": 0,
        "spread_bps": 1.8,
        "daily_volume_usd": 55_000_000,
        "depth_1pct_usd": 120_000_000,
        "depth_2pct_usd": 200_000_000,
        "quality": "institutional_estimate",
        "note": "RLUSD settlement layer for institutional ODL. Includes AMM + OTC RLUSD/XRP flows."
    },
]

def _fill_institutional_rows(rows, live_price):
    """Fill mid price from live price and return institutional rows."""
    result = []
    for r in rows:
        row = r.copy()
        if live_price and live_price > 0:
            row['mid'] = live_price
        result.append(row)
    return result


def aggregate_books(raw: List[Dict[str, Any]], fallback: Dict[str, Any], etf_rows: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    valid = [b for b in raw if str(b.get('quality','')).startswith('live') and (b.get('depth_1pct_usd') or 0) > 0 and (b.get('mid') or 0) > 0]
    spot_valid = _spot_depth_rows(valid)
    if not spot_valid:
        fb = fallback.copy()
        fb['generated_at'] = datetime.now(timezone.utc).isoformat()
        fb['mode'] = 'fallback_static_after_live_attempt_failed'
        fb['warning'] = 'Live fetch attempted, but no usable public spot orderbook depth was returned.'
        return fb

    # Synthetic aggregate is display-only. It is excluded from calculations to avoid double counting.
    xrp_spot = [b for b in spot_valid if b.get('quote') in ('USD','USDT','USDC','RLUSD') or b.get('symbol') in ('XRP/USD','XRP/USDT','XRP/USDC','XRP/RLUSD')]
    display_rows = list(valid)
    if xrp_spot:
        vol = sum(float(b.get('daily_volume_usd') or 0) for b in xrp_spot)
        mids = [float(b['mid']) for b in xrp_spot if b.get('mid')]
        mid = sum(mids)/len(mids) if mids else 0
        sp = sum(float(b.get('spread_bps') or 0) for b in xrp_spot)/max(1,len(xrp_spot))
        curve = {_curve_key(p): sum(_depth_at(b, p) for b in xrp_spot) for p in DEPTH_LEVELS_PCT}
        display_rows.insert(0, {
            "symbol":"XRP/USD",
            "venue":"Live aggregate",
            "base":"XRP",
            "quote":"USD",
            "mid":mid,
            "spread_bps":sp,
            "daily_volume_usd":vol if vol > 0 else None,
            "depth_1pct_usd":curve.get('1', 0.0),
            "depth_2pct_usd":curve.get('2', 0.0),
            "depth_curve_usd":curve,
            "quality":"live_aggregate",
            "is_aggregate": True,
            "excluded_from_calculation": True,
            "note":"Agregado visual de libros públicos. No entra en el cálculo para evitar doble conteo."
        })

    live_price = display_rows[0].get('mid', fallback.get('xrp_price_usd', 1.0)) if display_rows else fallback.get('xrp_price_usd', 1.0)
    inst_rows = _fill_institutional_rows(INSTITUTIONAL_LIQUIDITY_ROWS, live_price)
    etf_rows = etf_rows or []
    non_live_rows = [
        b for b in raw
        if not str(b.get('quality','')).startswith('live')
        and not str(b.get('quality','')).startswith('disabled')
    ]
    return {
        "version":"v10.10-realtime-orderbooks-depth-cursor",
        "mode":"live_orderbook_snapshot",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "warning":"CEX/XRPL orderbooks are refreshed by the live Python loop. The web auto-loads each new snapshot. ETF/ETP rows are share-market quote/volume only and never feed XRP spot depth. The aggregate row is display-only to prevent double counting.",
        "live_components":{"cex_orderbooks": True, "xrpl_dex_orderbooks": True, "etf_etp_quotes": bool(etf_rows), "auto_refresh_command":"python main.py --live-orderbooks --loop --interval-sec 60"},
        "depth_curve_levels_pct": list(DEPTH_LEVELS_PCT),
        "calculation_rules": {
            "spot_depth_includes": "live CEX + live XRPL DEX individual rows only",
            "spot_depth_excludes": "live_aggregate, ETF/ETP shares, institutional/OTC estimates, failed rows",
            "depth_cursor": "UI can choose ±0.1%, ±0.25%, ±0.5%, ±1%, ±2% or ±5% from depth_curve_usd"
        },
        "xrp_price_usd": live_price,
        "books": display_rows + inst_rows + etf_rows + non_live_rows
    }

def compute_engine(registry: Dict[str, Any], book_snapshot: Dict[str, Any]) -> Dict[str, Any]:
    weights = registry.get('evidence_weights', {})
    items = registry.get('items', [])
    active = items
    direct = rlusd = xrpl = private_score = retention = adoption = 0.0
    categories: Dict[str, float] = {}
    for i in active:
        ev = float(weights.get(i.get('evidence'), .5)); conf = float(i.get('confidence', .5)); act = float(i.get('default_activation_pct',0))/100
        base = float(i.get('base_volume_annual_usd',0))
        df = base * act * float(i.get('direct_xrp_touch_pct',0))/100 * ev * conf
        rf = base * act * float(i.get('rlusd_touch_pct',0))/100 * ev * conf
        xf = base * act * float(i.get('xrpl_touch_pct',0))/100 * ev * conf
        direct += df; rlusd += rf; xrpl += xf
        private_score += base * act * float(i.get('private_liquidity_pct',0))/100 * ev * conf
        retention += act * float(i.get('retention_effect_pct',0))/100 * ev * conf
        adoption += act * ev * conf
        categories[i.get('category','Other')] = categories.get(i.get('category','Other'),0) + df
    live_rows = [b for b in book_snapshot.get('books', []) if str(b.get('quality','')).startswith('live')]
    books = _spot_depth_rows(live_rows)
    if not books and book_snapshot.get('mode') == 'fallback':
        books = [b for b in book_snapshot.get('books', []) if b.get('quality') == 'fallback']
    depth1 = sum(_depth_at(b, 1.0) for b in books if b.get('symbol') in ('XRP/USD','XRP/USDT','XRP/USDC','XRP/RLUSD')) or sum(_depth_at(b, 1.0) for b in books)
    private_boost = 1 + math.log10(1 + private_score/1e9) * .55
    xrpl_boost = 1 + math.log10(1 + xrpl/1e9) * .10
    depth_dynamic = max(depth1,1) * private_boost * xrpl_boost
    rotation = 58 * (1 - min(retention*1.8,.65))
    float_xrp = 1.25e9
    p_util = direct / (float_xrp * (rotation ** .72)) if rotation > 0 else 0
    premium = .18 + min(adoption * 2.2, 2.2)
    p_market = p_util * (1 + premium)
    slippage_100m = min(95, max(.01, (100e6/max(depth_dynamic,1))**.66 * 1.0))
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "direct_xrp_flow_annual_usd": direct,
        "rlusd_influenced_flow_annual_usd": rlusd,
        "xrpl_influenced_flow_annual_usd": xrpl,
        "base_depth_1pct_usd": depth1,
        "dynamic_depth_1pct_usd": depth_dynamic,
        "effective_rotation": rotation,
        "functional_price_usd": p_util,
        "market_price_simulated_usd": p_market,
        "slippage_100m_pct": slippage_100m,
        "categories": categories,
        "mode": book_snapshot.get('mode')
    }


def write_markdown_report(summary: Dict[str, Any], registry: Dict[str, Any], book_snapshot: Dict[str, Any]) -> None:
    REPORTS.mkdir(exist_ok=True)
    lines = []
    lines.append('# Ripple Infrastructure Twin v10 — live report')
    lines.append('')
    lines.append('No es predicción de precio. Es simulación condicional basada en infraestructura, adopción y orderbooks.')
    lines.append('')
    lines.append(f"- Modo orderbooks: `{summary.get('mode')}`")
    lines.append(f"- Flujo directo XRP anual: `${summary['direct_xrp_flow_annual_usd']:,.0f}`")
    lines.append(f"- Flujo RLUSD influido anual: `${summary['rlusd_influenced_flow_annual_usd']:,.0f}`")
    lines.append(f"- Flujo XRPL influido anual: `${summary['xrpl_influenced_flow_annual_usd']:,.0f}`")
    lines.append(f"- Depth ±1% dinámico: `${summary['dynamic_depth_1pct_usd']:,.0f}`")
    lines.append(f"- Rotación efectiva: `{summary['effective_rotation']:.2f}x`")
    lines.append(f"- Precio funcional: `${summary['functional_price_usd']:,.4f}`")
    lines.append(f"- Precio mercado simulado: `${summary['market_price_simulated_usd']:,.4f}`")
    lines.append(f"- Slippage $100M: `{summary['slippage_100m_pct']:.2f}%`")
    lines.append('')
    lines.append('## Infraestructura integrada')
    for i in registry.get('items', []):
        lines.append(f"- **{i['name']}** — {i['status_label']} — {', '.join(i.get('corridors', [])[:4])}")
    (REPORTS/'live_report.md').write_text('\n'.join(lines), encoding='utf-8')


def build_snapshot_once(registry: Dict[str, Any], fallback: Dict[str, Any], config: Dict[str, Any], use_live: bool) -> Dict[str, Any]:
    """Build one coherent snapshot.

    Cross-check rules:
    - CEX/XRPL live rows feed spot depth/slippage.
    - Institutional rows are estimates and are kept separate.
    - ETF/ETP rows are share-market quote/volume only; they never feed XRP spot depth.
    """
    if use_live:
        raw: List[Dict[str, Any]] = []
        raw += fetch_cex_orderbooks(config)
        raw += fetch_xrpl_books(config)
        etf_rows = fetch_etf_market_rows(config)
        return aggregate_books(raw, fallback, etf_rows)
    return fallback


def persist_outputs(registry: Dict[str, Any], snapshot: Dict[str, Any]) -> Dict[str, Any]:
    save_json(DATA/'live_orderbook_snapshot.json', snapshot)
    save_json(WEB_DATA/'live_orderbook_snapshot.json', snapshot)
    save_json(WEB_DATA/'infrastructure_registry.json', registry)
    summary = compute_engine(registry, snapshot)
    save_json(REPORTS/'latest_summary.json', summary)
    write_markdown_report(summary, registry, snapshot)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--live-orderbooks', action='store_true', help='Fetch CEX orderbooks + XRPL DEX orderbooks + ETF/ETP live data, then update web/data/live_orderbook_snapshot.json')
    ap.add_argument('--offline', action='store_true', help='Use fallback snapshot only')
    ap.add_argument('--loop', action='store_true', help='Keep updating CEX, XRPL and ETF/ETP snapshots automatically')
    ap.add_argument('--interval-sec', type=int, default=60, help='Seconds between live updates when --loop is enabled')
    args = ap.parse_args()

    registry = load_json(DATA/'infrastructure_registry.json')
    fallback = load_json(DATA/'live_orderbook_snapshot.json')
    config = load_json(DATA/'live_orderbook_config.json')
    use_live = bool(args.live_orderbooks and not args.offline)

    def run_cycle(cycle: int = 1) -> None:
        nonlocal fallback
        snapshot = build_snapshot_once(registry, fallback, config, use_live)
        fallback = snapshot
        summary = persist_outputs(registry, snapshot)
        payload = {
            "cycle": cycle,
            "generated_at": snapshot.get('generated_at'),
            "mode": snapshot.get('mode'),
            "books": len(snapshot.get('books', [])),
            "spot_depth_rows_used": len(_spot_depth_rows([b for b in snapshot.get('books', []) if str(b.get('quality','')).startswith('live')])),
            "xrp_price_usd": snapshot.get('xrp_price_usd'),
            "dynamic_depth_1pct_usd": summary.get('dynamic_depth_1pct_usd'),
            "functional_price_usd": summary.get('functional_price_usd'),
            "market_price_simulated_usd": summary.get('market_price_simulated_usd'),
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))

    if args.loop:
        if not use_live:
            raise SystemExit('--loop necesita --live-orderbooks para actualizar CEX/XRPL/ETF automáticamente.')
        cycle = 1
        while True:
            try:
                run_cycle(cycle)
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                print(json.dumps({"cycle": cycle, "error": str(exc)}, ensure_ascii=False))
            cycle += 1
            time.sleep(max(15, int(args.interval_sec)))

    run_cycle(1)

if __name__ == '__main__':
    main()

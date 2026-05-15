"""
Export Scenarios v8.6 → web/data/scenarios_v86.json
====================================================
Runs the calibrated Python engine and exports results for the web to consume.
The web replaces its simple internal engine with these pre-computed values.
"""
from __future__ import annotations
import sys, json, math
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent

# ── CALIBRATED SCENARIOS ───────────────────────────────────────────────────────
# Based on v8.6 engine: P·V·M·R co-determined, real escrow, 5-component premium
# Calibration check: today_confirmed 2026 → P_util=$1.19, P_mkt=$1.54 (real=$1.41)

SCENARIOS = {
    "regulatory_reversal": {
        "label": "S0 — Freno Regulatorio",
        "label_en": "S0 — Regulatory Brake",
        "color": "#ef4444",
        "hqla": "No HQLA",
        "note_es": "Torres 2023 garantiza commodity status. Freno institucional, no colapso.",
        "note_en": "Torres 2023 guarantees commodity status. Institutional brake, not collapse.",
        "years": {
            "2026": {"tier":0,"tier_label":"T0·Especulativo","p_util":0.28,"p_mkt":0.31,"vol_day":57,"depth_1pct":28,"slip_100m":76.8,"hqla":"No HQLA"},
            "2029": {"tier":0,"tier_label":"T0·Especulativo","p_util":0.28,"p_mkt":0.41,"vol_day":57,"depth_1pct":19,"slip_100m":77.6,"hqla":"No HQLA"},
            "2033": {"tier":0,"tier_label":"T0·Especulativo","p_util":0.28,"p_mkt":0.42,"vol_day":57,"depth_1pct":24,"slip_100m":77.1,"hqla":"No HQLA"},
            "2035": {"tier":0,"tier_label":"T0·Especulativo","p_util":0.28,"p_mkt":0.30,"vol_day":57,"depth_1pct":11,"slip_100m":79.7,"hqla":"No HQLA"},
        }
    },
    "today_confirmed": {
        "label": "HOY — Infraestructura confirmada",
        "label_en": "TODAY — Confirmed infrastructure",
        "color": "#3b82f6",
        "hqla": "HQLA Level 2B",
        "note_es": "ODL activo $18.5B/año. Escenario que el mercado HOY parece descontar.",
        "note_en": "Active ODL $18.5B/year. Scenario the market appears to discount today.",
        "years": {
            "2026": {"tier":2,"tier_label":"T2·Bridge","p_util":1.19,"p_mkt":1.54,"vol_day":70,"depth_1pct":56,"slip_100m":55.6,"hqla":"No HQLA→2B"},
            "2029": {"tier":2,"tier_label":"T2·Bridge","p_util":2.11,"p_mkt":3.44,"vol_day":146,"depth_1pct":91,"slip_100m":53.8,"hqla":"HQLA 2B"},
            "2033": {"tier":2,"tier_label":"T2·Bridge","p_util":4.05,"p_mkt":6.74,"vol_day":315,"depth_1pct":248,"slip_100m":19.0,"hqla":"HQLA 2B"},
            "2035": {"tier":3,"tier_label":"T3·Institutional","p_util":4.99,"p_mkt":7.83,"vol_day":372,"depth_1pct":279,"slip_100m":18.0,"hqla":"HQLA 2A"},
        }
    },
    "status_quo": {
        "label": "Status Quo extendido",
        "label_en": "Extended status quo",
        "color": "#8b5cf6",
        "hqla": "HQLA Level 2A",
        "note_es": "Sin CLARITY. Crecimiento orgánico. CFTC guidance se mantiene.",
        "note_en": "No CLARITY. Organic growth. CFTC guidance holds.",
        "years": {
            "2026": {"tier":2,"tier_label":"T2·Bridge","p_util":1.30,"p_mkt":1.80,"vol_day":80,"depth_1pct":80,"slip_100m":55.1,"hqla":"HQLA 2B"},
            "2029": {"tier":3,"tier_label":"T3·Institutional","p_util":3.17,"p_mkt":7.05,"vol_day":200,"depth_1pct":249,"slip_100m":19.0,"hqla":"HQLA 2A"},
            "2033": {"tier":3,"tier_label":"T3·Institutional","p_util":6.57,"p_mkt":14.88,"vol_day":473,"depth_1pct":745,"slip_100m":5.97,"hqla":"HQLA 2A"},
            "2035": {"tier":4,"tier_label":"T4·Prime","p_util":9.22,"p_mkt":18.21,"vol_day":509,"depth_1pct":382,"slip_100m":15.4,"hqla":"HQLA 1"},
        }
    },
    "clarity_base": {
        "label": "CLARITY Act base",
        "label_en": "CLARITY Act base",
        "color": "#10b981",
        "hqla": "HQLA Level 1",
        "note_es": "CLARITY convierte commodity status en ley permanente. Bancos US pueden usar XRP sin riesgo regulatorio.",
        "note_en": "CLARITY makes commodity status permanent law. US banks can use XRP without regulatory risk.",
        "years": {
            "2026": {"tier":3,"tier_label":"T3·Institutional","p_util":4.35,"p_mkt":11.56,"vol_day":140,"depth_1pct":274,"slip_100m":18.1,"hqla":"HQLA 2A"},
            "2029": {"tier":4,"tier_label":"T4·Prime","p_util":19.42,"p_mkt":64.44,"vol_day":703,"depth_1pct":1899,"slip_100m":3.57,"hqla":"HQLA 1"},
            "2033": {"tier":5,"tier_label":"T5·Reserve","p_util":54.77,"p_mkt":197.22,"vol_day":2205,"depth_1pct":13449,"slip_100m":0.33,"hqla":"HQLA 1+"},
            "2035": {"tier":5,"tier_label":"T5·Reserve","p_util":58.91,"p_mkt":187.91,"vol_day":2409,"depth_1pct":7228,"slip_100m":1.07,"hqla":"HQLA 1+"},
        }
    },
    "expected_roadmap": {
        "label": "ESPERADO — Roadmap institucional",
        "label_en": "EXPECTED — Institutional roadmap",
        "color": "#f59e0b",
        "hqla": "HQLA Level 1+",
        "note_es": "CLARITY + integración bancaria progresiva. Fed master account + OCC.",
        "note_en": "CLARITY + progressive banking integration. Fed master account + OCC.",
        "years": {
            "2026": {"tier":3,"tier_label":"T3·Institutional","p_util":13.18,"p_mkt":47.33,"vol_day":307,"depth_1pct":599,"slip_100m":6.73,"hqla":"HQLA 2A"},
            "2029": {"tier":5,"tier_label":"T5·Reserve","p_util":87.28,"p_mkt":412.75,"vol_day":2403,"depth_1pct":11533,"slip_100m":0.37,"hqla":"HQLA 1+"},
            "2033": {"tier":5,"tier_label":"T5·Reserve","p_util":222.19,"p_mkt":1072.26,"vol_day":7023,"depth_1pct":42841,"slip_100m":0.16,"hqla":"HQLA 1+"},
            "2035": {"tier":5,"tier_label":"T5·Reserve","p_util":239.11,"p_mkt":1055.67,"vol_day":7659,"depth_1pct":22978,"slip_100m":0.23,"hqla":"HQLA 1+"},
        }
    },
    "bank_integration": {
        "label": "Integración bancaria",
        "label_en": "Banking integration",
        "color": "#ec4899",
        "hqla": "HQLA Level 1+",
        "note_es": "Bancos sistémicos usan XRP como colateral prime. Fed + OCC charter activos.",
        "note_en": "Systemic banks use XRP as prime collateral. Active Fed + OCC charter.",
        "years": {
            "2026": {"tier":3,"tier_label":"T3·Institutional","p_util":41.61,"p_mkt":207.72,"vol_day":773,"depth_1pct":1507,"slip_100m":4.05,"hqla":"HQLA 2A"},
            "2029": {"tier":5,"tier_label":"T5·Reserve","p_util":309.03,"p_mkt":2026.83,"vol_day":6503,"depth_1pct":31216,"slip_100m":0.19,"hqla":"HQLA 1+"},
            "2033": {"tier":5,"tier_label":"T5·Reserve","p_util":725.02,"p_mkt":4831.05,"vol_day":18975,"depth_1pct":115745,"slip_100m":0.02,"hqla":"HQLA 1+"},
            "2035": {"tier":5,"tier_label":"T5·Reserve","p_util":779.84,"p_mkt":4875.95,"vol_day":20716,"depth_1pct":62149,"slip_100m":0.12,"hqla":"HQLA 1+"},
        }
    },
    "stress_test": {
        "label": "STRESS TEST — Sistémico completo",
        "label_en": "STRESS TEST — Full systemic",
        "color": "#f97316",
        "hqla": "HQLA Level 1+ / Reserve",
        "note_es": "Crisis global + XRP como refugio. CDO/TRS colateral. SWIFT replacement.",
        "note_en": "Global crisis + XRP as refuge. CDO/TRS collateral. SWIFT replacement.",
        "years": {
            "2026": {"tier":5,"tier_label":"T5·Reserve","p_util":435.76,"p_mkt":3694.70,"vol_day":4566,"depth_1pct":34702,"slip_100m":0.18,"hqla":"HQLA 1+"},
            "2029": {"tier":5,"tier_label":"T5·Reserve","p_util":2016.59,"p_mkt":18106.56,"vol_day":33253,"depth_1pct":152965,"slip_100m":0.02,"hqla":"HQLA 1+"},
            "2033": {"tier":5,"tier_label":"T5·Reserve","p_util":4818.44,"p_mkt":43791.51,"vol_day":86294,"depth_1pct":509137,"slip_100m":0.01,"hqla":"HQLA 1+"},
            "2035": {"tier":5,"tier_label":"T5·Reserve","p_util":5175.79,"p_mkt":44912.89,"vol_day":93201,"depth_1pct":279603,"slip_100m":0.01,"hqla":"HQLA 1+"},
        }
    }
}

CALIBRATION = {
    "xrp_price_real": 1.41,
    "date": "Mayo 2026",
    "today_confirmed_2026": {
        "p_util": 1.19,
        "p_mkt_model": 1.54,
        "p_mkt_real": 1.41,
        "gap_pct": 9.0,
        "implied_premium": 18.5,
        "note_es": "El mercado cotiza un 18% sobre el valor de utilidad. Gap del 9% entre modelo y real.",
        "note_en": "Market trades 18% above utility value. 9% gap between model and real."
    },
    "clarity_repricing": {
        "without_clarity_2026": 1.80,
        "with_clarity_2026": 11.56,
        "multiplier": 6.4,
        "premium_regulatory_delta_pp": 58,
        "note_es": "CLARITY añade +58pp de prima regulatoria. Múltiplo 6.4× sobre status_quo.",
        "note_en": "CLARITY adds +58pp of regulatory premium. 6.4× multiple over status_quo."
    }
}

TIER_SYSTEM = {
    "0": {"label":"T0·Especulativo","label_en":"T0·Speculative","hqla":"No HQLA","color":"#6b7280","description_es":"Solo trading. Sin utilidad probada.","description_en":"Trading only. No proven utility."},
    "1": {"label":"T1·Utility básica","label_en":"T1·Basic utility","hqla":"No HQLA","color":"#3b82f6","description_es":"XRPL fees, DEX nativo, wallets. $1-3B/año.","description_en":"XRPL fees, native DEX, wallets. $1-3B/year."},
    "2": {"label":"T2·Bridge activo","label_en":"T2·Active bridge","hqla":"HQLA Level 2B equivalent","color":"#8b5cf6","description_es":"ODL corridors activos. $15-50B/año. XRP hoy aquí.","description_en":"Active ODL corridors. $15-50B/year. XRP is here today."},
    "3": {"label":"T3·Institutional","label_en":"T3·Institutional","hqla":"HQLA Level 2A equivalent","color":"#10b981","description_es":"Prime brokers, custody, colateral emergente. $50-200B/año.","description_en":"Prime brokers, custody, emerging collateral. $50-200B/year."},
    "4": {"label":"T4·Prime Collateral","label_en":"T4·Prime Collateral","hqla":"HQLA Level 1 equivalent","color":"#f59e0b","description_es":"Bancos usan XRP como HQLA. Repo markets. $200-800B/año.","description_en":"Banks use XRP as HQLA. Repo markets. $200-800B/year."},
    "5": {"label":"T5·Reserve Asset","label_en":"T5·Reserve Asset","hqla":"HQLA Level 1+ / Reserve","color":"#ec4899","description_es":"Reserva sistémica. Como Treasuries o EUR/USD. $800B+/año.","description_en":"Systemic reserve. Like Treasuries or EUR/USD. $800B+/year."}
}

PREMIUM_COMPONENTS = {
    "2026": {
        "macro": {"value": 40, "note_es": "Fed bajando tipos +40%", "note_en": "Fed cutting rates +40%"},
        "adoption": {"value": 53, "note_es": "Narrativa de adopción gradual +53%", "note_en": "Gradual adoption narrative +53%"},
        "regulatory": {"note_es": "Guidance vs CLARITY", "note_en": "Guidance vs CLARITY",
            "without_clarity": {"value": 18, "note_es": "CFTC guidance reversible +18%"},
            "with_clarity": {"value": 80, "note_es": "CLARITY ley federal permanente +80%"}
        },
        "cycle": {"value": -4, "note_es": "Ciclo cripto 2026 post-halving -4%", "note_en": "Crypto cycle 2026 post-halving -4%"},
        "scarcity": {"value": 1.5, "note_es": "Escasez ETF emergente +1.5%", "note_en": "Emerging ETF scarcity +1.5%"},
    }
}

XRPL_ORDERBOOKS = {
    "live_pairs": [
        {"symbol":"XRP/USD","venue":"Bitstamp (XRPL)","status":"✓ activo","depth_1pct_usd":1420000,"spread_pct":1.59,"note":"Libro más antiguo XRPL DEX"},
        {"symbol":"XRP/USD","venue":"Gatehub (XRPL)","status":"✓ activo","depth_1pct_usd":1490000,"spread_pct":1.40,"note":"Segundo libro USD"},
        {"symbol":"XRP/RLUSD","venue":"Ripple (XRPL)","status":"✓ activo","depth_1pct_usd":182000,"spread_pct":0.03,"note":"0.03% spread — el más ajustado del DEX"},
        {"symbol":"XRP/EUR","venue":"Gatehub (XRPL)","status":"✓ thin","depth_1pct_usd":20000,"spread_pct":0.23,"note":"Thin pero activo"},
    ],
    "disabled_pairs": [
        {"symbol":"XRP/BRL","venue":"Braza Bank","status":"○ ODL privado","note":"ODL usa RippleNet API privado, no el DEX público"},
        {"symbol":"XRP/MXN","venue":"Bitso","status":"○ ODL privado","note":"Mayor corredor ODL — $6B+/año pero por API privada"},
        {"symbol":"XRP/PHP","venue":"Coins.ph","status":"○ rate limit","note":"429 rate limit en consultas múltiples"},
    ],
    "insight_es": "Los corredores BRL/MXN no aparecen en el DEX porque ODL usa APIs privadas de RippleNet. El DEX refleja solo actividad retail y arbitrajistas.",
    "insight_en": "BRL/MXN corridors don't appear in DEX because ODL uses private RippleNet APIs. DEX only reflects retail and arbitrageur activity.",
    "xrp_price_captured": 1.4509
}

ESCROW_INSIGHT = {
    "mechanism_es": "Ripple libera 1B XRP/mes (contractual) pero re-bloquea 86-95% en nuevos contratos de 54+ meses. Net real al mercado: 47-200M XRP/mes — no 1B/mes.",
    "mechanism_en": "Ripple releases 1B XRP/month (contractual) but re-locks 86-95% into new 54+ month contracts. Real net to market: 47-200M XRP/month — not 1B/month.",
    "escrow_2035_est": 32e9,
    "self_regulating_es": "A mayor precio → Ripple necesita menos XRP para el mismo presupuesto USD → más re-bloqueo → el escrow dura más. Sistema auto-regulador.",
    "self_regulating_en": "Higher price → Ripple needs fewer XRP for same USD budget → more re-locking → escrow lasts longer. Self-regulating system."
}

def export():
    output = {
        "version": "v8.6",
        "engine": "XRP Utility Simulator v8.6 — P·V·M·R co-determined",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "calibration": CALIBRATION,
        "scenarios": SCENARIOS,
        "tier_system": TIER_SYSTEM,
        "premium_components": PREMIUM_COMPONENTS,
        "xrpl_orderbooks": XRPL_ORDERBOOKS,
        "escrow": ESCROW_INSIGHT,
        "disclaimer": "NO predicción de precio. NO asesoramiento financiero. Simulación de condiciones con causas explícitas."
    }
    out_path = ROOT.parent / 'web' / 'data' / 'scenarios_v86.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Exported {len(SCENARIOS)} scenarios → {out_path}")
    print(f"Calibration: today_confirmed 2026 P_util=${CALIBRATION['today_confirmed_2026']['p_util']} P_mkt=${CALIBRATION['today_confirmed_2026']['p_mkt_model']} real=${CALIBRATION['today_confirmed_2026']['p_mkt_real']}")
    return output

if __name__ == '__main__':
    export()

# Metodología v10

## 1. Infraestructura, no mercados abstractos

Cada pieza del modelo representa infraestructura real o plausible conectada a Ripple/XRPL:

- Ripple Payments;
- RLUSD;
- Ripple Prime / Hidden Road;
- Ripple Treasury / GTreasury;
- Rail;
- Ripple Custody;
- corredores regionales;
- tokenización;
- pilotos institucionales.

Cada elemento tiene:

- nivel de evidencia;
- volumen base editable;
- porcentaje de adopción;
- porcentaje que toca XRP;
- porcentaje que toca RLUSD;
- porcentaje que toca XRPL;
- impacto sobre liquidez privada;
- impacto sobre retención/rotación.

## 2. Separación directa e indirecta

No todo lo que toca Ripple toca XRP.

- Directo XRP: puente, settlement asset, inventario o colateral XRP.
- RLUSD: stablecoin settlement, pagos o colateral.
- XRPL: actividad sobre red, DEX, AMM, tokenización o paths.
- Indirecto: mejora de confianza, custodia, profundidad y market making.

## 3. Orderbooks dinámicos

La web no fija una profundidad. Toma un snapshot de `live_orderbook_snapshot.json`.

El snapshot puede venir de:

- CEX via `ccxt`;
- XRPL DEX via `book_offers`;
- fallback auditado si no hay conexión.

La adopción no cambia mágicamente el precio: aumenta la profundidad modelada mediante una función de liquidez privada/institucional, y eso reduce slippage.

## 4. Fórmula base

```text
P_utilidad = volumen directo XRP anual / (float efectivo × rotación^0.72)
```

La potencia 0.72 evita asumir que la rotación reduce precio de forma perfectamente lineal.

## 5. Resultado

El resultado muestra:

- precio funcional;
- precio mercado simulado;
- volumen directo XRP;
- volumen RLUSD influido;
- volumen XRPL influido;
- depth ±1% dinámico;
- slippage para orden de estrés;
- tier estimado.

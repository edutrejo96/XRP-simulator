# XRP Simulator

XRP Simulator es una aplicación web interactiva para explorar condiciones de liquidez, adopción, float, rotación, XRPL DEX, RLUSD, ETF/ETP y orderbooks.

No predice precios y no es asesoramiento financiero. Simula escenarios condicionales: qué tendría que pasar para que XRP cambiara de escala.

## Ejecutar en local

```bash
python -m pip install -r requirements.txt
python server.py
```

Abre:

```text
http://localhost:8080
```

El servidor inicia también el actualizador live de CEX + XRPL DEX + ETF/ETP cada 60 segundos.

## Actualizar snapshot manualmente

```bash
cd simulator_core
python -m pip install -r requirements.txt
python main.py --live-orderbooks
```

Loop manual:

```bash
cd simulator_core
python main.py --live-orderbooks --loop --interval-sec 60
```

## Despliegue en Render

Este paquete ya incluye:

- `server.py`
- `requirements.txt`
- `render.yaml`
- `.gitignore`

En Render crea un Web Service desde GitHub. Comandos:

```bash
Build Command: pip install -r requirements.txt
Start Command: python server.py
```

Variables recomendadas:

```text
PYTHON_VERSION=3.11.11
LIVE_UPDATER=true
LIVE_INTERVAL_SEC=60
```

## Estructura

```text
web/                 frontend estático
simulator_core/      motor Python y conectores live
docs/                metodología, fuentes y wallets
video/               guion de presentación
```

## Nota

ETF/ETP se separa del spot XRP: volumen ETF/ETP = volumen de acciones/ETP en bolsa; XRP retenido/AUM = hipótesis del modelo.

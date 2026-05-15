# Despliegue en Cloudflare Pages

1. Entra en Cloudflare.
2. Ve a **Workers & Pages**.
3. Pulsa **Create → Pages → Upload assets**.
4. Sube el contenido de la carpeta `web/`, no todo el ZIP.
5. Cloudflare te dará una URL `pages.dev`.

Si quieres actualizar los datos live antes de subir:

```powershell
cd simulator_core
python -m pip install -r requirements.txt
python main.py --live-orderbooks
```

Esto actualiza `web/data/live_orderbook_snapshot.json`.

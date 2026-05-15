#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
SIM_CORE = ROOT / "simulator_core"
PORT = int(os.environ.get("PORT", "8080"))
LIVE_UPDATER = os.environ.get("LIVE_UPDATER", "true").lower() in {"1", "true", "yes", "on"}
LIVE_INTERVAL_SEC = max(60, int(os.environ.get("LIVE_INTERVAL_SEC", "60")))

class QuietStaticHandler(SimpleHTTPRequestHandler):
    def copyfile(self, source, outputfile):
        try:
            shutil.copyfileobj(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def log_error(self, fmt, *args):
        msg = fmt % args
        if "Connection reset" in msg or "Broken pipe" in msg:
            return
        super().log_error(fmt, *args)


def live_loop() -> None:
    sys.path.insert(0, str(SIM_CORE))
    try:
        import main as simulator_main
    except Exception as exc:
        print(f"[XRP Simulator] live updater import failed: {exc}", flush=True)
        return

    registry = simulator_main.load_json(SIM_CORE / "data" / "infrastructure_registry.json")
    fallback = simulator_main.load_json(SIM_CORE / "data" / "live_orderbook_snapshot.json")
    config = simulator_main.load_json(SIM_CORE / "data" / "live_orderbook_config.json")
    cycle = 1
    while True:
        try:
            snapshot = simulator_main.build_snapshot_once(registry, fallback, config, True)
            fallback = snapshot
            summary = simulator_main.persist_outputs(registry, snapshot)
            print({
                "cycle": cycle,
                "generated_at": snapshot.get("generated_at"),
                "books": len(snapshot.get("books", [])),
                "xrp_price_usd": snapshot.get("xrp_price_usd"),
                "dynamic_depth_1pct_usd": round(summary.get("dynamic_depth_1pct_usd", 0), 2),
            }, flush=True)
        except Exception as exc:
            print(f"[XRP Simulator] live updater cycle failed: {exc}", flush=True)
        cycle += 1
        time.sleep(LIVE_INTERVAL_SEC)


def main() -> None:
    if LIVE_UPDATER:
        thread = threading.Thread(target=live_loop, daemon=True)
        thread.start()
        print(f"[XRP Simulator] live updater enabled every {LIVE_INTERVAL_SEC}s", flush=True)
    os.chdir(WEB)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), QuietStaticHandler)
    print(f"[XRP Simulator] serving on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()

if __name__ == "__main__":
    main()

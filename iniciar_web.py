#!/usr/bin/env python3
"""
Servidor local para Ripple Infrastructure Twin.
Usa esto en vez de `python -m http.server` si quieres evitar trazas molestas cuando el navegador corta una descarga de audio.
"""
from __future__ import annotations
import os
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
PORT = int(os.environ.get("PORT", "8080"))

class QuietMediaHandler(SimpleHTTPRequestHandler):
    def copyfile(self, source, outputfile):  # suppress normal browser aborts on mp3/range requests
        try:
            shutil.copyfileobj(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def log_error(self, format, *args):
        msg = format % args
        if "Connection reset" in msg or "Broken pipe" in msg:
            return
        super().log_error(format, *args)

if __name__ == "__main__":

    os.chdir(WEB)
    Handler = QuietMediaHandler
    httpd = ThreadingHTTPServer(("", PORT), Handler)
    print(f"Servidor iniciado en http://localhost:{PORT}")
    print("Pulsa CTRL+C para parar.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        httpd.server_close()

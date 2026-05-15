@echo off
title Ripple Infrastructure Twin v10 — Arranque completo
chcp 65001 > nul
cls
echo.
echo  ══════════════════════════════════════════════════════════
echo    Ripple Infrastructure Twin v10 — Motor v8.6 + Live Data
echo  ══════════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

echo  [1/4] Exportando escenarios v8.6 al frontend...
python simulator_core\export_scenarios_v86.py
if %ERRORLEVEL% NEQ 0 (
    echo    Advertencia: export falló, la web usará escenarios en caché.
) else (
    echo    Escenarios v8.6 exportados.
)

echo.
echo  [2/4] Obteniendo primer ciclo de datos live (CEX + XRPL + ETF)...
python simulator_core\main.py --live-orderbooks
if %ERRORLEVEL% NEQ 0 (
    echo    Advertencia: datos live no disponibles, usando snapshot guardado.
) else (
    echo    Primer snapshot live listo.
)

echo.
echo  [3/4] Arrancando actualizador en loop (cada 60 seg, ventana aparte)...
start "Actualizador Live — no cerrar" cmd /k "cd /d \"%~dp0simulator_core\" && echo Loop activo: CEX + XRPL + ETF cada 60 segundos. && python main.py --live-orderbooks --loop --interval-sec 60"

timeout /t 1 /nobreak > nul

echo.
echo  [4/4] Iniciando servidor web en http://localhost:8080 ...
start "" http://localhost:8080
python iniciar_web.py

pause

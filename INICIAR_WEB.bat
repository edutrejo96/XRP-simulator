@echo off
title XRP Infrastructure Twin v10.7
echo.
echo ══════════════════════════════════════════════════════════
echo   XRP Infrastructure Twin v10.7 — Motor v8.6 + Cinematics
echo ══════════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

echo [1/3] Exportando escenarios v8.6 al frontend...
python simulator_core\export_scenarios_v86.py
if %ERRORLEVEL% NEQ 0 (
    echo   ⚠ Export falló — la web usará datos en caché
) else (
    echo   ✓ Escenarios exportados
)

echo.
echo [2/3] Actualizando orderbooks live (CEX + XRPL)...
python simulator_core\main.py --live-orderbooks
if %ERRORLEVEL% NEQ 0 (
    echo   ⚠ Orderbooks live fallaron — usando snapshot guardado
) else (
    echo   ✓ Orderbooks actualizados
)

echo.
echo [3/3] Iniciando servidor web...
python iniciar_web.py

pause

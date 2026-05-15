@echo off
cd /d "%~dp0\simulator_core"
echo Actualizando ORDERBOOKS CEX + XRPL DEX + ETF/ETP cada 60 segundos...
echo La web recargara el snapshot automaticamente. No cierres esta ventana.
python main.py --live-orderbooks --loop --interval-sec 60
pause

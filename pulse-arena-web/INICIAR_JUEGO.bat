@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js no esta instalado.
    echo Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
    echo.
    pause
    exit /b 1
)
echo ========================================
echo       PULSE ARENA - Iniciando...
echo ========================================
echo.
echo El juego se abrira en el navegador.
echo No cierres esta ventana mientras juegues.
echo.
start "" "http://localhost:3000"
node server.js
if errorlevel 1 (
    echo.
    echo El servidor no pudo iniciar. Comprueba que el puerto 3000 este libre.
)
pause

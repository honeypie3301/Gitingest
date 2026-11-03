@echo off
cd /d "%~dp0"
if not exist "node_modules\" (
    echo [GitIngest] Installing missing dependencies...
    call npm install
)
echo Configuring Windows Background Autostart...
node scripts/setup-autostart.js
pause

@echo off
cd /d "%~dp0"
if not exist "node_modules\" (
    echo [GitIngest] Installing missing dependencies...
    call npm install
)
echo Building production bundle...
call npm run build
echo Configuring Windows Background Autostart...
node scripts/setup-autostart.js
pause

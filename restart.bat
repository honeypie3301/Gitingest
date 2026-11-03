@echo off 
cd /d "%~dp0" 
call npm run build 
call pm2 restart gitingest >nul 2>&1 
echo GitIngest server restarted at http://localhost:3000

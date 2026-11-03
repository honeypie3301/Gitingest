@echo off 
cd /d "%~dp0" 
call pm2 stop gitingest >nul 2>&1 
node scripts\stop-background.js

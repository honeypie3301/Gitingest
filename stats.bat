@echo off
setlocal
cd /d "%~dp0"
call pm2 jlist > "%TEMP%\gitingest_stats.json" 2>nul
node scripts\print-stats.js

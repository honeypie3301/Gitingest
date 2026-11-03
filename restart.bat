@echo off 
cd /d "%~dp0" 
call npm run build 
echo GitIngest server restarted at http://localhost:3000

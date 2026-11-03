@echo off 
cd /d "%~dp0" 
call pm2 start dist-server/server.mjs --name gitingest --node-args="--expose-gc --max-old-space-size=512" >nul 2>&1 
echo GitIngest server started silently in the background at http://localhost:3000

@echo off
cd /d "%~dp0"
call npm run build
call pm2 restart gitingest >nul 2>&1 || call pm2 start dist-server/server.mjs --name gitingest --node-args="--expose-gc --max-old-space-size=512" >nul 2>&1
echo GitIngest server started silently in the background at http://localhost:3000
for /f "tokens=*" %%a in ('git log -1 --oneline') do echo Latest Commit: %%a

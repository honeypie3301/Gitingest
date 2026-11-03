@echo off
cd /d "%~dp0"

REM Derive custom domain dynamically from directory name
for %%I in ("%~dp0.") do set "DIR_NAME=%%~nxI"
set "DOMAIN=local-%DIR_NAME%"

echo ========================================================
echo  Configuring %DOMAIN% Custom Domain
echo ========================================================
echo.

powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"$domain = ''%DOMAIN%''; $hostsPath = ''$env:windir\System32\drivers\etc\hosts''; if (-not (Select-String -Path $hostsPath -Pattern \"`\b$domain`\b\" -Quiet)) { Add-Content -Path $hostsPath -Value \"`n127.0.0.1 $domain\"; Write-Host \"[OK] Successfully mapped 127.0.0.1 to $domain\" -ForegroundColor Green } else { Write-Host \"[OK] $domain is already configured in hosts file.\" -ForegroundColor Yellow }; Start-Sleep -Seconds 2\"'"

echo.
echo Setup script finished!
echo You can now access your app at:
echo http://%DOMAIN%:3000
echo.
pause

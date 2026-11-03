@echo off
cd /d "%~dp0"
echo ========================================================
echo  Configuring local-personal-gitingest Custom Domain
echo ========================================================
echo.

powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"$hostsPath = ''$env:windir\System32\drivers\etc\hosts''; if (-not (Select-String -Path $hostsPath -Pattern ''local-personal-gitingest'' -Quiet)) { Add-Content -Path $hostsPath -Value \"`n127.0.0.1 local-personal-gitingest\"; Write-Host ''[OK] Successfully mapped 127.0.0.1 to local-personal-gitingest'' -ForegroundColor Green } else { Write-Host ''[OK] local-personal-gitingest is already configured in hosts file.'' -ForegroundColor Yellow }; Start-Sleep -Seconds 2\"'"

echo.
echo Setup script finished!
echo You can now access your app at:
echo http://local-personal-gitingest:3000
echo.
pause

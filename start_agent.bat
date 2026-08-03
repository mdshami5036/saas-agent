@echo off
title AutoPrint Agent - Starting...
echo.
echo  =====================================
echo   AutoPrint Agent - Malti Print Center
echo   Starting background service...
echo  =====================================
echo.

:: Update config.json with current tenant token
set CONFIG_DIR=%APPDATA%\AutoPrintAgent
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

echo { > "%CONFIG_DIR%\config.json"
echo   "backendUrl": "https://saas-backend-production-5c3e.up.railway.app", >> "%CONFIG_DIR%\config.json"
echo   "agentToken": "ag_39c2e2059c80d510449191e138168634", >> "%CONFIG_DIR%\config.json"
echo   "selectedPrinter": "Microsoft Print to PDF", >> "%CONFIG_DIR%\config.json"
echo   "isConfigured": true, >> "%CONFIG_DIR%\config.json"
echo   "autoStart": true, >> "%CONFIG_DIR%\config.json"
echo   "minimizeToTray": true >> "%CONFIG_DIR%\config.json"
echo } >> "%CONFIG_DIR%\config.json"

:: Kill old agent process if running
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Launch agent silently via VBS (no window)
wscript.exe //nologo "%~dp0AutoPrint_LIVE.vbs"

echo  Agent started in background with token ag_39c2e2059c80d510449191e138168634!
echo  Ye window 3 second me band ho jayegi...
timeout /t 3 /nobreak >nul
exit

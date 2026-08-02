@echo off
title AutoPrint Agent - Starting...

:: =============================================
:: AutoPrint Agent Launcher - Malti Print Center
:: Backend: https://saas-backend-production-5c3e.up.railway.app
:: Token: ag_7749c4c3ba1826da360126b90132e24b
:: =============================================

:: Kill any existing agent process first
taskkill /f /im "PrintAgent.exe" >nul 2>&1
taskkill /f /im "node.exe" >nul 2>&1
timeout /t 1 >nul

:: Update config.json with correct token
set CONFIG_DIR=%APPDATA%\AutoPrintAgent
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

echo { > "%CONFIG_DIR%\config.json"
echo   "backendUrl": "https://saas-backend-production-5c3e.up.railway.app", >> "%CONFIG_DIR%\config.json"
echo   "agentToken": "ag_7749c4c3ba1826da360126b90132e24b", >> "%CONFIG_DIR%\config.json"
echo   "selectedPrinter": "Microsoft Print to PDF", >> "%CONFIG_DIR%\config.json"
echo   "isConfigured": true, >> "%CONFIG_DIR%\config.json"
echo   "autoStart": true, >> "%CONFIG_DIR%\config.json"
echo   "minimizeToTray": true >> "%CONFIG_DIR%\config.json"
echo } >> "%CONFIG_DIR%\config.json"

echo [AutoPrint] Config updated with token ag_7749c4c3ba1826da360126b90132e24b

:: Register boot auto-start in Windows registry
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AutoPrintAgent" /t REG_SZ /d "\"%~dp0start_agent.bat\"" /f >nul 2>&1
echo [AutoPrint] Boot auto-start registered

:: Start agent silently in background using Node.js
echo [AutoPrint] Starting Print Agent...
start /B /MIN node "%~dp0src\agent.js" --background

echo.
echo =============================================
echo  PRINT AGENT STARTED SUCCESSFULLY!
echo  Backend: https://saas-backend-production-5c3e.up.railway.app
echo  Token: ag_7749c4c3ba1826da360126b90132e24b
echo  Customer Portal: https://saas-olq3-git-main-mdshami5037.vercel.app/cafe/the-weve-02a741
echo =============================================
echo.
echo  Check Dashboard for GREEN dot:
echo  https://saas-olq3-git-main-mdshami5037.vercel.app/dashboard
echo.
timeout /t 5 >nul
exit

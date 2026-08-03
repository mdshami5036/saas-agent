@echo off
title AutoPrint Agent - Token Setup
cls
echo.
echo  ========================================================
echo         AutoPrint Agent - Easy Token Setup
echo  ========================================================
echo.
echo  Apna Print Agent Token (ag_...) yahan paste/type karein:
echo  (Aap apna token Dashboard -\> Settings se le sakte hain)
echo.

set /p USER_TOKEN="Print Agent Token (ag_...): "

if "%USER_TOKEN%"=="" (
    echo.
    echo  [Error] Token khali nahi ho sakta! Please dobara try karein.
    echo  Press any key to exit...
    pause >nul
    exit /b
)

:: Create AppData config directory if not exists
set CONFIG_DIR=%APPDATA%\AutoPrintAgent
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

:: Write config.json cleanly
(
echo {
echo   "backendUrl": "https://saas-backend-production-5c3e.up.railway.app",
echo   "agentToken": "%USER_TOKEN%",
echo   "selectedPrinter": "Microsoft Print to PDF",
echo   "isConfigured": true,
echo   "autoStart": true,
echo   "minimizeToTray": true
echo }
) > "%CONFIG_DIR%\config.json"

echo.
echo  ========================================================
echo   Token Successfully Configured!
echo   Token: %USER_TOKEN%
echo  ========================================================
echo.
echo  Starting AutoPrint Agent in background...

:: Stop any old node process
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Launch agent silently in background via VBS
wscript.exe //nologo "%~dp0AutoPrint_LIVE.vbs"

echo.
echo   PrintAgent connected and running silently in background!
echo   Ye window 3 second me band ho jayegi...
timeout /t 3 /nobreak >nul
exit

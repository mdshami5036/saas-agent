@echo off
title AutoPrint Agent - Starting...
echo.
echo  =====================================
echo   AutoPrint Agent - Malti Print Center
echo   Starting background service...
echo  =====================================
echo.

:: Kill old agent if running
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Launch agent silently via VBS (no window)
wscript.exe //nologo "%~dp0AutoPrint_LIVE.vbs"

echo  Agent started in background!
echo  Ye window 3 second me band ho jayegi...
timeout /t 3 /nobreak >nul
exit

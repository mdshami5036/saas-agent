@echo off
title AutoPrint Agent - Stopping...
cls
echo.
echo  =====================================
echo   AutoPrint Agent - Stop Service
echo  =====================================
echo.
echo  Stopping PrintAgent background service...

:: Kill running node agent processes
taskkill /f /im node.exe >nul 2>&1

echo.
echo  =====================================
echo   PrintAgent STOPPED Successfully!
echo  =====================================
echo.
echo  Ye window 3 second me band ho jayegi...
timeout /t 3 /nobreak >nul
exit

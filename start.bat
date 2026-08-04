@echo off
title DOCTAR AI - Starting...
echo.
echo  ============================
echo   DOCTAR AI - Starting App
echo  ============================
echo.

:: Start API (Node.js + TypeScript, port 8000)
echo [1/2] Starting API (port 8000)...
start "DOCTAR API" cmd /k "cd /d D:\doctar\backend-node && npm run dev"

:: Wait for API to be ready
echo Waiting for API...
timeout /t 5 /nobreak > nul

:: Start Frontend
echo [2/2] Starting Frontend (port 3000)...
start "DOCTAR Frontend" cmd /k "cd /d D:\doctar\frontend && "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev"

:: Wait then open browser
echo Waiting for frontend...
timeout /t 8 /nobreak > nul

echo.
echo  ============================
echo   Opening http://localhost:3000
echo  ============================
start "" http://localhost:3000

echo.
echo  Both servers are running.
echo  Close the two black windows to stop.
echo.
pause

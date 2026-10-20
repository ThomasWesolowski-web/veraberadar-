@echo off
chcp 65001 >nul
title Vergaberadar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js ist nicht installiert.
  echo  Bitte die LTS-Version von https://nodejs.org installieren und start.bat erneut starten.
  echo.
  start "" "https://nodejs.org/de/download"
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo  Node.js ist zu alt. Benoetigt wird Version 22.13 oder neuer.
  start "" "https://nodejs.org/de/download"
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  Einstellungsdatei .env wurde angelegt. Bitte FIRMA_ADRESSE eintragen.
  notepad ".env"
)

if not exist "node_modules" (
  echo  Erster Start: Programmbausteine werden installiert ...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  Installation fehlgeschlagen. Bitte Internetverbindung pruefen.
    pause
    exit /b 1
  )
)

start "" "http://localhost:3000/"
node --disable-warning=ExperimentalWarning src\server.js
pause

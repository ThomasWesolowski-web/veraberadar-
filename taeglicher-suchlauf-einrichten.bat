@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Richtet in der Windows-Aufgabenplanung einen taeglichen Suchlauf um 06:00 Uhr ein.
rem Der Suchlauf laeuft dann auch, wenn das Dashboard nicht geoeffnet ist (PC muss eingeschaltet sein).

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte zuerst start.bat ausfuehren.
  pause
  exit /b 1
)
schtasks /Create /F /SC DAILY /ST 06:00 /TN "Vergaberadar Suchlauf" /TR "\"%~dp0suchlauf-geplant.bat\""
if errorlevel 1 (
  echo Einrichtung fehlgeschlagen.
) else (
  echo Taeglicher Suchlauf um 06:00 Uhr eingerichtet. Protokoll: data\suchlauf.log
  echo Entfernen: schtasks /Delete /TN "Vergaberadar Suchlauf" /F
)
pause

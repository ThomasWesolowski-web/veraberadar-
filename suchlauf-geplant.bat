@echo off
rem Wird von der Windows-Aufgabenplanung aufgerufen (siehe taeglicher-suchlauf-einrichten.bat).
cd /d "%~dp0"
if not exist "data" mkdir "data"
node --disable-warning=ExperimentalWarning src\cli.js suchlauf >> "data\suchlauf.log" 2>&1

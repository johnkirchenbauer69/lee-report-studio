@echo off
node "%~dp0install.mjs" %*
if errorlevel 1 pause

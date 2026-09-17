@echo off
cd /d "%~dp0"
node scripts\local-init.mjs
node scripts\setup-github.mjs
pause

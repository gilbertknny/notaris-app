@echo off
chcp 65001 >nul
title Log aplikasi
cd /d "%~dp0"
docker compose ps
echo.
docker compose logs --tail 60 migrate api web
pause

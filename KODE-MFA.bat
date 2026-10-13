@echo off
chcp 65001 >nul
title Kode MFA staf
cd /d "%~dp0"
echo.
echo  Akun demo: notaris@contoh.id, drafter@contoh.id, drafter2@contoh.id,
echo             admin@contoh.id, keuangan@contoh.id, sysadmin@contoh.id
echo.
set /p EMAIL= Ketik email akun lalu tekan Enter: 
echo.
echo  Kode 6 digit (berlaku sekitar 30 detik):
docker compose exec -T api node dist/db/dev-otp.js %EMAIL%
echo.
pause

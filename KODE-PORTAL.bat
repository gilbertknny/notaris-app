@echo off
chcp 65001 >nul
title Kode masuk portal klien
cd /d "%~dp0"
echo.
echo  Kode masuk portal yang terakhir dikirim (paling bawah = paling baru):
echo.
docker compose logs api 2>nul | findstr /C:"OTP untuk"
echo.
echo  Kalau kosong: minta kode dulu di halaman portal, lalu buka file ini lagi.
echo.
pause

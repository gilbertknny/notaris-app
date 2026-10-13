@echo off
chcp 65001 >nul
title Reset data demo
cd /d "%~dp0"
echo.
echo  PERHATIAN: semua data di aplikasi akan dihapus dan diganti data demo awal.
set /p OK= Ketik YA lalu Enter untuk melanjutkan: 
if /I not "%OK%"=="YA" goto batal
docker compose down -v
echo  Data dihapus. Jalankan MULAI.bat untuk memulai dari awal.
pause
exit /b 0
:batal
echo  Dibatalkan.
pause

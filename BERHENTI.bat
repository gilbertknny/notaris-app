@echo off
chcp 65001 >nul
title Hentikan aplikasi
cd /d "%~dp0"
echo  Menghentikan aplikasi (data tetap tersimpan)...
docker compose stop
echo  Selesai. Jalankan MULAI.bat untuk menyalakan lagi.
pause

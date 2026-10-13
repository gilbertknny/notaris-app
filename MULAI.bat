@echo off
chcp 65001 >nul
title Aplikasi Notaris - Mulai
cd /d "%~dp0"

echo.
echo  Memeriksa Docker Desktop...
docker info >nul 2>&1
if errorlevel 1 goto nodocker

if exist ".env" goto start
echo  Membuat file pengaturan untuk pertama kali...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=[Security.Cryptography.RandomNumberGenerator]::Create(); function k{$b=New-Object byte[] 32; $r.GetBytes($b); [Convert]::ToBase64String($b)}; $pw=(k) -replace '[^a-zA-Z0-9]',''; (Get-Content .env.example) -replace '^KMS_MASTER_KEY=.*',('KMS_MASTER_KEY='+(k)) -replace '^HMAC_KEY=.*',('HMAC_KEY='+(k)) -replace 'ganti-password-app-ini',$pw | Set-Content -Encoding ascii .env"
if not exist ".env" goto failed

:start
echo.
echo  Menyiapkan aplikasi. Pertama kali bisa 5 sampai 15 menit, tergantung internet.
echo  Jangan tutup jendela ini.
echo.
docker compose up -d --build
if errorlevel 1 goto failed

echo.
echo  Menunggu aplikasi siap...
powershell -NoProfile -Command "for($i=0;$i -lt 100;$i++){try{$x=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/v1/health -TimeoutSec 3; if($x.StatusCode -eq 200){exit 0}}catch{}; Start-Sleep 3}; exit 1"
if errorlevel 1 goto slow

start "" http://localhost:3000
echo.
echo  ============================================================
echo   APLIKASI SUDAH BERJALAN  -  http://localhost:3000
echo  ============================================================
echo   Akun staf      : notaris@contoh.id
echo   Kata sandi     : Notaris#2026demo
echo   Kode 6 digit   : klik dua kali KODE-MFA.bat
echo.
echo   Portal klien   : http://localhost:3000/portal/login
echo   Email klien    : maria@contoh.id
echo   Kode masuk     : klik dua kali KODE-PORTAL.bat
echo  ============================================================
echo.
pause
exit /b 0

:nodocker
echo.
echo  [!] Docker Desktop belum berjalan atau belum terpasang.
echo      1. Buka "Docker Desktop" dari menu Start.
echo      2. Tunggu sampai di pojok kiri bawah tertulis "Engine running".
echo      3. Klik dua kali file MULAI.bat ini lagi.
echo.
pause
exit /b 1

:slow
echo.
echo  [!] Aplikasi belum merespons setelah 5 menit.
echo      Tunggu sebentar lalu buka http://localhost:3000 di browser.
echo      Kalau tetap tidak bisa, klik dua kali LIHAT-LOG.bat dan kirim isinya.
echo.
pause
exit /b 1

:failed
echo.
echo  [!] Ada yang gagal. Salin atau screenshot tulisan di atas dan kirimkan.
echo.
pause
exit /b 1

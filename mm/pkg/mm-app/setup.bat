@echo off
setlocal
cd /d "%~dp0"
echo ================================================================
echo  CAI DAT LAN DAU app KITTING VAT LIEU (MM) tren PocketBase
echo  Server 192.168.1.221  -^>  /home/ils_server/pocketbase/app_mm
echo  (Cap nhat cac lan sau: chay deploy.bat)
echo ================================================================
set HOST=192.168.1.221
set SSHUSER=ils_server
set REMOTE=/home/ils_server/pocketbase/app_mm
set PORT=8097
for /f "tokens=2 delims==" %%a in ('findstr /b "MM_PORT=" env.default') do set PORT=%%a

echo.
echo [1/5] Kiem tra WinSCP tren may nay...
call :findwinscp
if not defined WINSCP (
  echo   Chua co WinSCP. Dang cai bang winget...
  winget install -e --id WinSCP.WinSCP --accept-package-agreements --accept-source-agreements
  call :findwinscp
)
if not defined WINSCP (
  echo   [LOI] Khong cai duoc WinSCP. Tai tai https://winscp.net roi chay lai setup.bat
  goto :fail
)
echo   [OK] %WINSCP%

echo.
echo [2/5] Kiem tra ket noi toi server %HOST%...
ping -n 1 -w 2000 %HOST% >nul
if errorlevel 1 (
  echo   [LOI] Khong ping duoc %HOST%. May nay phai o trong mang LAN nha may.
  goto :fail
)
echo   [OK] Ket noi duoc %HOST%

echo.
echo [3/5] Nhap thong tin tai khoan...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_mm_input.ps1" -Out "%~dp0mm_init.env"
if errorlevel 1 goto :fail

echo.
echo [4/5] Kiem tra server, day file, dung container, tao tai khoan...
echo   (Neu WinSCP hoi mat khau SSH cua %SSHUSER% thi nhap vao)
set LOCALDIR=%~dp0
if "%LOCALDIR:~-1%"=="\" set LOCALDIR=%LOCALDIR:~0,-1%
%WINSCP% /ini=nul /log="%~dp0setup.log" /script="%~dp0setup_mm.txt" /parameter // %HOST% %SSHUSER% %REMOTE% "%LOCALDIR%" %PORT%
set RC=%ERRORLEVEL%
if exist "%~dp0mm_init.env" del /q "%~dp0mm_init.env"
if not "%RC%"=="0" (
  echo.
  echo   [LOI] Cai dat dung giua chung. Doc dong [LOI] o tren hoac file setup.log
  goto :fail
)

echo.
echo [5/5] Kiem tra app tu may nay...
set HEALTH=0
for /f %%h in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://%HOST%:%PORT%/api/health).StatusCode}catch{0}"') do set HEALTH=%%h
set STATUS=0
for /f %%h in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://%HOST%:%PORT%/api/mm/status).StatusCode}catch{0}"') do set STATUS=%%h
if "%HEALTH%"=="200" (echo   [OK] PocketBase tra loi: http://%HOST%:%PORT%/api/health) else (echo   [LOI] PocketBase chua tra loi tai cong %PORT%)
if "%STATUS%"=="200" (echo   [OK] App Kitting da nap: http://%HOST%:%PORT%/api/mm/status) else (echo   [LOI] Hook app chua nap - xem: docker logs pb_mm_app --tail 60)
echo.
echo ================================================================
echo  XONG. Trang app : http://%HOST%:%PORT%/
echo        Trang Admin: http://%HOST%:%PORT%/_/
echo  Ghi lai KHOA API (dong "Khoa API day PO") o tren de dung cho
echo  cong cu day PO tu dong. Lan sau cap nhat: chay deploy.bat
echo ================================================================
start "" http://%HOST%:%PORT%/
pause
exit /b 0

:findwinscp
set WINSCP=
if exist "C:\Program Files (x86)\WinSCP\WinSCP.com" set WINSCP="C:\Program Files (x86)\WinSCP\WinSCP.com"
if not defined WINSCP if exist "C:\Program Files\WinSCP\WinSCP.com" set WINSCP="C:\Program Files\WinSCP\WinSCP.com"
if not defined WINSCP if exist "%LOCALAPPDATA%\Programs\WinSCP\WinSCP.com" set WINSCP="%LOCALAPPDATA%\Programs\WinSCP\WinSCP.com"
exit /b 0

:fail
if exist "%~dp0mm_init.env" del /q "%~dp0mm_init.env"
echo.
echo  CAI DAT CHUA XONG. Sua loi o tren roi chay lai setup.bat (chay lai an toan).
pause
exit /b 1

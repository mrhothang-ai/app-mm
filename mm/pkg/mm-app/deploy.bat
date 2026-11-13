@echo off
setlocal
echo === Deploy app KITTING (MM) -^> /home/ils_server/pocketbase/app_mm ===
set HOST=192.168.1.221
set SSHUSER=ils_server
set REMOTE=/home/ils_server/pocketbase/app_mm
set WINSCP="C:\Program Files (x86)\WinSCP\WinSCP.com"
if not exist %WINSCP% set WINSCP="C:\Program Files\WinSCP\WinSCP.com"
if not exist %WINSCP% set WINSCP="%LOCALAPPDATA%\Programs\WinSCP\WinSCP.com"
if not exist %WINSCP% ( echo Khong tim thay WinSCP.com & pause & exit /b 1 )
set LOCALDIR=%~dp0
if "%LOCALDIR:~-1%"=="\" set LOCALDIR=%LOCALDIR:~0,-1%
%WINSCP% /ini=nul /log="%~dp0deploy.log" /script="%~dp0deploy_mm.txt" /parameter // %HOST% %SSHUSER% %REMOTE% "%LOCALDIR%"
pause

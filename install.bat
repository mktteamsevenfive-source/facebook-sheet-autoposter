@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "KEY_FILE=%SCRIPT_DIR%google-service-account.json"

echo ============================================
echo  Facebook Sheet Autoposter - Installer
echo ============================================
echo.

if exist "%KEY_FILE%" (
    echo Found google-service-account.json next to this installer - using it.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\setup.ps1" -ServiceAccountKey "%KEY_FILE%"
) else (
    echo No google-service-account.json found next to this installer.
    echo You can drop the key file here and re-run this installer, or add it later.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\setup.ps1"
)

echo.
echo ============================================
echo  Setup finished. See the steps printed above.
echo ============================================
pause

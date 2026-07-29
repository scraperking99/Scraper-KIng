@echo off
setlocal enabledelayedexpansion

title Meta APK SMS Trigger

:: Always work from the folder where this bat file lives
cd /d "%~dp0"

cls
echo.
echo    ____                                      _  ___              
echo   / ___^|  ___ _ __ __ _ _ __   ___ _ __     ^| ^|/ (_)_ __   __ _  
echo   \___ \ / __^| '__/ _` ^| '_ \ / _ \ '__^|    ^| ' ^<^| ^| '_ \ / _` ^| 
echo    ___) ^| (__^| ^| ^| (_^| ^| ^|_) ^|  __/ ^|       ^| . \^| ^| ^| ^| ^| (_^| ^| 
echo   ^|____/ \___^|_^|  \__,_^| .__/ \___^|_^|       ^|_^|\_\_^|_^| ^|_^|\__, ^| 
echo                        ^|_^|                                ^|___/  
echo.
echo +----------------------------------------------+
echo ^| [*] Author    : Scraper King                 ^|
echo ^| [*] Telegram  : t.me/scraper_king            ^|
echo ^| [*] Status    : Premium License              ^|
echo ^| [*] Network   : data/proxy/vpn               ^|
echo ^| [*] Target    : Meta APK                     ^|
echo ^| [*] Version   : METAAPK-V5.0.0               ^|
echo +----------------------------------------------+
echo.

:: -- CHECK ig.js EXISTS --------------------------------------------
if not exist "%~dp0metaapk.js" (
    echo  [-] Error: metaapk.js not found in the same folder as this launcher!
    echo      Please place metaapk.js next to Launcher.bat and try again.
    echo.
    pause
    exit /b 1
)

:: -- FIND NODE.JS --------------------------------------------------
set "NODE_EXE="
set "NPM_CMD=npm"

if exist "%~dp0bin\node\node.exe" (
    set "NODE_EXE=%~dp0bin\node\node.exe"
    set "NPM_CMD=%~dp0bin\node\npm.cmd"
    goto :node_found
)
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
    goto :node_found
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    set "NPM_CMD=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
    goto :node_found
)

where node >nul 2>nul
if %errorlevel% equ 0 (
    set "NODE_EXE=node"
    :: Find the real global npm.cmd to avoid corrupted aliases
    for /f "delims=" %%P in ('where npm.cmd 2^>nul') do (
        echo "%%P" | findstr /i "npm.cmd" >nul && set "NPM_CMD=%%P"
    )
    if "%NPM_CMD%"=="npm" (
        if exist "C:\Program Files\nodejs\npm.cmd" set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
        if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
        if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM_CMD=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
    )
    goto :node_found
)

:: -- INSTALL NODE.JS PORTABLY IF MISSING ---------------------------
cls
echo.
echo    FIRST-TIME SETUP: Node.js Runtime
echo    ===========================================================
echo.
echo    Node.js is not installed. Downloading portable runtime...
echo.
mkdir "%~dp0bin" 2>nul
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile '%~dp0bin\node.zip' -UseBasicParsing } catch { (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip', '%~dp0bin\node.zip') }"

if not exist "%~dp0bin\node.zip" (
    echo   [-] Failed to download Node.js. Check your internet connection.
    echo       Or install manually from: https://nodejs.org/
    pause
    exit /b 1
)

echo    [*] Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%~dp0bin\node.zip' -DestinationPath '%~dp0bin' -Force"
rename "%~dp0bin\node-v20.11.1-win-x64" "node"
del /q "%~dp0bin\node.zip"

set "NODE_EXE=%~dp0bin\node\node.exe"
set "NPM_CMD=%~dp0bin\node\npm.cmd"
set "PATH=%~dp0bin\node;%PATH%"
echo    [+] Portable Node.js installed!
timeout /t 2 >nul

:node_found
echo [+] Node.js found.

:: -- AUTO-GENERATE package.json IF MISSING -------------------------
if not exist "%~dp0package.json" (
    echo [*] Creating package.json...
    powershell -NoProfile -Command "Set-Content -Path '%~dp0package.json' -Value '{\"name\":\"meta-apk\",\"version\":\"5.0.0\",\"private\":true,\"dependencies\":{\"chalk\":\"^4.1.2\",\"https-proxy-agent\":\"^5.0.0\",\"socks-proxy-agent\":\"^5.0.0\"}}'"
)

:: -- INSTALL / REFRESH DEPENDENCIES --------------------------------
echo.
echo [*] Checking and refreshing dependencies...
if exist "%~dp0node_modules\https-proxy-agent" (
    :: Check if correct version is installed (no odd quotes to break CMD block parser)
    type "%~dp0node_modules\https-proxy-agent\package.json" 2>nul | findstr /i "version" | findstr "5\." >nul 2>nul
    if errorlevel 1 (
        echo [*] Outdated/ESM packages found. Reinstalling CommonJS versions...
        if exist "%~dp0node_modules" rmdir /s /q "%~dp0node_modules"
        if exist "%~dp0package.json" del /q "%~dp0package.json"
        echo [*] Recreating package.json...
        powershell -NoProfile -Command "Set-Content -Path '%~dp0package.json' -Value '{\"name\":\"meta-apk\",\"version\":\"5.0.0\",\"private\":true,\"dependencies\":{\"chalk\":\"^4.1.2\",\"https-proxy-agent\":\"^5.0.0\",\"socks-proxy-agent\":\"^5.0.0\"}}'"
    )
)
if not exist "%~dp0node_modules\" (
    echo.
    echo [*] Installing dependencies - first run, may take a minute...
    echo.
    call "%NPM_CMD%" install --no-audit --no-fund
    echo.
    echo [+] Dependencies installed.
    echo.
)

:: -- LAUNCH metaapk.js (has built-in HWID, license, and interactive wizard) --
if "%~1" NEQ "" goto :args_mode

echo [*] Launching Meta APK (Interactive Mode)...
echo.
"!NODE_EXE!" "%~dp0metaapk.js"
goto :done

:args_mode
echo [*] Running with custom arguments...
"!NODE_EXE!" "%~dp0metaapk.js" %*
goto :done

:done
echo.
pause
exit /b 0

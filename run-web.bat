@echo off
set "PATH=%SystemRoot%\System32;%PATH%"
cd /d "%~dp0"
chcp 65001 >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 18+ required. Install from https://nodejs.org
    pause
    exit /b 1
)

echo Checking server dependencies...
cd /d "%~dp0server"
call npm install
if errorlevel 1 (
    echo npm install failed.
    cd /d "%~dp0"
    pause
    exit /b 1
)
cd /d "%~dp0"

set "KAI_INDEX=true"
if not defined OPENAI_API_KEY (
    if exist "%~dp0server\.env" (
        rem dotenv reads from server\.env
    ) else (
        echo OPENAI_API_KEY not set. Create server\.env from server\.env.example
        echo and set OPENAI_API_KEY=sk-...
        echo.
    )
)
echo.
echo ================================================================
echo   Open browser: http://localhost:8080/
echo   Close this window to stop the server.
echo ================================================================
echo.
echo Starting KAI API server...
echo.
set "KAI_OPEN_BROWSER=1"
node "%~dp0server\index.js"
pause

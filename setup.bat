@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo [KAI] Maven Wrapper install (no Maven needed)...
echo.

if exist mvnw.cmd (
    echo mvnw.cmd already exists. Skip.
    goto :run
)

set WRAPPER_ZIP=maven-wrapper-distribution-3.2.0-bin.zip
set URL=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper-distribution/3.2.0/%WRAPPER_ZIP%

echo Downloading Maven Wrapper...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%URL%' -OutFile '%WRAPPER_ZIP%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
    echo [ERROR] Download failed. Check internet or run: mvn wrapper:wrapper
    pause
    exit /b 1
)

echo Extracting...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Expand-Archive -Path '%WRAPPER_ZIP%' -DestinationPath '.' -Force"
del "%WRAPPER_ZIP%" 2>nul

REM zip may extract to a subfolder (e.g. maven-wrapper-3.2.0)
for /d %%D in (maven-wrapper-*.*) do (
    move "%%D\mvnw.cmd" "." 2>nul
    move "%%D\mvnw" "." 2>nul
    if exist "%%D\.mvn" xcopy "%%D\.mvn" ".mvn\" /E /I /Y >nul 2>nul
    rmdir /S /Q "%%D" 2>nul
)

if not exist mvnw.cmd (
    echo [ERROR] mvnw.cmd not found after extract.
    pause
    exit /b 1
)

echo Maven Wrapper installed.
echo.

:run
echo Run KAI...
echo.
call run.bat

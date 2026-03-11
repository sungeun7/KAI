@echo off
set "PATH=%SystemRoot%\System32;%PATH%"
set "JAVA_OPTS=-Xms128m -Xmx1024m -XX:+UseSerialGC -Dkai.index=true"
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo [KAI] RAG + LLM starting...
echo.

set JAR=target\kai-rag-llm-1.0.0-SNAPSHOT.jar

echo Building JAR...
if exist mvnw.cmd (
    call mvnw.cmd -q package -DskipTests
) else (
    where mvn >nul 2>nul
    if errorlevel 1 (
        if not exist "%JAR%" (
            echo [ERROR] JAR not found. Run setup.bat first or install Maven.
            goto :end
        )
    ) else (
        call mvn -q package -DskipTests
    )
)
if not exist "%JAR%" (
    echo [ERROR] Build failed.
    goto :end
)
echo.

echo Running...
java %JAVA_OPTS% -jar "%JAR%"
goto :end

:end
echo.
pause

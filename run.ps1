# KAI - RAG + LLM 실행 스크립트 (PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[KAI] RAG + LLM 실행 중..." -ForegroundColor Cyan
Write-Host ""

if (Test-Path "mvnw.cmd") {
    & .\mvnw.cmd -q compile exec:java "-Dexec.mainClass=com.kai.Main"
} elseif (Get-Command mvn -ErrorAction SilentlyContinue) {
    & mvn -q compile exec:java "-Dexec.mainClass=com.kai.Main"
} else {
    Write-Host "[오류] Maven(mvn)이 설치되어 있지 않거나 PATH에 없습니다." -ForegroundColor Red
    Write-Host "       이 폴더에서 한 번 'mvn wrapper:wrapper' 를 실행하거나,"
    Write-Host "       https://maven.apache.org/download.cgi 에서 Maven을 설치한 뒤 PATH에 추가해 주세요."
    Read-Host "Enter 키를 누르면 종료합니다"
    exit 1
}
Read-Host "`nEnter 키를 누르면 종료합니다"

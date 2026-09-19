$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$exe = Join-Path $PSScriptRoot 'src-tauri\target\release\skerry.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host '首次启动需要构建桌面程序。'
    & npm.cmd run desktop:build
    if ($LASTEXITCODE -ne 0) { throw '桌面程序构建失败，请检查上方信息。' }
}
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)

$ErrorActionPreference = 'Stop'
$installers = @(Get-ChildItem (Join-Path $PSScriptRoot '../target/release/bundle/nsis/*-setup.exe'))
if ($installers.Count -ne 1) { throw "Expected one Windows installer, found $($installers.Count)" }
$installDir = Join-Path $env:LOCALAPPDATA 'WeldEngineering-CI-Installed'
if (Test-Path $installDir) { throw 'Isolated CI installation directory already exists' }
$setup = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
# Tauri patches the first bundle marker for NSIS and restores the standalone EXE.
# Match that exact upstream operation; every other byte must remain identical.
# https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs
$expectedBytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '../target/release/weld-desktop.exe'))
$marker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
$markerIndex = [System.Text.Encoding]::ASCII.GetString($expectedBytes).IndexOf($marker, [StringComparison]::Ordinal)
if ($markerIndex -lt 0) { throw 'Known Tauri bundle marker is absent; review the bundler contract' }
[System.Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS').CopyTo($expectedBytes, $markerIndex)
$expectedHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($expectedBytes))
$installed = @(Get-ChildItem $installDir -Recurse -Force -Filter '*.exe' | Where-Object { (Get-FileHash $_.FullName).Hash -eq $expectedHash })
if ($installed.Count -ne 1) { throw 'Installed desktop executable does not match the built application' }
# All real UI/SQLite/PDF/intermittent tests run against the installed executable.
& (Join-Path $PSScriptRoot 'windows-desktop-smoke.ps1') -Executable $installed[0].FullName
if (-not $?) { throw 'Installed desktop workflow failed' }
$databases = @(
    (Join-Path $env:APPDATA 'ru.posmis.weldengineering/projects.sqlite'),
    (Join-Path $env:LOCALAPPDATA 'ru.posmis.weldengineering/projects.sqlite')
) | Where-Object { Test-Path $_ }
if (-not $databases) { throw 'Installed application did not persist its project database' }
$uninstaller = Get-ChildItem $installDir -Recurse -Force -Filter '*uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'Uninstaller was not installed' }
$remove = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S', "_?=$installDir") -Wait -PassThru
if ($remove.ExitCode -ne 0 -or (Test-Path $installed[0].FullName)) { throw 'Silent uninstall did not remove the app' }
foreach ($database in $databases) { if (-not (Test-Path $database)) { throw 'Uninstall removed the saved project database' } }
Write-Output 'PASS: per-user NSIS install, matching executable, full installed UI workflow, silent uninstall and preserved project database.'

@echo off
setlocal EnableExtensions DisableDelayedExpansion

title Weld Engineering
pushd "%~dp0apps\desktop"
if errorlevel 1 goto missing_project

where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto missing_node

rem Rustup's default folder may not be visible to an older Explorer session.
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo.exe >nul 2>&1
if errorlevel 1 goto missing_rust

rem Refresh dependencies after a lockfile change, including the first launch.
node.exe -e "const fs=require('node:fs');const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');const marker='node_modules/.weld-lock.sha256';process.exit(fs.existsSync('node_modules/.bin/tauri.cmd') && fs.existsSync(marker) && fs.readFileSync(marker,'utf8').trim()===hash ? 0 : 1)"
if not errorlevel 1 goto launch

echo Installing frontend dependencies from package-lock.json...
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto command_failed
node.exe -e "const fs=require('node:fs');const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');fs.writeFileSync('node_modules/.weld-lock.sha256',hash+'\n')"
if errorlevel 1 goto command_failed

:launch
echo Starting Weld Engineering. The first Rust build may take several minutes.
echo Keep this console open while using development mode.
call npm.cmd run tauri -- dev
if errorlevel 1 goto command_failed
popd
endlocal
exit /b 0

:missing_node
echo ERROR: Install Node.js 24 or newer, including npm, then run this script again.
echo https://nodejs.org/
goto prerequisite_failed

:missing_rust
echo ERROR: Install Rust with the Windows MSVC toolchain, then run this script again.
echo https://rustup.rs/
goto prerequisite_failed

:prerequisite_failed
echo Windows development also requires C++ Build Tools, Windows SDK and WebView2.
set "WELD_EXIT=1"
goto failed

:command_failed
set "WELD_EXIT=%errorlevel%"
echo ERROR: Setup or application launch failed. See the output above.
echo Check C++ Build Tools, Windows SDK and WebView2 prerequisites.

:failed
pause
popd
endlocal & exit /b %WELD_EXIT%

:missing_project
echo ERROR: Cannot find apps\desktop beside this script.
echo Keep start.bat in the repository root.
pause
endlocal
exit /b 1

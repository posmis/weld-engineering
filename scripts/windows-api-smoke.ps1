$ErrorActionPreference = 'Stop'
$port = Get-Random -Minimum 42000 -Maximum 49000
$tokenPath = Join-Path $env:LOCALAPPDATA "WeldEngineering/api-$port.token"
$exe = Join-Path $PSScriptRoot '../target/release/weld-api.exe'
$process = Start-Process -FilePath $exe -ArgumentList @('--port', "$port") -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot '../target/api-smoke-stdout.txt') -RedirectStandardError (Join-Path $PSScriptRoot '../target/api-smoke-stderr.txt')
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $token = ''
    while ($token.Length -ne 32) {
        if ($process.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'API startup failed before publishing its token file' }
        try { if (Test-Path $tokenPath) { $token = [System.IO.File]::ReadAllText($tokenPath) } } catch [System.IO.IOException] { $token = '' }
        if ($token.Length -ne 32) { Start-Sleep -Milliseconds 100 }
    }
    $headers = @{ Authorization = "Bearer $token" }
    $base = "http://127.0.0.1:$port/api/v1"
    $capabilities = Invoke-RestMethod -Uri "$base/capabilities" -Headers $headers
    if ($capabilities.strength_status -ne 'unsupported_calculation') { throw 'API exposes unverified normative acceptance' }
    $listeners = Get-NetTCPConnection -State Listen -OwningProcess $process.Id
    if (-not $listeners -or @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count) { throw 'API listener is not restricted to IPv4 loopback' }
    $unauthorized = Invoke-WebRequest -Uri "$base/capabilities" -SkipHttpErrorCheck
    if ($unauthorized.StatusCode -ne 401) { throw 'Missing token was accepted' }
    $inputJson = '{"schema_version":1,"segments":[{"start_mm":[-50,0],"end_mm":[50,0],"effective_width_mm":2}],"force_n":[400,-200,600],"couple_n_mm":[0,0,0],"application":{"kind":"centroid"}}'
    $result = Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body $inputJson
    if (($result.traction_mpa -join ',') -ne '2,-1,3' -or $result.analysis_status -ne 'computed') { throw 'HTTP calculation differs from analytical reference' }
    if ($result.strength_status -ne 'unsupported_calculation') { throw 'Calculation falsely accepts strength' }
    $spec = Invoke-RestMethod -Uri "$base/openapi.json" -Headers $headers
    if ($spec.openapi -ne '3.1.0') { throw 'OpenAPI document unavailable' }
    Write-Output 'PASS: standalone API starts on Windows, binds loopback only, authenticates, calculates the reference and serves OpenAPI.'
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path $tokenPath) { Remove-Item $tokenPath -Force }
}

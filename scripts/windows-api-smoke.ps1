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
    function Assert-Contract([string]$SchemaName, [string]$Json) {
        $schema = @{ '$schema' = 'https://json-schema.org/draft/2020-12/schema'; '$ref' = "#/components/schemas/$SchemaName"; components = $spec.components } | ConvertTo-Json -Depth 100
        if (-not (Test-Json -Json $Json -Schema $schema -ErrorAction Stop)) { throw "OpenAPI schema violation: $SchemaName" }
    }
    Assert-Contract 'CalculationInput' $inputJson
    Assert-Contract 'CalculationResult' ($result | ConvertTo-Json -Depth 100)
    Assert-Contract 'Capabilities' ($capabilities | ConvertTo-Json -Depth 100)
    Assert-Contract 'AppError' $unauthorized.Content
    $templateJson = '{"schema_version":1,"kind":"rectangle","width_mm":100,"height_mm":40,"effective_width_mm":2,"origin_mm":[10,-5]}'
    $group = Invoke-RestMethod -Method Post -Uri "$base/geometry/template" -Headers $headers -ContentType 'application/json' -Body $templateJson
    Assert-Contract 'GeometryTemplateRequest' $templateJson
    Assert-Contract 'GeometryTemplateResult' ($group | ConvertTo-Json -Depth 100)
    $joint = $inputJson | ConvertFrom-Json
    $joint.segments = $group.segments
    $groupResult = Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body ($joint | ConvertTo-Json -Depth 100)
    Assert-Contract 'CalculationResult' ($groupResult | ConvertTo-Json -Depth 100)
    if ($groupResult.geometry.area_mm2 -ne 560 -or ($groupResult.geometry.centroid_mm -join ',') -ne '10,-5') { throw 'Generated rectangle differs from the independent perimeter/centroid reference' }

    $clientOutput = & dotnet run --no-build --configuration Release --project (Join-Path $PSScriptRoot '../examples/inventor-client/WeldClient.csproj') -- $port
    if ($LASTEXITCODE -ne 0 -or ($clientOutput -join ' ') -notmatch 'unsupported_calculation') { throw 'C# client did not complete a real API calculation' }

    Write-Output 'PASS: standalone API starts on Windows, binds loopback only, authenticates, calculates the reference and serves OpenAPI.'
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path $tokenPath) { Remove-Item $tokenPath -Force }
}

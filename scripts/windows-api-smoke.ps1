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

    $transformJson = @{ schema_version = 1; segments = $group.segments; transform = @{ kind = 'rotate'; origin_mm = @(0,0); angle_deg = 90 } } | ConvertTo-Json -Depth 100
    Assert-Contract 'GeometryTransformRequest' $transformJson
    $transformed = Invoke-RestMethod -Method Post -Uri "$base/geometry/transform" -Headers $headers -ContentType 'application/json' -Body $transformJson
    Assert-Contract 'GeometryTransformResult' ($transformed | ConvertTo-Json -Depth 100)
    $joint.segments = $transformed.segments
    $rotatedResult = Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body ($joint | ConvertTo-Json -Depth 100)
    if ($rotatedResult.geometry.area_mm2 -ne 560 -or ($rotatedResult.geometry.centroid_mm -join ',') -ne '5,10') { throw 'Rotated geometry changed area or has an incorrect centroid' }

    $multiple = $inputJson | ConvertFrom-Json -AsHashtable
    $multiple.force_n = @(0,0,0)
    $multiple.forces = @(
        @{id='a';title='F1';force_n=@(0,0,300);application=@{kind='point';point_mm=@(-25,0,0)}},
        @{id='b';title='F2';force_n=@(0,0,300);application=@{kind='point';point_mm=@(25,0,0)}}
    )
    $multipleJson = $multiple | ConvertTo-Json -Depth 100
    Assert-Contract 'CalculationInput' $multipleJson
    $multipleResult = Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body $multipleJson
    Assert-Contract 'CalculationResult' ($multipleResult | ConvertTo-Json -Depth 100)
    if (($multipleResult.resultant_force_n -join ',') -ne '0,0,600' -or ($multipleResult.traction_mpa -join ',') -ne '0,0,3') { throw 'Independent simultaneous-force reference failed' }

    $copyJson = @{ schema_version=1; segments=$group.segments; copy_index=0; transform=@{kind='translate';delta_mm=@(0,-20)} } | ConvertTo-Json -Depth 100
    Assert-Contract 'GeometryTransformRequest' $copyJson
    $copied = Invoke-RestMethod -Method Post -Uri "$base/geometry/transform" -Headers $headers -ContentType 'application/json' -Body $copyJson
    Assert-Contract 'GeometryTransformResult' ($copied | ConvertTo-Json -Depth 100)
    if ($copied.segments.Count -ne 5) { throw 'Segment copy did not retain original rectangle edges' }
    $joint.segments=$copied.segments
    $copyResult=Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body ($joint | ConvertTo-Json -Depth 100)
    if ($copyResult.geometry.area_mm2 -ne 760) { throw 'Segment copy area differs from independent reference' }

    $combInput=$inputJson | ConvertFrom-Json -AsHashtable
    $combInput.force_n=@(0,0,600);$combInput.couple_n_mm=@(0,0,0);$combInput.application=@{kind='centroid'}
    $caseA=@{id='A';title='A';force_n=@(0,0,600);couple_n_mm=@(0,0,0);application=@{kind='centroid'};last_calculation=$null}
    $caseB=@{id='B';title='B';force_n=@(0,0,-200);couple_n_mm=@(0,0,0);application=@{kind='centroid'};last_calculation=$null}
    $combProject=@{schema_version=1;title='Combination reference';input=$combInput;last_calculation=$null;casebook=@{schema_version=1;active_id='A';cases=@($caseA,$caseB)}}
    $combJson=@{schema_version=1;project=$combProject;title='2A - 3B';terms=@(@{case_id='A';factor=2},@{case_id='B';factor=-3})} | ConvertTo-Json -Depth 100
    Assert-Contract 'CombinationRequest' $combJson
    $combination=Invoke-RestMethod -Method Post -Uri "$base/cases/combine" -Headers $headers -ContentType 'application/json' -Body $combJson
    Assert-Contract 'Project' ($combination | ConvertTo-Json -Depth 100)
    $combResult=Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body ($combination.input | ConvertTo-Json -Depth 100)
    Assert-Contract 'CalculationResult' ($combResult | ConvertTo-Json -Depth 100)
    if ($combination.casebook.cases.Count -ne 3 -or $combResult.traction_mpa[2] -ne 9 -or $combResult.strength_status -ne 'unsupported_calculation') { throw 'Explicit combination 2*600 - 3*(-200) did not produce 9 MPa at A=200' }
    $editProject=$combination | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $editProject.casebook.cases[0].force_n=@(0,0,999)
    $editJson=@{schema_version=1;project=$editProject;replace_case_id=$combination.casebook.active_id;title='Edited';terms=@(@{case_id='B';factor=-1},@{case_id='A';factor=1})} | ConvertTo-Json -Depth 100
    Assert-Contract 'CombinationRequest' $editJson
    $edited=Invoke-RestMethod -Method Post -Uri "$base/cases/combine" -Headers $headers -ContentType 'application/json' -Body $editJson
    Assert-Contract 'Project' ($edited | ConvertTo-Json -Depth 100)
    $editResult=Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body ($edited.input | ConvertTo-Json -Depth 100)
    Assert-Contract 'CalculationResult' ($editResult | ConvertTo-Json -Depth 100)
    if ($edited.casebook.cases.Count -ne 3 -or $edited.casebook.active_id -ne $combination.casebook.active_id -or $editResult.traction_mpa[2] -ne 4 -or $edited.casebook.cases[2].combination.sources[0].load.force_n[2] -ne 600) { throw 'Combination edit reread live 999 N instead of frozen 600 N, or changed case identity/count' }
    $materialCard=@{kind='custom';designation='Synthetic base';product_form=$null;condition=$null;properties=@(@{kind='yield_strength';value=300;thickness_mm=@(0,20);temperature_c=@(20,20);source='User record M-001'})}
    $selection=@{context=@{thickness_mm=10;temperature_c=20};base=$materialCard;weld=$null}
    $materialJson=@{schema_version=1;selection=$selection} | ConvertTo-Json -Depth 100
    Assert-Contract 'MaterialRequest' $materialJson
    $resolved=Invoke-RestMethod -Method Post -Uri "$base/materials/evaluate" -Headers $headers -ContentType 'application/json' -Body $materialJson
    Assert-Contract 'MaterialEvaluation' ($resolved | ConvertTo-Json -Depth 100)
    if ($resolved.base.properties[0].value -ne 300 -or $resolved.base.properties[0].status -ne 'user_provided' -or $null -ne $resolved.weld.properties[0].value) { throw 'Custom material acquired a normative or invented property' }
    $selection.context.thickness_mm=21
    $outside=Invoke-RestMethod -Method Post -Uri "$base/materials/evaluate" -Headers $headers -ContentType 'application/json' -Body (@{schema_version=1;selection=$selection}|ConvertTo-Json -Depth 100)
    Assert-Contract 'MaterialEvaluation' ($outside | ConvertTo-Json -Depth 100)
    if ($null -ne $outside.base.properties[0].value -or $outside.base.properties[0].status -ne 'unknown') { throw 'Out-of-domain material silently extrapolated or became zero' }
    $materialProject=$combination | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $materialProject['materials']=$resolved.selection
    $materialProjectJson=$materialProject | ConvertTo-Json -Depth 100
    Assert-Contract 'Project' $materialProjectJson
    $checked=Invoke-RestMethod -Method Post -Uri "$base/projects/validate" -Headers $headers -ContentType 'application/json' -Body $materialProjectJson
    Assert-Contract 'Project' ($checked | ConvertTo-Json -Depth 100)
    $userLimits=@{method_id='independent-nominal-components-v1';tension=@{value_mpa=6;source='User T-001'};compression=@{value_mpa=20;source='User C-001'};shear=@{value_mpa=10;source='User S-001'}}
    $limitsJson=@{schema_version=1;limits=$userLimits}|ConvertTo-Json -Depth 100
    Assert-Contract 'ValidateLimitsRequest' $limitsJson
    $validLimits=Invoke-RestMethod -Method Post -Uri "$base/limits/validate" -Headers $headers -ContentType 'application/json' -Body $limitsJson
    Assert-Contract 'UserLimits' ($validLimits|ConvertTo-Json -Depth 100)
    $limitProject=$combination|ConvertTo-Json -Depth 100|ConvertFrom-Json -AsHashtable
    $limitProject['user_limits']=$validLimits
    $batch=Invoke-RestMethod -Method Post -Uri "$base/cases/calculate" -Headers $headers -ContentType 'application/json' -Body ($limitProject|ConvertTo-Json -Depth 100)
    $limitRequest=@{schema_version=1;project=$batch.project}|ConvertTo-Json -Depth 100
    Assert-Contract 'EvaluateLimitsRequest' $limitRequest
    $comparison=Invoke-RestMethod -Method Post -Uri "$base/limits/evaluate" -Headers $headers -ContentType 'application/json' -Body $limitRequest
    Assert-Contract 'LimitEvaluation' ($comparison|ConvertTo-Json -Depth 100)
    if ($comparison.status -ne 'exceeds_user_limits' -or $comparison.maximum_ratio -ne 1.5 -or $comparison.available -ne 3 -or $comparison.strength_status -ne 'unsupported_calculation') { throw '9 MPa / 6 MPa user comparison incorrectly implied normative acceptance or missed an excess' }
    $partial=$batch.project|ConvertTo-Json -Depth 100|ConvertFrom-Json -AsHashtable
    $partial.casebook.cases[1].last_calculation=$null
    $partialComparison=Invoke-RestMethod -Method Post -Uri "$base/limits/evaluate" -Headers $headers -ContentType 'application/json' -Body (@{schema_version=1;project=$partial}|ConvertTo-Json -Depth 100)
    Assert-Contract 'LimitEvaluation' ($partialComparison|ConvertTo-Json -Depth 100)
    if ($partialComparison.status -ne 'incomplete' -or $partialComparison.available -ne 2 -or $partialComparison.total -ne 3) { throw 'Missing case disappeared from user threshold completeness' }
    $studyProject=@{schema_version=1;title='Synthetic width study';input=($inputJson|ConvertFrom-Json);last_calculation=$null}
    $studyJson=@{schema_version=1;project=$studyProject;factors=@(1,2,1e308)}|ConvertTo-Json -Depth 100
    Assert-Contract 'WidthStudyRequest' $studyJson
    $study=Invoke-RestMethod -Method Post -Uri "$base/studies/width" -Headers $headers -ContentType 'application/json' -Body $studyJson
    Assert-Contract 'WidthStudyResult' ($study|ConvertTo-Json -Depth 100)
    if ($study.rows.Count -ne 3 -or $study.rows[1].area_mm2 -ne 400 -or $study.rows[2].status -ne 'failed' -or $study.rows[2].error.code -ne 'numerical_range') { throw 'Width study dropped a failed candidate or returned incorrect area' }
    $applyJson=@{schema_version=1;project=$studyProject;factor=2}|ConvertTo-Json -Depth 100
    Assert-Contract 'ApplyWidthScaleRequest' $applyJson
    $scaled=Invoke-RestMethod -Method Post -Uri "$base/studies/width/apply" -Headers $headers -ContentType 'application/json' -Body $applyJson
    Assert-Contract 'Project' ($scaled|ConvertTo-Json -Depth 100)
    if ($scaled.input.segments[0].effective_width_mm -ne 4 -or $scaled.last_calculation.traction_mpa[2] -ne 1.5 -or $scaled.last_calculation.strength_status -ne 'unsupported_calculation') { throw 'Width study apply changed loads or claimed normative strength' }
    $massJson='{"schema_version":1,"model":{"mass_kg":10,"gravity_m_s2":[0,0,-10],"acceleration_m_s2":[2,0,0]}}'
    Assert-Contract 'MassLoadRequest' $massJson
    $mass=Invoke-RestMethod -Method Post -Uri "$base/loads/mass" -Headers $headers -ContentType 'application/json' -Body $massJson
    Assert-Contract 'MassLoadResult' ($mass | ConvertTo-Json -Depth 100)
    if ($mass.force_n[0] -ne -20 -or $mass.force_n[2] -ne -100) { throw 'Equivalent load reaction signs or SI units are wrong' }
    $massJoint=$inputJson | ConvertFrom-Json -AsHashtable
    $massJoint.force_n=@(0,0,0);$massJoint.application=@{kind='centroid'}
    $massJoint['forces']=@(@{id='mass';title='Mass 1';force_n=$mass.force_n;inertia=$mass.model;application=@{kind='point';point_mm=@(10,20,30)}})
    $massInputJson=$massJoint | ConvertTo-Json -Depth 100
    Assert-Contract 'CalculationInput' $massInputJson
    $massResult=Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body $massInputJson
    Assert-Contract 'CalculationResult' ($massResult | ConvertTo-Json -Depth 100)
    if ($massResult.moment_at_centroid_n_mm[0] -ne -2000 -or $massResult.moment_at_centroid_n_mm[1] -ne 400 -or $massResult.moment_at_centroid_n_mm[2] -ne 400) { throw 'Mass load application point was not preserved in moment transport' }
    $sectionJson='{"schema_version":1,"model":{"kind":"idealized_right_angle_fillet","leg_1_mm":3,"leg_2_mm":4}}'
    Assert-Contract 'SectionRequest' $sectionJson
    $section=Invoke-RestMethod -Method Post -Uri "$base/sections/derive" -Headers $headers -ContentType 'application/json' -Body $sectionJson
    Assert-Contract 'SectionResult' ($section | ConvertTo-Json -Depth 100)
    if ($section.status -ne 'idealized_geometry' -or $section.effective_width_mm -ne 2.4) { throw 'Independent 3-4-5 triangle throat reference failed' }
    $sectionJoint=$inputJson | ConvertFrom-Json -AsHashtable
    $sectionJoint.segments[0].effective_width_mm=$section.effective_width_mm
    $sectionJoint.segments[0]['section']=$section.model
    $sectionInputJson=$sectionJoint | ConvertTo-Json -Depth 100
    Assert-Contract 'CalculationInput' $sectionInputJson
    $sectionResult=Invoke-RestMethod -Method Post -Uri "$base/calculate" -Headers $headers -ContentType 'application/json' -Body $sectionInputJson
    Assert-Contract 'CalculationResult' ($sectionResult | ConvertTo-Json -Depth 100)
    if ($sectionResult.geometry.area_mm2 -ne 240 -or $sectionResult.traction_mpa[2] -ne 2.5 -or $sectionResult.strength_status -ne 'unsupported_calculation') { throw 'Derived section did not reach the actual nominal calculation' }

    $clientOutput = & dotnet run --no-build --configuration Release --project (Join-Path $PSScriptRoot '../examples/inventor-client/WeldClient.csproj') -- $port
    if ($LASTEXITCODE -ne 0 -or ($clientOutput -join ' ') -notmatch 'unsupported_calculation') { throw 'C# client did not complete a real API calculation' }

    Write-Output 'PASS: standalone API starts on Windows, binds loopback only, authenticates, calculates the reference and serves OpenAPI.'
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path $tokenPath) { Remove-Item $tokenPath -Force }
}

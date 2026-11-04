$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$process = $null
$script:window = $null

function Wait-Until([scriptblock]$Action, [string]$Description, [int]$Seconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process -and $process.HasExited) { throw "Desktop exited before: $Description (exit $($process.ExitCode))" }
        $value = & $Action
        if ($value) { return $value }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out: $Description"
}
function Find-Name([string]$Name) {
    if (-not $script:window) { return $null }
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    return $script:window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Click-Name([string]$Name) {
    $element = Wait-Until { Find-Name $Name } "control $Name"
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
}
try {
    $executable = Join-Path $PSScriptRoot '../target/release/weld-desktop.exe'
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'native Tauri window'
    Click-Name 'Рассчитать'
    $null = Wait-Until { Find-Name 'Номинальные компоненты F/A' } 'real Rust calculation result in WebView'
    $null = Wait-Until { Find-Name 'Проверка прочности недоступна' } 'unsupported strength status'
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'SQLite save confirmation'
    Click-Name 'Создать'
    $null = Wait-Until { Find-Name 'Задайте геометрию и выполните расчёт.' } 'new project with no result'
    Click-Name 'Открыть ревизию'
    $revision = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        $buttons = $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($button in $buttons) {
            if ($button.Current.Name.StartsWith('Новый проект ·')) { return $button }
        }
        return $null
    } 'saved revision button'
    $revision.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $null = Wait-Until { Find-Name 'Номинальные компоненты F/A' } 'restored original result'
    $null = Wait-Until { Find-Name 'Открыт сохранённый снимок. Результат не пересчитан; для нового расчёта нажмите «Рассчитать». Импортированные данные требуют проверки.' } 'snapshot provenance warning'
    Write-Output 'PASS: native window -> WebView -> Rust calculation -> SQLite save -> snapshot reopen.'
 } catch {
    if ($script:window) {
        $elements = $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output 'Accessibility tree (default synthetic project only):'
        $count = 0
        foreach ($element in $elements) {
            Write-Output "$($element.Current.ControlType.ProgrammaticName): $($element.Current.Name)"
            if (++$count -ge 100) { break }
        }
    }
    throw
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

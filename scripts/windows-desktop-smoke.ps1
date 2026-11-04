$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeldDesktopInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
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
    $drawing = Wait-Until { Find-Name 'XY weld layout' } 'editable weld layout'
    $null = Wait-Until { (Find-Name 'Настройки приложения').Current.IsEnabled } 'editor settings loaded from SQLite'
    $bounds = $drawing.Current.BoundingRectangle
    $null = [WeldDesktopInput]::SetCursorPos([int]($bounds.X + $bounds.Width * 0.8), [int]($bounds.Y + $bounds.Height * 0.75))
    [WeldDesktopInput]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    $null = Wait-Until { Find-Name 'Добавить участок здесь' } 'application context menu, not browser menu'
    Click-Name 'Закрыть меню'
    $endpoint = Wait-Until { Find-Name 'S1 Начало' } 'accessible endpoint handle'
    $endpointBounds = $endpoint.Current.BoundingRectangle
    $x = [int]($endpointBounds.X + $endpointBounds.Width / 2)
    $y = [int]($endpointBounds.Y + $endpointBounds.Height / 2)
    $null = [WeldDesktopInput]::SetCursorPos($x, $y)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($x + 30, $y - 20)
    $coordinate = Wait-Until { Find-Name 'S1 X1' } 'numeric coordinate field'
    $valuePattern = $coordinate.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $null = Wait-Until { $valuePattern.Current.Value -ne '-50' } 'mouse drag updates engineering input'
    [WeldDesktopInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { $valuePattern.Current.Value -eq '-50' } 'Escape restores drag input'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

    $endpointBounds = (Find-Name 'S1 Начало').Current.BoundingRectangle
    $x = [int]($endpointBounds.X + $endpointBounds.Width / 2)
    $y = [int]($endpointBounds.Y + $endpointBounds.Height / 2)
    $null = [WeldDesktopInput]::SetCursorPos($x, $y)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($x + 20, $y)
    $null = Wait-Until { $valuePattern.Current.Value -ne '-50' } 'second drag updates engineering input'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Click-Name 'Настройки приложения'
    $step = Wait-Until { Find-Name 'Шаг перемещения, mm' } 'movement step setting'
    $step.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('5')
    Click-Name 'Сохранить настройки'
    $null = Wait-Until { (Find-Name 'Настройки приложения').Current.IsEnabled } 'settings saved'
    $before = [double]::Parse($valuePattern.Current.Value, [Globalization.CultureInfo]::InvariantCulture)
    $whole = Find-Name 'Переместить шов S1'
    $whole.SetFocus()
    [WeldDesktopInput]::keybd_event(0x27, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x27, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { [double]::Parse($valuePattern.Current.Value, [Globalization.CultureInfo]::InvariantCulture) -eq ($before + 5) } 'configured whole-weld keyboard step'
    $endValue = (Find-Name 'S1 X2').GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($endValue.Current.Value -ne '55') { throw 'Whole weld did not move both endpoints together' }
    $before = [double]::Parse($valuePattern.Current.Value, [Globalization.CultureInfo]::InvariantCulture)
    $beforeEnd = [double]::Parse($endValue.Current.Value, [Globalization.CultureInfo]::InvariantCulture)
    $lineBounds = (Find-Name 'Переместить шов S1').Current.BoundingRectangle
    $lineX = [int]($lineBounds.X + $lineBounds.Width / 2)
    $lineY = [int]($lineBounds.Y + $lineBounds.Height / 2)
    $null = [WeldDesktopInput]::SetCursorPos($lineX, $lineY)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($lineX + 30, $lineY - 20)
    $null = Wait-Until { [double]::Parse($valuePattern.Current.Value, [Globalization.CultureInfo]::InvariantCulture) -ne $before } 'whole-weld mouse translation'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $movedStart = [double]::Parse($valuePattern.Current.Value, [Globalization.CultureInfo]::InvariantCulture)
    $movedEnd = [double]::Parse($endValue.Current.Value, [Globalization.CultureInfo]::InvariantCulture)
    if ([Math]::Abs(($movedStart - $before) - ($movedEnd - $beforeEnd)) -gt 1e-9) { throw 'Mouse translation changed the weld vector' }
    Click-Name 'Рассчитать'
    $null = Wait-Until { Find-Name 'Номинальные компоненты F/A' } 'real Rust calculation result in WebView'
    $null = Wait-Until { Find-Name 'Проверка прочности недоступна' } 'unsupported strength status'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $null = Wait-Until { Find-Name 'Несохранённые изменения' } 'unsaved changes guard on native close'
    Click-Name 'Отмена'
    $null = Wait-Until { Find-Name 'Номинальные компоненты F/A' } 'original calculation preserved after cancel'
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
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Clean native close did not complete' }
    if ($process.ExitCode -ne 0) { throw "Desktop closed with exit $($process.ExitCode)" }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'restarted native window'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения'; $control -and $control.Current.IsEnabled } 'persisted preferences loaded'
    Click-Name 'Настройки приложения'
    $step = Wait-Until { Find-Name 'Шаг перемещения, mm' } 'reopened movement step setting'
    if ($step.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -ne '5') { throw 'Movement step was not persisted across process restart' }
    Click-Name 'Отмена'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Restarted desktop did not close cleanly' }
    Write-Output 'PASS: settings persistence and whole-weld movement; application context menu -> real endpoint drag and cancel -> native unsaved close guard -> Rust calculation -> SQLite save -> snapshot reopen -> clean close.'
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

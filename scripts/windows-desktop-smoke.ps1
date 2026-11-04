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
function Find-Name([string]$Name, [System.Windows.Automation.ControlType]$Type = $null) {
    if (-not $script:window) { return $null }
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($Type) {
        $typeCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
        $condition = [System.Windows.Automation.AndCondition]::new($condition, $typeCondition)
    }
    return $script:window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Read-Field([string]$Name) {
    # Opening a modal removes inert content from the accessibility tree. Always
    # reacquire the current control instead of retaining a disconnected pattern.
    return Wait-Until {
        $field = Find-Name $Name ([System.Windows.Automation.ControlType]::Edit)
        if (-not $field) { return $null }
        $value = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($value -ne '') { return $value }
        return $null
    } "current value of $Name"
}
function Document-Key([byte]$Key) {
    (Find-Name 'XY weld layout').SetFocus()
    [WeldDesktopInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event($Key, 0, 2, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
}
function Show-Drawing {
    Document-Key 0x24 # Ctrl+Home: return to the geometry section before physical mouse input.
    $null = Wait-Until {
        $drawing = Find-Name 'XY weld layout'
        $bounds = $drawing.Current.BoundingRectangle
        $windowBounds = $script:window.Current.BoundingRectangle
        -not $drawing.Current.IsOffscreen -and $bounds.Y -ge $windowBounds.Y -and $bounds.Bottom -le $windowBounds.Bottom
    } 'geometry visible after document scroll'
}
function Set-Field([string]$Name, [string]$Value) {
    $field = Wait-Until { Find-Name $Name ([System.Windows.Automation.ControlType]::Edit) } "editable field $Name"
    $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Value)
}
function Open-LatestRevision {
    Click-Name 'Открыть ревизию'
    $revision = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        foreach ($button in $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
            if ($button.Current.Name.StartsWith('Новый проект ·')) { return $button }
        }
        return $null
    } 'latest saved revision'
    $revision.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Click-Name([string]$Name) {
    $element = Wait-Until { $control = Find-Name $Name; if ($control -and $control.Current.IsEnabled) { return $control }; return $null } "enabled control $Name"
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        $pattern.Toggle()
    } else {
        throw "Control '$Name' supports neither Invoke nor Toggle"
    }
}
try {
    $executable = Join-Path $PSScriptRoot '../target/release/weld-desktop.exe'
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'native Tauri window'
    $drawing = Wait-Until { Find-Name 'XY weld layout' } 'editable weld layout'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button); $control -and $control.Current.IsEnabled } 'editor settings loaded from SQLite'
    Document-Key 0x23 # Ctrl+End: results follow welds and loads below the first screen.
    $null = Wait-Until { $result = Find-Name 'Задайте геометрию и выполните расчёт.'; $result -and -not $result.Current.IsOffscreen } 'results reached by vertical document scroll'
    if (-not (Find-Name 'S1 Начало').Current.IsOffscreen) { throw 'Geometry and results are still shown side by side' }
    Show-Drawing
    $bounds = (Find-Name 'XY weld layout').Current.BoundingRectangle
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
    $null = Wait-Until { (Read-Field 'S1 X1') -ne '-50' } 'mouse drag updates engineering input'
    [WeldDesktopInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { (Read-Field 'S1 X1') -eq '-50' } 'Escape restores drag input'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

    $endpointBounds = (Find-Name 'S1 Начало').Current.BoundingRectangle
    $x = [int]($endpointBounds.X + $endpointBounds.Width / 2)
    $y = [int]($endpointBounds.Y + $endpointBounds.Height / 2)
    $null = [WeldDesktopInput]::SetCursorPos($x, $y)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($x + 20, $y)
    $null = Wait-Until { (Read-Field 'S1 X1') -ne '-50' } 'second drag updates engineering input'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Click-Name 'Настройки приложения'
    $step = Wait-Until { Find-Name 'Шаг перемещения, mm' ([System.Windows.Automation.ControlType]::Edit) } 'movement step setting'
    $step.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('5')
    Click-Name 'Сохранить настройки'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button); $control -and $control.Current.IsEnabled } 'settings saved'
    $before = [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture)
    $whole = Find-Name 'Переместить шов S1'
    $whole.SetFocus()
    [WeldDesktopInput]::keybd_event(0x27, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x27, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture) -eq ($before + 5) } 'configured whole-weld keyboard step'
    if ((Read-Field 'S1 X2') -ne '55') { throw 'Whole weld did not move both endpoints together' }
    $before = [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture)
    $beforeEnd = [double]::Parse((Read-Field 'S1 X2'), [Globalization.CultureInfo]::InvariantCulture)
    Show-Drawing
    $lineBounds = (Find-Name 'Переместить шов S1').Current.BoundingRectangle
    $lineX = [int]($lineBounds.X + $lineBounds.Width / 2)
    $lineY = [int]($lineBounds.Y + $lineBounds.Height / 2)
    $null = [WeldDesktopInput]::SetCursorPos($lineX, $lineY)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($lineX + 30, $lineY - 20)
    $null = Wait-Until { [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture) -ne $before } 'whole-weld mouse translation'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $movedStart = [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture)
    $movedEnd = [double]::Parse((Read-Field 'S1 X2'), [Globalization.CultureInfo]::InvariantCulture)
    if ([Math]::Abs(($movedStart - $before) - ($movedEnd - $beforeEnd)) -gt 1e-9) { throw 'Mouse translation changed the weld vector' }
    Click-Name 'Отменить'
    $null = Wait-Until { [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture) -eq $before } 'one undo restores the complete drag'
    if ([double]::Parse((Read-Field 'S1 X2'), [Globalization.CultureInfo]::InvariantCulture) -ne $beforeEnd) { throw 'Undo did not restore both weld endpoints' }
    Click-Name 'Повторить'
    $null = Wait-Until { [double]::Parse((Read-Field 'S1 X1'), [Globalization.CultureInfo]::InvariantCulture) -eq $movedStart } 'redo restores the translated weld'
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
    (Find-Name 'Переместить шов S1').SetFocus()
    [WeldDesktopInput]::keybd_event(0x27, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event(0x27, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { -not (Find-Name 'Номинальные компоненты F/A') } 'editing invalidates the saved calculation'
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Номинальные компоненты F/A' } 'undo restores the saved calculation'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Undo to saved snapshot did not restore clean state' }
    Click-Name 'Вписать схему'
    Show-Drawing
    $endBounds = (Find-Name 'S1 Конец').Current.BoundingRectangle
    Click-Name 'Приблизить схему'
    $null = Wait-Until { (Find-Name 'S1 Конец').Current.BoundingRectangle.X -gt ($endBounds.X + 5) } 'native zoom changes the viewport'
    Click-Name 'Вписать схему'
    Click-Name 'Панорамирование'
    $beforePan = (Find-Name 'S1 Конец').Current.BoundingRectangle.X
    $canvasBounds = (Find-Name 'XY weld layout').Current.BoundingRectangle
    $panX = [int]($canvasBounds.X + $canvasBounds.Width * .7)
    $panY = [int]($canvasBounds.Y + $canvasBounds.Height * .7)
    $null = [WeldDesktopInput]::SetCursorPos($panX, $panY)
    [WeldDesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    $null = [WeldDesktopInput]::SetCursorPos($panX + 20, $panY + 10)
    $null = Wait-Until { (Find-Name 'S1 Конец').Current.BoundingRectangle.X -gt ($beforePan + 10) } 'native pan moves the viewport'
    [WeldDesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Click-Name 'Панорамирование'
    Click-Name 'Вписать схему'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Viewport navigation changed the project' }
    if (-not (Find-Name 'Номинальные компоненты F/A')) { throw 'Viewport navigation invalidated calculation' }
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
    Set-Field 'couple_n_mm x' '160000'
    Click-Name 'Рассчитать'
    $null = Wait-Until { Find-Name 'Изгиб не рассчитан: сечение вырождено или плохо обусловлено. Задайте пространственно разнесённые в плоскости XY участки.' } 'singular bending produces a clear reason without stresses'
    Click-Name 'Добавить участок'
    Set-Field 'S1 X1' '-50'; Set-Field 'S1 X2' '50'; Set-Field 'S1 Y1' '20'; Set-Field 'S1 Y2' '20'
    Set-Field 'S2 X1' '-50'; Set-Field 'S2 X2' '50'; Set-Field 'S2 Y1' '-20'; Set-Field 'S2 Y2' '-20'
    Click-Name 'Рассчитать'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'real Rust nominal bending distribution'
    $null = Wait-Until { Find-Name '-18,5 / 21,5' } 'independent analytical bending range for two parallel welds'
    Set-Field 'couple_n_mm z' '1000'
    Click-Name 'Рассчитать'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'combined bending and torsion distribution'
    if (Find-Name 'Номинальные компоненты F/A') { throw 'A varying distribution was displayed as uniform F/A' }
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'distribution stored in SQLite'
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Clean native close did not complete' }
    if ($process.ExitCode -ne 0) { throw "Desktop closed with exit $($process.ExitCode)" }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'restarted native window'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button); $control -and $control.Current.IsEnabled } 'persisted preferences loaded'
    Click-Name 'Настройки приложения'
    $step = Wait-Until { Find-Name 'Шаг перемещения, mm' ([System.Windows.Automation.ControlType]::Edit) } 'reopened movement step setting'
    if ($step.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -ne '5') { throw 'Movement step was not persisted across process restart' }
    Click-Name 'Отмена'
    Open-LatestRevision
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'distribution snapshot restored after full process restart'
    $null = Wait-Until { Find-Name '-18,5 / 21,5' } 'stored analytical bending range preserved'
    $null = Wait-Until { Find-Name 'Открыт сохранённый снимок. Результат не пересчитан; для нового расчёта нажмите «Рассчитать». Импортированные данные требуют проверки.' } 'distribution provenance without automatic recalculation'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Restarted desktop did not close cleanly' }
    Write-Output 'PASS: vertically scrolling welds-loads-results layout; nominal bending/torsion, singular section refusal, distribution snapshot restart; undo/redo, saved result restoration, viewport zoom and pan; settings persistence and whole-weld movement; application context menu -> real endpoint drag and cancel -> native unsaved close guard -> Rust calculation -> SQLite save -> snapshot reopen -> clean close.'
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

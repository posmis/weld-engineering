param([string]$Executable = (Join-Path $PSScriptRoot "../target/release/weld-desktop.exe"))
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
function Key-Press([byte]$Key) {
    [WeldDesktopInput]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
    [WeldDesktopInput]::keybd_event($Key, 0, 2, [UIntPtr]::Zero)
}
function Activate-Tree([string]$Name) {
    $item = Wait-Until { $node = Find-Name $Name ([System.Windows.Automation.ControlType]::TreeItem); if ($node -and $node.Current.IsEnabled) { return $node }; return $null } "tree item $Name"
    $item.SetFocus(); Key-Press 0x20
}
function Show-Property([string]$Name) {
    if (Find-Name $Name ([System.Windows.Automation.ControlType]::Edit)) { return }
    if ($Name -match '^S(\d+) ') { Activate-Tree "Шов S$($Matches[1])" }
    elseif ($Name -match '^(force_n|couple_n_mm|P) ') { Activate-Tree 'Нагрузки' }
}
function Read-Field([string]$Name) {
    Show-Property $Name
    return Wait-Until {
        $field = Find-Name $Name ([System.Windows.Automation.ControlType]::Edit)
        if (-not $field) { return $null }
        $value = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($value -ne '') { return $value }; return $null
    } "current value of $Name"
}
function Set-Field([string]$Name, [string]$Value) {
    Show-Property $Name
    $field = Wait-Until { Find-Name $Name ([System.Windows.Automation.ControlType]::Edit) } "editable field $Name"
    $field.SetFocus()
    $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Value)
}
function Show-Drawing {
    (Find-Name 'XY weld layout').SetFocus()
    $null = Wait-Until {
        $bounds = (Find-Name 'XY weld layout').Current.BoundingRectangle
        $windowBounds = $script:window.Current.BoundingRectangle
        $bounds.Height -gt 0 -and $bounds.Y -ge $windowBounds.Y -and $bounds.Bottom -le $windowBounds.Bottom
    } 'persistent CAD viewport visible'
}
function Save-Preview([string]$Name) {
    try {
        Add-Type -AssemblyName System.Drawing
        $bounds = $script:window.Current.BoundingRectangle
        $image = [System.Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($image)
        try {
            $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $image.Size)
            $image.Save((Join-Path $PSScriptRoot "../target/$Name"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $image.Dispose() }
    } catch { Write-Warning "Optional screenshot unavailable: $_" }
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
    } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $pattern.Expand() }
        else { $pattern.Collapse() }
    } else {
        throw "Control '$Name' supports neither Invoke, Toggle nor ExpandCollapse"
    }
}
try {
    $executable = [System.IO.Path]::GetFullPath($Executable)
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'native Tauri window'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения'; $control -and $control.Current.IsEnabled } 'editor preferences loaded'
    $null = Wait-Until { Find-Name 'Модель и расчёт' ([System.Windows.Automation.ControlType]::Tree) } 'CAD model tree'
    Show-Drawing
    $canvas = (Find-Name 'XY weld layout').Current.BoundingRectangle
    $sidebar = (Find-Name 'Дерево модели и свойства').Current.BoundingRectangle
    $windowBounds = $script:window.Current.BoundingRectangle
    if ($canvas.X -lt $sidebar.Right) { throw 'Viewport is not docked to the right of the model tree' }
    if ($canvas.Height -lt ($windowBounds.Height * .55)) { throw 'CAD viewport does not occupy the working height' }
    if ($canvas.Width -lt ($windowBounds.Width * .5)) { throw 'CAD viewport is too narrow' }
    if ((Find-Name 'Рассчитать').Current.IsOffscreen) { throw 'Calculate is not in the top toolbar' }
    if ((Read-Field 'S1 X1') -ne '-50') { throw 'Selected weld properties are incorrect' }
    Save-Preview 'windows-ui-smoke.png'
    $sideWidth = $sidebar.Width
    (Find-Name 'Ширина панели модели').SetFocus(); Key-Press 0x27
    $null = Wait-Until { (Find-Name 'Дерево модели и свойства').Current.BoundingRectangle.Width -gt ($sideWidth + 10) } 'sidebar splitter resizes the dock'
    Key-Press 0x25
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
    $null = [WeldDesktopInput]::SetCursorPos($lineX + [int]($lineBounds.Width * .06), $lineY - 20)
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
    Activate-Tree 'Нагрузки'
    Save-Preview 'windows-results-smoke.png'
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
    Click-Name 'Скрыть результаты'
    Click-Name 'Вписать схему'
    Show-Drawing
    $null = Wait-Until { Find-Name '100%' } 'canvas fitted at full available width'
    Click-Name 'Приблизить схему'
    $null = Wait-Until { Find-Name '125%' } 'native zoom changes the viewport'
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
    Activate-Tree 'Результаты'
    if (-not (Find-Name 'Номинальные компоненты F/A')) { throw 'Viewport navigation invalidated calculation' }
    Click-Name 'Создать'
    Activate-Tree 'Результаты'
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
    Click-Name 'Скрыть результаты'
    Activate-Tree 'Результаты'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'reopened dock preserves original distribution'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Dock navigation changed the saved project' }
    Activate-Tree 'Нагрузки'
    Click-Name 'Копировать случай'
    Set-Field 'force_n z' '-600'
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'complete independent-case envelope'
    $null = Wait-Until { Find-Name '-21,5 / 18,5' } 'reverse load case uses its own distribution'
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'casebook saved'
    $mode = Find-Name 'Вид' ([System.Windows.Automation.ControlType]::ComboBox)
    if (-not $mode) { throw 'Contour view selector is unavailable' }
    $mode.SetFocus(); Key-Press 0x24
    1..3 | ForEach-Object { Key-Press 0x28 }; Key-Press 0x0D; Key-Press 0x1B
    $null = Wait-Until { Find-Name 'Шкала номинальных напряжений' } 'nominal stress contour displayed on the actual weld layout'
    $null = Wait-Until { Find-Name 'σz · MPa' ([System.Windows.Automation.ControlType]::Text) } 'signed normal component selected'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Changing contour view modified the saved project' }
    $mode.SetFocus(); Key-Press 0x24; Key-Press 0x28; Key-Press 0x28; Key-Press 0x0D; Key-Press 0x1B
    $null = Wait-Until { Find-Name 'τy · MPa' ([System.Windows.Automation.ControlType]::Text) } 'shear component shown with its own scale'
    Click-Name 'Скрыть результаты'
    $null = Wait-Until {
        $a = (Find-Name 'S1 Начало').Current.BoundingRectangle
        $b = (Find-Name 'S1 Конец').Current.BoundingRectangle
        $view = (Find-Name 'XY weld layout').Current.BoundingRectangle
        [Math]::Abs($b.X - $a.X) -gt $view.Width * .4
    } 'contour refits the expanded HTML viewport after hiding results'
    Save-Preview 'windows-contour-smoke.png'
    Click-Name 'F / M'
    if (Find-Name 'Заданные нагрузки на схеме') { throw 'Load layer did not hide' }
    Click-Name 'F / M'
    $null = Wait-Until { Find-Name 'Заданные нагрузки на схеме' } 'force and couple readout restored'
    $mode.SetFocus(); Key-Press 0x24; Key-Press 0x0D; Key-Press 0x1B
    if (Find-Name 'Шкала номинальных напряжений') { throw 'Geometry mode retained a coloured result overlay' }
    Activate-Tree 'Результаты'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filenameCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
    $filename = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $filenameCondition)
    if (-not $filename) { throw 'Native PDF filename input not found' }
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-report-smoke.pdf'))
    $filename.SetFocus()
    # The shell dialog requires actual editing keystrokes, not only UIA SetValue.
    Set-Clipboard -Value $reportPath
    [WeldDesktopInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    Key-Press 0x41
    Key-Press 0x56
    [WeldDesktopInput]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
    $null = Wait-Until { $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -eq $reportPath } 'native filename entered by keyboard'
    Key-Press 0x09
    $saveCondition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
    $save = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $saveCondition)
    $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $pdfPrefix = 'PDF-отчёт сохранён: '
    $pdfStatus = Wait-Until {
        $texts = $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text))
        foreach ($text in $texts) { if ($text.Current.Name.StartsWith($pdfPrefix)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Activate-Tree 'Шов S1'
    Click-Name 'Прерывистый шов'
    Click-Name 'Заменить выбранный шов'
    $null = Wait-Until { Find-Name 'Шов S4' ([System.Windows.Automation.ControlType]::TreeItem) } 'intermittent pieces replace one continuous segment'
    $null = Wait-Until { Find-Name 'Задайте геометрию и выполните расчёт.' } 'intermittent edit invalidates active case'
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'undo intermittent edit restores casebook snapshots'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Undo intermittent geometry failed to restore saved project' }
    Click-Name 'Шаблон группы'
    $null = Wait-Until { Find-Name 'Предварительный просмотр группы швов' ([System.Windows.Automation.ControlType]::Image) } 'Rust-generated group preview'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $null = Wait-Until { -not (Find-Name 'Предварительный просмотр группы швов' ([System.Windows.Automation.ControlType]::Image)) } 'native close dismisses preview without losing the project'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Preview changed the saved project before Apply' }
    Click-Name 'Шаблон группы'
    $null = Wait-Until { Find-Name 'Предварительный просмотр группы швов' ([System.Windows.Automation.ControlType]::Image) } 'reopened group preview'
    Save-Preview 'windows-template-smoke.png'
    Click-Name 'Заменить геометрию'
    $null = Wait-Until { Find-Name 'Шов S4' ([System.Windows.Automation.ControlType]::TreeItem) } 'rectangle creates four actual weld elements'
    if ((Read-Field 'force_n z') -ne '-600') { throw 'Template replacement changed the active case load' }
    $null = Wait-Until { Find-Name 'Сводка случаев · 0/2 — Неполная сводка' } 'template invalidates all existing case results'
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'generated rectangle reaches the real Rust batch calculation'
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'one Undo restores original geometry and stored case distributions'
    if (Find-Name 'Шов S4' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'Undo retained generated rectangle elements' }
    if (Find-Name 'Есть несохранённые изменения') { throw 'Undo template failed to restore the exact saved project' }




    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Restarted desktop did not close cleanly' }
    Write-Output 'PASS: classic CAD toolbar, model tree and selected properties, persistent right viewport, resizable sidebar and bottom result dock; nominal bending/torsion, undo/redo, zoom/pan, SQLite snapshots and process restart.'
 } catch {
    if ($script:window) { Save-Preview 'windows-failure-smoke.png' }
    if ($script:window) {
        $elements = $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output 'Accessibility tree (default synthetic project only):'
        $count = 0
        foreach ($element in $elements) {
            Write-Output "$($element.Current.ControlType.ProgrammaticName): $($element.Current.Name)"
            if (++$count -ge 300) { break }
        }
    }
    throw
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

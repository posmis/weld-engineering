param([string]$Executable = (Join-Path $PSScriptRoot "../target/release/weld-desktop.exe"))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeldDesktopInput {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
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
    if (-not (Find-Name $Name ([System.Windows.Automation.ControlType]::TreeItem))) {
        $parentName = if ($Name -match '^Шов S') { 'Сварные швы' } elseif ($Name -match '^(Сила |Свободный момент)') { 'Нагрузки' } else { $null }
        if ($parentName) { $parent = Find-Name $parentName ([System.Windows.Automation.ControlType]::TreeItem); if ($parent) { $parent.SetFocus();$null=Wait-Until { $parent.Current.HasKeyboardFocus } "keyboard focus on tree branch $parentName";Key-Press 0x27 } }
    }
    $item = Wait-Until { $node = Find-Name $Name ([System.Windows.Automation.ControlType]::TreeItem); if ($node -and $node.Current.IsEnabled) { return $node }; return $null } "tree item $Name"
    $item.SetFocus()
    $null=Wait-Until { $node=Find-Name $Name ([System.Windows.Automation.ControlType]::TreeItem);$node -and $node.Current.HasKeyboardFocus } "keyboard focus on tree item $Name"
    Key-Press 0x0D
}
function Open-TreeContext([string]$Name) {
    Activate-Tree $Name
    $node = Find-Name $Name ([System.Windows.Automation.ControlType]::TreeItem)
    $box = $node.Current.BoundingRectangle
    $null = [WeldDesktopInput]::SetCursorPos([int]($box.X+30),[int]($box.Y+$box.Height/2))
    [WeldDesktopInput]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [WeldDesktopInput]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero)
    $null = Wait-Until { Find-Name 'Команды дерева' ([System.Windows.Automation.ControlType]::Menu) } 'item context menu'
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
function Assert-ViewportCorner {
    $null = Wait-Until {
        $axes = Find-Name 'Оси координат XY' ([System.Windows.Automation.ControlType]::Image)
        $loads = Find-Name 'Заданные нагрузки на схеме'
        if (-not $axes -or -not $loads) { return $false }
        $a = $axes.Current.BoundingRectangle
        $b = $loads.Current.BoundingRectangle
        $v = (Find-Name 'XY weld layout').Current.BoundingRectangle
        $a.Width -gt 0 -and $a.Height -gt 0 -and $a.Bottom -lt $b.Top -and $a.Top -ge $v.Top -and $b.Bottom -le $v.Bottom
    } 'orientation axes above load readout without overlap and inside viewport'
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
# The shell publishes its save window before the editable child is ready for UIA focus.
# AutomationId 1001 can identify the filename combo container rather than its edit child.
function Focus-PdfFilename($Dialog) {
    return Wait-Until {
        $id = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
        $container = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $id)
        if (-not $container) { return $null }
        $editType = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
        $candidates = @($container) + @($container.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editType))
        foreach ($candidate in $candidates) {
            try {
                if (-not $candidate.Current.IsEnabled -or -not $candidate.Current.IsKeyboardFocusable -or $candidate.Current.IsOffscreen) { continue }
                $value = $null
                if (-not $candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { continue }
                $candidate.SetFocus()
                return $candidate
            } catch [System.InvalidOperationException] { continue }
        }
        return $null
    } 'native PDF filename editable and focusable'
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
    $element = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
        foreach ($control in $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
            if (-not $control.Current.IsEnabled) { continue }
            foreach ($patternId in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.ExpandCollapsePattern]::Pattern)) {
                $candidate = $null
                if ($control.TryGetCurrentPattern($patternId,[ref]$candidate)) { return $control }
            }
        }
        return $null
    } "enabled actionable control $Name"
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
    $sidebar = (Find-Name 'Дерево модели').Current.BoundingRectangle
    $windowBounds = $script:window.Current.BoundingRectangle
    $properties = (Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle
    if ($properties.X -lt $sidebar.Right -or $canvas.X -lt $properties.Right) { throw 'Tree properties and viewport are not separate columns' }
    if ($canvas.Height -lt ($windowBounds.Height * .55)) { throw 'CAD viewport does not occupy the working height' }
    if ($canvas.Width -lt ($windowBounds.Width * .4)) { throw 'CAD viewport is too narrow' }
    if ((Find-Name 'Рассчитать').Current.IsOffscreen) { throw 'Calculate is not in the top toolbar' }
    $geometryRow = (Find-Name 'Добавить участок').Current.BoundingRectangle.Y
    $calculationRow = (Find-Name 'Рассчитать').Current.BoundingRectangle.Y
    if ([Math]::Abs($geometryRow - $calculationRow) -gt 2) { throw 'Geometry and calculation tools create an unnecessary extra row' }
    if ((Read-Field 'S1 X1') -ne '-50') { throw 'Selected weld properties are incorrect' }
    Assert-ViewportCorner
    Save-Preview 'windows-ui-smoke.png'
    $sideWidth = $sidebar.Width
    (Find-Name 'Ширина панели модели').SetFocus(); Key-Press 0x27
    $null = Wait-Until { (Find-Name 'Дерево модели').Current.BoundingRectangle.Width -gt ($sideWidth + 10) } 'sidebar splitter resizes the dock'
    Key-Press 0x25
    $propertiesWidth = (Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle.Width
    (Find-Name 'Ширина столбца свойств').SetFocus(); Key-Press 0x27
    $null = Wait-Until { (Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle.Width -gt ($propertiesWidth + 10) } 'properties column has its own splitter'
    Key-Press 0x25
    (Find-Name 'Ширина панели модели').SetFocus(); Key-Press 0x23
    (Find-Name 'Ширина столбца свойств').SetFocus(); Key-Press 0x23
    $originalWindow = $script:window.Current.BoundingRectangle
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::SetWindowPos($handle,[IntPtr]::Zero,[int]$originalWindow.X,[int]$originalWindow.Y,880,[int]$originalWindow.Height,0x0014)
    $null = Wait-Until {
        $tree = (Find-Name 'Дерево модели').Current.BoundingRectangle
        $properties = (Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle
        $view = (Find-Name 'XY weld layout').Current.BoundingRectangle
        $view.Width -ge 290 -and $properties.X -ge $tree.Right -and $view.X -ge $properties.Right
    } 'columns shrink safely after narrowing a previously expanded window'
    $null = [WeldDesktopInput]::SetWindowPos($handle,[IntPtr]::Zero,[int]$originalWindow.X,[int]$originalWindow.Y,[int]$originalWindow.Width,[int]$originalWindow.Height,0x0014)
    (Find-Name 'Ширина панели модели').SetFocus(); Key-Press 0x24
    (Find-Name 'Ширина столбца свойств').SetFocus(); Key-Press 0x24
    if (Find-Name 'Есть несохранённые изменения') { throw 'Column resize modified the project' }
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
    Click-Name 'Показывать координатную сетку'
    Click-Name 'Сохранить настройки'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button); $control -and $control.Current.IsEnabled } 'settings saved'
    $null = Wait-Until { Find-Name 'Координатная сетка' ([System.Windows.Automation.ControlType]::Image) } 'visible coordinate grid with snapping disabled'
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
    Assert-ViewportCorner
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
    Click-Name 'Восстановить стандартную раскладку'
    (Find-Name 'Ширина панели модели').SetFocus(); Key-Press 0x27
    (Find-Name 'Ширина столбца свойств').SetFocus(); Key-Press 0x25
    (Find-Name 'Высота панели результатов').SetFocus(); Key-Press 0x26
    if (Find-Name 'Есть несохранённые изменения') { throw 'Manual workspace layout changed the saved project' }
    $savedTreeWidth = (Find-Name 'Дерево модели').Current.BoundingRectangle.Width
    $savedPropertiesWidth = (Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle.Width
    $savedResultsHeight = (Find-Name 'Результаты' ([System.Windows.Automation.ControlType]::Group)).Current.BoundingRectangle.Height

    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Clean native close did not complete' }
    if ($process.ExitCode -ne 0) { throw "Desktop closed with exit $($process.ExitCode)" }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'restarted native window'
    $null = Wait-Until { $control = Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button); $control -and $control.Current.IsEnabled } 'persisted preferences loaded'
    $null = Wait-Until {
        [Math]::Abs((Find-Name 'Дерево модели').Current.BoundingRectangle.Width - $savedTreeWidth) -lt 1 -and
        [Math]::Abs((Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle.Width - $savedPropertiesWidth) -lt 1
    } 'workspace column sizes restored after full process restart'
    Click-Name 'Настройки приложения'
    $step = Wait-Until { Find-Name 'Шаг перемещения, mm' ([System.Windows.Automation.ControlType]::Edit) } 'reopened movement step setting'
    if ($step.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -ne '5') { throw 'Movement step was not persisted across process restart' }
    if ((Find-Name 'Показывать координатную сетку').GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { throw 'Grid visibility was not persisted' }
    if ((Find-Name 'Привязка к сетке').GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { throw 'Showing grid enabled snapping' }
    Click-Name 'Отмена'
    $null = Wait-Until { Find-Name 'Координатная сетка' ([System.Windows.Automation.ControlType]::Image) } 'grid display restored after restart'
    Open-LatestRevision
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'distribution snapshot restored after full process restart'
    $null = Wait-Until { Find-Name '-18,5 / 21,5' } 'stored analytical bending range preserved'
    $null = Wait-Until { [Math]::Abs((Find-Name 'Результаты' ([System.Windows.Automation.ControlType]::Group)).Current.BoundingRectangle.Height - $savedResultsHeight) -lt 1 } 'result dock height restored after restart'
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
    Assert-ViewportCorner
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
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-report-smoke.pdf'))
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
    Activate-Tree 'Результаты'
    $null = Wait-Until { Find-Name 'Сводка случаев · 0/2 — Неполная сводка' } 'template invalidates all existing case results'
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'generated rectangle reaches the real Rust batch calculation'
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'one Undo restores original geometry and stored case distributions'
    if (Find-Name 'Шов S4' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'Undo retained generated rectangle elements' }
    if (Find-Name 'Есть несохранённые изменения') { throw 'Undo template failed to restore the exact saved project' }
    Click-Name 'Преобразовать'
    $null = Wait-Until { Find-Name 'Предпросмотр преобразования' ([System.Windows.Automation.ControlType]::Image) } 'Rust transform preview before cancellation'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $null = Wait-Until { -not (Find-Name 'Предпросмотр преобразования' ([System.Windows.Automation.ControlType]::Image)) } 'native close cancels transform preview'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Transform preview modified the project before Apply' }
    foreach ($operation in 0..2) {
        Click-Name 'Преобразовать'
        $choice = Wait-Until { Find-Name 'Операция' ([System.Windows.Automation.ControlType]::ComboBox) } 'transform operation selector'
        $choice.SetFocus(); Key-Press 0x24
        for ($i = 0; $i -lt $operation; $i++) { Key-Press 0x28 }
        Key-Press 0x0D
        if ($operation -eq 0) {
            Set-Field 'Смещение X, mm' '25'; Set-Field 'Смещение Y, mm' '-10'
            $expectedX = '-25'; $expectedY = '10'
        } elseif ($operation -eq 1) {
            if ((Read-Field 'Угол, °') -ne '90') { throw 'Unexpected default rotation angle' }
            $expectedX = '-20'; $expectedY = '-50'
        } else { $expectedX = '-50'; $expectedY = '-20' }
        $null = Wait-Until { Find-Name 'Предпросмотр преобразования' ([System.Windows.Automation.ControlType]::Image) } 'current transformed group preview'
        if ($operation -eq 1) { Save-Preview 'windows-transform-smoke.png' }
        Click-Name 'Применить преобразование'
        if ((Read-Field 'S1 X1') -ne $expectedX -or (Read-Field 'S1 Y1') -ne $expectedY) { throw "Operation $operation returned incorrect coordinates" }
        if ((Read-Field 'force_n z') -ne '-600') { throw 'Geometry transformation modified the global force' }
        Activate-Tree 'Результаты'
        $null = Wait-Until { Find-Name 'Сводка случаев · 0/2 — Неполная сводка' } 'transform invalidates both case results'
        Click-Name 'Рассчитать все'
        $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'transformed geometry reaches real Rust calculation'
        Click-Name 'Отменить'
        $null = Wait-Until { Find-Name 'Номинальное распределение напряжений' } 'Undo restores pre-transform calculation'
        if ((Read-Field 'S1 X1') -ne '-50' -or (Read-Field 'S1 Y1') -ne '20') { throw 'Undo did not restore original geometry' }
        if (Find-Name 'Есть несохранённые изменения') { throw 'Transform Undo did not restore the exact saved project' }
    }
    $loadsNode = Find-Name 'Нагрузки' ([System.Windows.Automation.ControlType]::TreeItem)
    $box = $loadsNode.Current.BoundingRectangle
    $null = [WeldDesktopInput]::SetCursorPos([int]($box.X+30),[int]($box.Y+14))
    [WeldDesktopInput]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [WeldDesktopInput]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero)
    $null = Wait-Until { Find-Name 'Добавить силу' ([System.Windows.Automation.ControlType]::MenuItem) } 'tree-specific context menu'
    Save-Preview 'windows-tree-menu-smoke.png'
    Click-Name 'Добавить силу'
    $null = Wait-Until { Find-Name 'Сила F2' ([System.Windows.Automation.ControlType]::TreeItem) } 'simultaneous force inserted into the expanded tree'
    Set-Field 'force_n z' '300'
    Click-Name 'Приложить силу в центре сечения'
    Set-Field 'P x' '25'
    Activate-Tree 'Сила F1'
    if ((Read-Field 'force_n z') -ne '-600') { throw 'Adding F2 changed the original force F1' }
    Activate-Tree 'Сила F2'
    if ((Read-Field 'force_n z') -ne '300' -or (Read-Field 'P x') -ne '25') { throw 'Selecting a force did not restore its own properties' }
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'multiple simultaneous forces survive casebook validation and real calculation'
    Save-Preview 'windows-tree-forces-smoke.png'
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'force collection snapshots saved to SQLite'
    Open-TreeContext 'Сила F2'
    Save-Preview 'windows-item-menu-smoke.png'
    Click-Name 'Копировать силу'
    $null = Wait-Until { Find-Name 'Сила F2 (копия)' ([System.Windows.Automation.ControlType]::TreeItem) } 'independent copied force appears in the tree'
    if ((Read-Field 'force_n z') -ne '300' -or (Read-Field 'P x') -ne '25') { throw 'Force copy lost source values or application point' }
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'copied force participates in the real batch calculation'
    Click-Name 'Отменить'
    if (Find-Name 'Сила F2 (копия)' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'One Undo did not remove copied force' }
    if (Find-Name 'Есть несохранённые изменения') { throw 'Force-copy Undo did not restore the saved casebook and results' }
    Open-TreeContext 'Сила F2'
    Click-Name 'Удалить выбранную силу'
    if (Find-Name 'Сила F2' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'Context deletion retained the force' }
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Сила F2' ([System.Windows.Automation.ControlType]::TreeItem) } 'Undo restores deleted force'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Force-delete Undo did not restore the saved project' }
    Open-TreeContext 'Шов S1'
    Click-Name 'Копировать участок'
    $null = Wait-Until { Find-Name 'Предпросмотр преобразования' ([System.Windows.Automation.ControlType]::Image) } 'Rust validates combined copied geometry'
    Save-Preview 'windows-copy-weld-smoke.png'
    Click-Name 'Применить преобразование'
    $null = Wait-Until { Find-Name 'Шов S3' ([System.Windows.Automation.ControlType]::TreeItem) } 'copied weld appended to original group'
    if ((Read-Field 'S3 Y1') -ne '30') { throw 'Copied weld did not use the requested displacement' }
    Activate-Tree 'Шов S1'
    if ((Read-Field 'S1 Y1') -ne '20') { throw 'Weld copy moved the original segment' }
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'copied weld reaches real Rust calculation with existing forces'
    Click-Name 'Отменить'
    if (Find-Name 'Шов S3' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'Undo retained copied weld' }
    if (Find-Name 'Есть несохранённые изменения') { throw 'Weld-copy Undo did not restore the complete saved snapshot' }
    Open-TreeContext 'Шов S2'
    Click-Name 'Удалить участок'
    if (Find-Name 'Шов S2' ([System.Windows.Automation.ControlType]::TreeItem)) { throw 'Context deletion retained the weld' }
    Click-Name 'Отменить'
    $null = Wait-Until { Find-Name 'Шов S2' ([System.Windows.Automation.ControlType]::TreeItem) } 'Undo restores deleted weld'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Weld-delete Undo did not restore the complete saved snapshot' }
    Click-Name 'Восстановить стандартную раскладку'
    $null = Wait-Until {
        [Math]::Abs((Find-Name 'Дерево модели').Current.BoundingRectangle.Width - 220) -lt 1 -and
        [Math]::Abs((Find-Name 'Свойства выбранного элемента').Current.BoundingRectangle.Width - 280) -lt 1
    } 'explicit reset restores default workspace dimensions'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Workspace reset changed the saved project' }
    Activate-Tree 'Сила F2'
    $null = Wait-Until { Find-Name 'Сила F2' ([System.Windows.Automation.ControlType]::Table) } 'force property grid is exposed as a real table'
    if ((Read-Field 'force_n z') -ne '300' -or (Read-Field 'P x') -ne '25') { throw 'Property grid changed force values or units mapping' }
    (Find-Name 'Высота панели результатов').SetFocus(); Key-Press 0x23
    $null = Wait-Until { (Find-Name 'XY weld layout').Current.BoundingRectangle.Height -ge 159 } 'maximal result dock retains a usable graphical canvas'
    Assert-ViewportCorner
    if (Find-Name 'Есть несохранённые изменения') { throw 'Result dock maximum changed the saved project' }
    Click-Name 'Восстановить стандартную раскладку'
    $null = Wait-Until { [Math]::Abs((Find-Name 'Результаты' ([System.Windows.Automation.ControlType]::Group)).Current.BoundingRectangle.Height - 260) -lt 1 } 'reset restores the result dock height'
    Save-Preview 'windows-property-grid-smoke.png'
    Activate-Tree 'Шов S1'
    Click-Name 'Модель сечения'
    Set-Field 'Катет k₁, mm' '3'; Set-Field 'Катет k₂, mm' '4'
    Click-Name 'Рассчитать и применить сечение'
    $null = Wait-Until { (Read-Field 'S1 a') -eq '2.4' } 'Rust-derived 3-4-5 fillet throat applied to the weld'
    if (-not (Find-Name 'S1 a' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly) { throw 'Derived width is editable without explicitly leaving the section model' }
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'section model reaches real Rust case calculations'
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'section provenance and results stored in SQLite'
    Save-Preview 'windows-fillet-section-smoke.png'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Section application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'section project process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after section restart'
    Open-LatestRevision
    Activate-Tree 'Шов S1'
    if ((Read-Field 'S1 a') -ne '2.4') { throw 'Derived section width did not survive a process restart' }
    Click-Name 'Модель сечения'
    if ((Read-Field 'Катет k₁, mm') -ne '3' -or (Read-Field 'Катет k₂, mm') -ne '4') { throw 'Section source legs were lost' }
    Click-Name 'Задать ширину вручную'
    $null = Wait-Until { -not (Find-Name 'S1 a' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly } 'explicit manual mode re-enables width input'
    Click-Name 'Отменить'
    $null = Wait-Until { (Find-Name 'S1 a' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly } 'Undo restores section provenance'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Section mode Undo did not restore the saved project and casebook' }
    Activate-Tree 'Сила F1'
    Click-Name 'Нагрузка от массы'
    Set-Field 'Масса, kg' '10'; Set-Field 'gravity_m_s2 z' '-10'; Set-Field 'acceleration_m_s2 x' '2'
    Click-Name 'Рассчитать и применить силу'
    $null = Wait-Until { (Read-Field 'force_n x') -eq '-20' -and (Read-Field 'force_n z') -eq '-100' } 'mass and acceleration reach real Rust force derivation'
    if (-not (Find-Name 'force_n x' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly) { throw 'Mass-derived force permits contradictory manual editing' }
    Click-Name 'Рассчитать все'
    $null = Wait-Until { Find-Name 'Сводка случаев · 2/2 — Все случаи рассчитаны' } 'mass force and other simultaneous force reach both cases'
    Click-Name 'Сохранить ревизию'
    $null = Wait-Until { Find-Name 'Ревизия сохранена' } 'mass source saved to SQLite'
    Save-Preview 'windows-mass-load-smoke.png'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Mass application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'mass project process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after mass restart'
    Open-LatestRevision
    Activate-Tree 'Сила F1'
    if ((Read-Field 'force_n x') -ne '-20' -or (Read-Field 'force_n z') -ne '-100') { throw 'Mass force lost on restart' }
    Click-Name 'Нагрузка от массы'
    if ((Read-Field 'Масса, kg') -ne '10' -or (Read-Field 'acceleration_m_s2 x') -ne '2') { throw 'Mass source lost on restart' }
    Click-Name 'Задать силу вручную'
    $null = Wait-Until { -not (Find-Name 'force_n x' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly } 'explicit manual force mode'
    Click-Name 'Отменить'
    $null = Wait-Until { (Find-Name 'force_n x' ([System.Windows.Automation.ControlType]::Edit)).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly } 'Undo restores mass provenance'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Mass manual-mode Undo did not restore saved results' }
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-mass-report-smoke.pdf'))
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



    Click-Name 'Сочетание нагрузок'
    $null=Wait-Until { Find-Name 'Название сочетания' ([System.Windows.Automation.ControlType]::Edit) } 'combination dialog opens'
    $null=[WeldDesktopInput]::PostMessage([IntPtr]$script:window.Current.NativeWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    $null=Wait-Until { -not (Find-Name 'Название сочетания' ([System.Windows.Automation.ControlType]::Edit)) } 'native close cancels combination dialog without closing the project'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Cancelling combination changed the saved project' }
    Click-Name 'Сочетание нагрузок'
    Set-Field 'Коэффициент LC1' '1.25'; Set-Field 'Коэффициент LC2' '-0.5'
    Click-Name 'Создать сочетание'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '750' } 'Rust materializes the first factored source force'
    $null=Wait-Until { Find-Name 'Снимок пользовательского сочетания. Изменение нагрузок превратит его в обычный случай; Undo восстановит сочетание. Исходные случаи и коэффициенты перечислены в отчёте.' } 'combination provenance visible'
    Click-Name 'Отменить'
    if ((Read-Field 'force_n x') -ne '-20' -or (Find-Name 'Есть несохранённые изменения')) { throw 'Combination Undo did not restore the complete saved mass project' }
    Click-Name 'Повторить'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '750' } 'Redo restores materialized source loads'
    Click-Name 'Рассчитать все'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'all original cases and explicit combination calculate'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'combination audit trail saved to SQLite'
    Save-Preview 'windows-combination-smoke.png'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Combination application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'combination project process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after combination restart'
    Open-LatestRevision
    Activate-Tree 'Нагрузки'
    if ((Read-Field 'force_n z') -ne '750') { throw 'Combined force did not survive restart' }
    Set-Field 'force_n z' '751'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '751' -and -not (Find-Name 'Снимок пользовательского сочетания. Изменение нагрузок превратит его в обычный случай; Undo восстановит сочетание. Исходные случаи и коэффициенты перечислены в отчёте.') -and (Find-Name 'Есть несохранённые изменения') } 'manual edit commits the new force, clears provenance and invalidates the saved calculation'
    Click-Name 'Отменить'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '750' -and (Find-Name 'Снимок пользовательского сочетания. Изменение нагрузок превратит его в обычный случай; Undo восстановит сочетание. Исходные случаи и коэффициенты перечислены в отчёте.') -and -not (Find-Name 'Есть несохранённые изменения') } 'Undo restores the force, combination provenance and complete saved snapshot'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-combination-report-smoke.pdf'))
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
    Click-Name 'Коэффициенты сочетания'
    if ((Read-Field 'Коэффициент LC1') -ne '1.25' -or (Read-Field 'Коэффициент LC2') -ne '-0.5') { throw 'Coefficient editor did not restore saved factors' }
    Set-Field 'Коэффициент LC1' '2'; Set-Field 'Коэффициент LC2' '-0.25'
    Click-Name 'Применить коэффициенты'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '1200' -and (Find-Name 'Есть несохранённые изменения') } 'edit replaces existing combination loads'
    Click-Name 'Отменить'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '750' -and -not (Find-Name 'Есть несохранённые изменения') } 'one Undo restores original saved factors and results'
    Click-Name 'Повторить'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '1200' -and (Find-Name 'Есть несохранённые изменения') } 'Redo restores edited combination'
    Click-Name 'Рассчитать все'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'coefficient edit keeps three cases instead of appending a fourth'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'edited combination saved to SQLite'
    Save-Preview 'windows-combination-edit-smoke.png'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Edited combination application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'edited combination process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after coefficient edit restart'
    Open-LatestRevision
    Activate-Tree 'Нагрузки'
    if ((Read-Field 'force_n z') -ne '1200') { throw 'Edited load did not survive restart' }
    Click-Name 'Коэффициенты сочетания'
    if ((Read-Field 'Коэффициент LC1') -ne '2' -or (Read-Field 'Коэффициент LC2') -ne '-0.25') { throw 'Edited factors did not survive restart' }
    Click-Name 'Отмена'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-combination-edit-report-smoke.pdf'))
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
    Click-Name 'Материалы проекта'
    Set-Field 'Расчётная толщина, mm' '10'; Set-Field 'Температура, °C' '20'
    Click-Name 'Задать карточку Основной металл'
    Set-Field 'Основной металл · Обозначение' 'Synthetic base'
    Click-Name 'Добавить свойство Основной металл'
    Set-Field 'Основной металл · 1 · Значение' '300'
    Set-Field 'Основной металл · 1 · thickness_mm 1' '20'
    Set-Field 'Основной металл · 1 · temperature_c 0' '20'; Set-Field 'Основной металл · 1 · temperature_c 1' '20'
    Set-Field 'Основной металл · 1 · Источник свойства' 'User record M-001'
    Click-Name 'Проверить применимость'
    $null=Wait-Until { $button=Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button);$button -and $button.Current.IsEnabled } 'Rust validates custom material applicability'
    $null=Wait-Until { Find-Name 'Неизвестно' ([System.Windows.Automation.ControlType]::Text) } 'missing weld material remains explicitly unknown'
    Click-Name 'Применить материалы'
    $null=Wait-Until { -not (Find-Name 'Проверить применимость' ([System.Windows.Automation.ControlType]::Button)) -and (Find-Name 'Есть несохранённые изменения') } 'material assignment commits as one project edit'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'nominal results do not depend on custom property metadata'
    Click-Name 'Отменить'
    $null=Wait-Until { -not (Find-Name 'Есть несохранённые изменения') } 'one Undo restores original material-free project'
    Click-Name 'Повторить'
    $null=Wait-Until { Find-Name 'Есть несохранённые изменения' } 'Redo restores custom material cards'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'material cards saved to SQLite'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Material application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'material process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after material restart'
    Open-LatestRevision
    Click-Name 'Материалы проекта'
    if ((Read-Field 'Расчётная толщина, mm') -ne '10' -or (Read-Field 'Основной металл · 1 · Значение') -ne '300' -or (Read-Field 'Основной металл · 1 · Источник свойства') -ne 'User record M-001') { throw 'Material cards or applicability context lost after restart' }
    Click-Name 'Проверить применимость'
    $null=Wait-Until { (Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'persisted source still resolves through Rust'
    Set-Field 'Расчётная толщина, mm' '21'
    $null=Wait-Until { (Read-Field 'Расчётная толщина, mm') -eq '21' -and -not (Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'context edit invalidates the previous applicability result'
    Click-Name 'Проверить применимость'
    $null=Wait-Until { (Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'out-of-range properties return explicit unknown instead of extrapolation'
    Save-Preview 'windows-materials-smoke.png'
    Click-Name 'Применить материалы'
    $null=Wait-Until { -not (Find-Name 'Проверить применимость' ([System.Windows.Automation.ControlType]::Button)) -and (Find-Name 'Есть несохранённые изменения') } 'new material context committed'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'custom material context change preserves all nominal case snapshots'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'out-of-domain context saved without fabricating values'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-material-report-smoke.pdf'))
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
    Click-Name 'Пользовательские пределы'
    Set-Field 'Растяжение, MPa' '10'; Set-Field 'Сжатие, MPa' '20'; Set-Field 'Срез, MPa' '5'
    Set-Field 'Растяжение · Источник предела' 'User T-001'; Set-Field 'Сжатие · Источник предела' 'User C-001'; Set-Field 'Срез · Источник предела' 'User S-001'
    Click-Name 'Применить пределы'
    $null=Wait-Until { Find-Name 'Контроль пользовательских пределов · 3/3 — Пользовательские пределы превышены' } 'Rust compares all cached nominal cases against explicit user thresholds'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'threshold metadata stored without recalculating mechanics'
    Activate-Tree 'Нагрузки'
    Set-Field 'force_n z' '1201'
    $null=Wait-Until { Find-Name 'Контроль пользовательских пределов · 2/3 — Контроль неполон' } 'invalidated active case cannot disappear into a complete comparison'
    Click-Name 'Отменить'
    $null=Wait-Until { (Read-Field 'force_n z') -eq '1200' -and -not (Find-Name 'Есть несохранённые изменения') -and (Find-Name 'Контроль пользовательских пределов · 3/3 — Пользовательские пределы превышены') } 'Undo restores the original calculation and complete threshold comparison'
    Click-Name 'Пользовательские пределы'
    Set-Field 'Растяжение, MPa' '1000000'; Set-Field 'Сжатие, MPa' '1000000'; Set-Field 'Срез, MPa' '1000000'
    Click-Name 'Применить пределы'
    $null=Wait-Until { Find-Name 'Контроль пользовательских пределов · 3/3 — В пределах пользовательских значений' } 'new thresholds update comparison without implying normative strength'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'revised user thresholds persisted'
    Click-Name 'Контроль пользовательских пределов · 3/3 — В пределах пользовательских значений'
    Save-Preview 'windows-user-limits-smoke.png'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'User limits application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'user limits process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after user limits restart'
    Open-LatestRevision
    $null=Wait-Until { Find-Name 'Контроль пользовательских пределов · 3/3 — В пределах пользовательских значений' } 'comparison recalculated from persisted limits and cached snapshots after restart'
    Click-Name 'Пользовательские пределы'
    if ((Read-Field 'Растяжение, MPa') -ne '1000000' -or (Read-Field 'Сжатие · Источник предела') -ne 'User C-001') { throw 'Threshold value or source lost after restart' }
    Click-Name 'Отмена'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-user-limits-report-smoke.pdf'))
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
    Click-Name 'Варианты размеров швов'
    Click-Name 'Добавить вариант'
    Set-Field 'Масштаб ширины 2' '2'
    Click-Name 'Добавить вариант'
    Set-Field 'Масштаб ширины 3' '1e308'
    Click-Name 'Рассчитать варианты'
    $null=Wait-Until { Find-Name 'Результаты вариантов размеров' ([System.Windows.Automation.ControlType]::Table) } 'all width candidates returned, including numerical failure'
    $failed=Find-Name 'Выбрать вариант 3' ([System.Windows.Automation.ControlType]::RadioButton)
    if (-not $failed -or $failed.Current.IsEnabled) { throw 'Failed width candidate can be selected' }
    if ((Find-Name 'Применить выбранный размер' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled) { throw 'Width study automatically selected a candidate' }
    $choice=Find-Name 'Выбрать вариант 2' ([System.Windows.Automation.ControlType]::RadioButton)
    $choice.SetFocus();Key-Press 0x20
    $null=Wait-Until { (Find-Name 'Применить выбранный размер' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'explicit width candidate selected'
    Save-Preview 'windows-width-study-smoke.png'
    Click-Name 'Отчёт вариантов PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-width-study-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Click-Name 'Применить выбранный размер'
    $null=Wait-Until { -not (Find-Name 'Рассчитать варианты' ([System.Windows.Automation.ControlType]::Button)) } 'width candidate committed and dialog closed'
    Activate-Tree 'Шов S1'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '4.8' -and (Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны') } 'scaled throat with every original case and combination recalculated'
    Click-Name 'Отменить'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '2.4' -and -not (Find-Name 'Есть несохранённые изменения') } 'one Undo restores the entire source project and all cached results'
    Click-Name 'Повторить'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '4.8' -and (Find-Name 'Есть несохранённые изменения') } 'Redo restores selected width study candidate'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'scaled fillet section and all case results persisted'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Width study application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'width study process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after width study restart'
    Open-LatestRevision
    Activate-Tree 'Шов S1'
    if ((Read-Field 'S1 a') -ne '4.8') { throw 'Selected width did not survive process restart' }
    Click-Name 'Модель сечения'
    if ((Read-Field 'Катет k₁, mm') -ne '6' -or (Read-Field 'Катет k₂, mm') -ne '8') { throw 'Scaled fillet legs did not survive process restart' }
    Click-Name 'Модель сечения'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'reloaded width study candidate retains all results'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-width-applied-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Write-Output 'PASS: width study recalculates all cases, retains failed rows, requires explicit selection, scales source fillet legs, supports one Undo/Redo and survives SQLite/process restart with independent study/applied PDF evidence.'
    Click-Name 'Объём и масса швов'
    $null=Wait-Until { Find-Name 'Объём и масса швов' ([System.Windows.Automation.ControlType]::Table) } 'partial triangular quantities with one unknown manual section'
    $null=Wait-Until { Find-Name 'Неизвестно' ([System.Windows.Automation.ControlType]::Text) } 'partial volume and missing weld density stay unknown'
    Activate-Tree 'Шов S2'
    Click-Name 'Модель сечения'
    Set-Field 'Катет k₁, mm' '6';Set-Field 'Катет k₂, mm' '8'
    Click-Name 'Рассчитать и применить сечение'
    $null=Wait-Until { (Read-Field 'S2 a') -eq '4.8' } 'second explicit triangular section enables complete geometric volume'
    Click-Name 'Материалы проекта'
    Click-Name 'Задать карточку Наплавленный металл'
    Set-Field 'Наплавленный металл · Обозначение' 'Synthetic weld'
    Click-Name 'Добавить свойство Наплавленный металл'
    (Find-Name 'Наплавленный металл · 1 · Свойство' ([System.Windows.Automation.ControlType]::ComboBox)).SetFocus();Key-Press 0x23;Key-Press 0x09
    Set-Field 'Наплавленный металл · 1 · Значение' '8000'
    Set-Field 'Наплавленный металл · 1 · thickness_mm 1' '100'
    Set-Field 'Наплавленный металл · 1 · temperature_c 0' '20';Set-Field 'Наплавленный металл · 1 · temperature_c 1' '20'
    Set-Field 'Наплавленный металл · 1 · Источник свойства' 'User density Q-001'
    Click-Name 'Проверить применимость'
    $null=Wait-Until { (Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'explicit weld density validated for the common material context'
    Click-Name 'Применить материалы'
    $null=Wait-Until { Find-Name '0.0384' ([System.Windows.Automation.ControlType]::Text) } '4800 cubic mm times 8000 kg per cubic metre gives 0.0384 kg'
    Click-Name 'Рассчитать все'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'quantity and section editing leave every nominal case calculable'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'complete section geometry and explicit weld density saved'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Quantity application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'quantity process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after quantity restart'
    Open-LatestRevision
    Click-Name 'Объём и масса швов'
    $null=Wait-Until { Find-Name '0.0384' ([System.Windows.Automation.ControlType]::Text) } 'geometric mass recomputed from persisted sections and density after full restart'
    (Find-Name 'Объём и масса швов' ([System.Windows.Automation.ControlType]::Table)).SetFocus()
    Save-Preview 'windows-quantities-smoke.png'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-quantities-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Click-Name 'Материалы проекта'
    Set-Field 'Температура, °C' '21'
    Click-Name 'Проверить применимость'
    $null=Wait-Until { (Find-Name 'Применить материалы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'out-of-domain density remains a valid unknown material query'
    Click-Name 'Применить материалы'
    $null=Wait-Until { (Find-Name 'Объём и масса швов' ([System.Windows.Automation.ControlType]::Table)) -and -not (Find-Name '0.0384' ([System.Windows.Automation.ControlType]::Text)) -and (Find-Name 'Неизвестно' ([System.Windows.Automation.ControlType]::Text)) } 'out-of-domain density removes total mass without changing complete volume or nominal results'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'density applicability change preserves every nominal result'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-quantities-unknown-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Click-Name 'Отменить'
    $null=Wait-Until { Find-Name '0.0384' ([System.Windows.Automation.ControlType]::Text) } 'one Undo restores applicable density and mass'
    if (Find-Name 'Есть несохранённые изменения') { throw 'Quantity context Undo did not restore saved project' }
    Write-Output 'PASS: explicit triangular volume and weld-density mass, partial/unknown results, 4800 mm3 and 0.0384 kg, SQLite/process restart, out-of-domain density, one Undo and separate complete/unknown PDF evidence.'
    Click-Name 'Пользовательские пределы'
    Set-Field 'Растяжение, MPa' '20';Set-Field 'Сжатие, MPa' '20';Set-Field 'Срез, MPa' '100'
    Click-Name 'Применить пределы'
    $null=Wait-Until { Find-Name 'Контроль пользовательских пределов · 3/3 — В пределах пользовательских значений' } 'explicit sizing thresholds retain all nominal source snapshots'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'sizing source and explicit thresholds saved'
    Click-Name 'Варианты размеров швов'
    (Find-Name 'Цель отбора' ([System.Windows.Automation.ControlType]::ComboBox)).SetFocus();Key-Press 0x23;Key-Press 0x09
    Set-Field 'Масштаб ширины 1' '2'
    Click-Name 'Добавить вариант';Set-Field 'Масштаб ширины 2' '0.5'
    Click-Name 'Добавить вариант';Set-Field 'Масштаб ширины 3' '1.5'
    Click-Name 'Добавить вариант';Set-Field 'Масштаб ширины 4' '1e308'
    Click-Name 'Рассчитать варианты'
    $null=Wait-Until { Find-Name 'Отбор неполон' ([System.Windows.Automation.ControlType]::Text) } 'a failed candidate prevents claiming a minimum among supplied factors'
    if ((Find-Name 'Выбрать минимум из таблицы' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled) { throw 'Incomplete sizing table can select a purported minimum' }
    Click-Name 'Отчёт вариантов PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-discrete-incomplete-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Click-Name 'Удалить Масштаб ширины 4'
    Click-Name 'Рассчитать варианты'
    $null=Wait-Until { Find-Name 'Минимум среди заданных вариантов' ([System.Windows.Automation.ControlType]::Text) } 'all known candidate objectives and user thresholds yield a discrete minimum'
    if ((Find-Name 'Применить выбранный размер' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled) { throw 'Backend sizing recommendation silently selected a geometry edit' }
    Click-Name 'Выбрать минимум из таблицы'
    $null=Wait-Until { (Find-Name 'Применить выбранный размер' ([System.Windows.Automation.ControlType]::Button)).Current.IsEnabled } 'explicit choice of backend minimum enables manual apply'
    Save-Preview 'windows-discrete-sizing-smoke.png'
    Click-Name 'Отчёт вариантов PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-discrete-sizing-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Click-Name 'Применить выбранный размер'
    $null=Wait-Until { -not (Find-Name 'Рассчитать варианты' ([System.Windows.Automation.ControlType]::Button)) } 'discrete sizing manually applied'
    Activate-Tree 'Шов S1'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '7.2' -and (Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны') } 'factor 1.5 applied with every load case freshly recalculated'
    Click-Name 'Отменить'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '4.8' -and -not (Find-Name 'Есть несохранённые изменения') } 'one Undo restores complete sizing source project'
    Click-Name 'Повторить'
    $null=Wait-Until { (Read-Field 'S1 a') -eq '7.2' -and (Find-Name 'Есть несохранённые изменения') } 'Redo restores chosen discrete candidate'
    Click-Name 'Сохранить ревизию'
    $null=Wait-Until { Find-Name 'Ревизия сохранена' } 'chosen discrete candidate persisted'
    $handle = [IntPtr]$script:window.Current.NativeWindowHandle
    $null = [WeldDesktopInput]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(10000)) { throw 'Discrete sizing application did not close cleanly' }
    $process = Start-Process -FilePath $executable -PassThru
    $script:window = Wait-Until {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    } 'discrete sizing process restart'
    $null = Wait-Until { $control=Find-Name 'Настройки приложения' ([System.Windows.Automation.ControlType]::Button);$control -and $control.Current.IsEnabled } 'settings loaded after discrete sizing restart'
    Open-LatestRevision
    Activate-Tree 'Шов S1'
    if ((Read-Field 'S1 a') -ne '7.2') { throw 'Discrete sizing choice lost after restart' }
    Click-Name 'Модель сечения'
    if ((Read-Field 'Катет k₁, mm') -ne '9' -or (Read-Field 'Катет k₂, mm') -ne '12') { throw 'Discrete sizing source legs lost after restart' }
    Click-Name 'Модель сечения'
    $null=Wait-Until { Find-Name 'Сводка случаев · 3/3 — Все случаи рассчитаны' } 'discrete sizing cached results survive restart'
    Click-Name 'Отчёт PDF'
    $dialog = Wait-Until {
        [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Weld Engineering — PDF'))
    } 'native PDF save dialog'
    $filename = Focus-PdfFilename $dialog
    $reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../target/weld-discrete-applied-report-smoke.pdf'))
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
        foreach ($text in $texts) { if ($text.Current.Name -eq ($pdfPrefix+$reportPath)) { return $text.Current.Name } }
        return $null
    } 'PDF generated and written by native adapter'
    $actualPath = $pdfStatus.Substring($pdfPrefix.Length)
    Write-Output "Synthetic report saved at: $actualPath"
    if (-not [string]::Equals($actualPath, $reportPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Native save chose '$actualPath' instead of '$reportPath'" }
    $reportBytes = [System.IO.File]::ReadAllBytes($reportPath)
    if ($reportBytes.Length -lt 1000 -or [System.Text.Encoding]::ASCII.GetString($reportBytes, 0, 5) -ne '%PDF-') { throw 'Invalid PDF report output' }
    Write-Output 'PASS: discrete minimum mass under explicit user thresholds, unknown candidate blocks selection, exclusions retained, explicit selection/manual apply, factor 1.5, one Undo/Redo, SQLite restart and independent sizing/incomplete/applied PDF evidence.'
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

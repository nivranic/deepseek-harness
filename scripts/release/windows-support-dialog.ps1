<#
.SYNOPSIS
Operate only the specified candidate process's real Windows support save dialog on a disposable runner.
#>
param(
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$CandidateProcessId,
    [Parameter(Mandatory)][ValidateSet('save', 'cancel', 'observe', 'absent')][string]$Action,
    [string]$Destination,
    [string]$ExpectedFileName = 'deepseek-harness-diagnostics.json',
    [ValidateRange(100, 60000)][int]$TimeoutMilliseconds = 30000
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') {
    throw 'Native dialog interaction requires a disposable GitHub-hosted Windows runner'
}
$phaseClock = [System.Diagnostics.Stopwatch]::StartNew()
function Write-SupportPhase {
    param([ValidateSet('initialize', 'find-dialog', 'query-values', 'read-patterns', 'filename-selected', 'write-value', 'read-value', 'native-command', 'wait-closed')][string]$Phase)
    [Console]::Error.WriteLine((@{ schemaVersion = 1; scope = 'candidate-support-driver'; phase = $Phase; elapsedMilliseconds = $phaseClock.ElapsedMilliseconds } | ConvertTo-Json -Compress))
}
Write-SupportPhase -Phase 'initialize'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DshSupportDialogNative {
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsChild(IntPtr parent, IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    // PowerShell converts null string arguments to empty strings; native wildcard arguments must remain null.
    public static IntPtr FindChildWindow(IntPtr parent, IntPtr after) { return FindWindowEx(parent, after, null, null); }
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter, IntPtr data, uint flags, uint milliseconds, out UIntPtr result);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowStyle(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr ReadWindowText(IntPtr window, uint message, UIntPtr parameter, StringBuilder data, uint flags, uint milliseconds, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr WriteWindowText(IntPtr window, uint message, UIntPtr parameter, string data, uint flags, uint milliseconds, out UIntPtr result);
}
'@
$scope = [System.Windows.Automation.TreeScope]
$element = [System.Windows.Automation.AutomationElement]
$script:dialogHandle = [IntPtr]::Zero
function Find-SupportDialog {
    $selected = @()
    foreach ($title in @('Export diagnostics', '导出诊断信息')) {
        $previous = [IntPtr]::Zero
        while ($true) {
            $window = [DshSupportDialogNative]::FindWindowEx([IntPtr]::Zero, $previous, '#32770', $title)
            if ($window -eq [IntPtr]::Zero) { break }
            $previous = $window
            [uint32]$owner = 0
            $null = [DshSupportDialogNative]::GetWindowThreadProcessId($window, [ref]$owner)
            if ($owner -eq $CandidateProcessId) { $selected += $window }
        }
    }
    if ($selected.Count -gt 1) { throw 'Candidate has multiple support save dialogs' }
    $script:dialogHandle = [IntPtr]::Zero
    if ($selected.Count -eq 1) {
        $script:dialogHandle = $selected[0]
        return $script:dialogHandle
    }
    return $null
}
function Wait-SupportElement {
    param([scriptblock]$Probe, [System.Diagnostics.Stopwatch]$Clock, [int]$TimeoutMilliseconds, [string]$Failure)
    while ($Clock.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $found = & $Probe
        if ($null -ne $found) { return $found }
        Start-Sleep -Milliseconds 100
    }
    throw $Failure
}
function Test-SupportControlCaption {
    param([ValidateSet('filename', 'save', 'cancel')][string]$Role, [string]$Name)
    switch ($Role) {
        'filename' { return @('File name:', 'File name', '文件名(N):', '文件名:', '文件名：') -ccontains $Name }
        'save' { return @('Save', '保存(S)', '保存') -ccontains $Name }
        'cancel' { return @('Cancel', '取消') -ccontains $Name }
    }
}
function Test-SupportDefaultFilename {
    param([string]$Value, [string]$Expected)
    $stem = [IO.Path]::GetFileNameWithoutExtension($Expected)
    return $Value -ceq $Expected -or ($stem.Length -gt 0 -and $stem -cne $Expected -and $Value -ceq $stem)
}
function Find-SupportFilename {
    param([string]$Expected, [object[]]$Controls)
    $selected = @($Controls | Where-Object {
        $_.Visible -and $_.Enabled -and -not $_.ReadOnly -and (Test-SupportDefaultFilename -Value $_.Value -Expected $Expected)
    })
    if ($selected.Count -gt 1) { throw 'Candidate has multiple matching native support controls' }
    if ($selected.Count -eq 1) { return $selected[0] }
    return $null
}
function Get-SupportRemainingWait {
    $remaining = $TimeoutMilliseconds - $clock.ElapsedMilliseconds
    if ($remaining -le 0) { throw 'Candidate support dialog command exhausted its deadline' }
    return [uint32]$remaining
}
function Find-SupportButton {
    param([ValidateSet(1, 2)][int]$Command)
    $window = [DshSupportDialogNative]::GetDlgItem($script:dialogHandle, $Command)
    if ($window -eq [IntPtr]::Zero) { return $null }
    [uint32]$owner = 0
    $null = [DshSupportDialogNative]::GetWindowThreadProcessId($window, [ref]$owner)
    $native = Get-SupportNativeControlDiagnostic -WindowHandle $window -DialogHandle $script:dialogHandle
    if ($owner -ne $CandidateProcessId -or -not $native.dialogDescendant -or $native.kind -cne 'button' -or $native.id -ne $Command) {
        throw 'Candidate native dialog button ownership differs'
    }
    if (-not [DshSupportDialogNative]::IsWindowVisible($window) -or -not [DshSupportDialogNative]::IsWindowEnabled($window)) { return $null }
    return $window
}
function Read-SupportNativeText {
    param([IntPtr]$Window)
    $buffer = [Text.StringBuilder]::new(32768)
    [UIntPtr]$length = [UIntPtr]::Zero
    $sent = [DshSupportDialogNative]::ReadWindowText($Window, 0x000D, [UIntPtr]::new([uint32]$buffer.Capacity), $buffer, 0x0002, (Get-SupportRemainingWait), [ref]$length)
    if ($sent -eq [IntPtr]::Zero) { throw 'Candidate native filename text could not be read' }
    if ($length.ToUInt64() -ge [uint64]($buffer.Capacity - 1)) { throw 'Candidate native filename text exceeded its buffer' }
    return $buffer.ToString()
}
function Get-SupportNativeEdits {
    Write-SupportPhase -Phase 'query-values'
    $parents = [Collections.Generic.Queue[IntPtr]]::new()
    $parents.Enqueue($script:dialogHandle)
    $scanned = 0
    $controls = @()
    while ($parents.Count -ne 0) {
        $parent = $parents.Dequeue()
        $previous = [IntPtr]::Zero
        while ($true) {
            $null = Get-SupportRemainingWait
            $window = [DshSupportDialogNative]::FindChildWindow($parent, $previous)
            if ($window -eq [IntPtr]::Zero) { break }
            $previous = $window
            $scanned++
            if ($scanned -gt 512) { throw 'Candidate native dialog has too many child windows' }
            [uint32]$owner = 0
            $null = [DshSupportDialogNative]::GetWindowThreadProcessId($window, [ref]$owner)
            if ($owner -ne $CandidateProcessId -or -not [DshSupportDialogNative]::IsChild($script:dialogHandle, $window)) {
                throw 'Candidate native dialog child ownership differs'
            }
            $parents.Enqueue($window)
            $native = Get-SupportNativeControlDiagnostic -WindowHandle $window -DialogHandle $script:dialogHandle
            if ($native.kind -cne 'edit') { continue }
            $controls += [pscustomobject]@{
                Window = $window
                Native = $native
                Visible = [DshSupportDialogNative]::IsWindowVisible($window)
                Enabled = [DshSupportDialogNative]::IsWindowEnabled($window)
                ReadOnly = ([DshSupportDialogNative]::GetWindowStyle($window, -16) -band 0x0800) -ne 0
                Value = Read-SupportNativeText -Window $window
            }
        }
    }
    $script:lastNativeEdits = $controls
    return $controls
}
function Get-SupportNativeControlDiagnostic {
    param([IntPtr]$WindowHandle, [IntPtr]$DialogHandle)
    $record = @{ handlePresent = $WindowHandle -ne 0; dialogDescendant = $false; id = -1; parentId = -1; kind = 'other' }
    if ($WindowHandle -eq 0 -or $DialogHandle -eq [IntPtr]::Zero) { return $record }
    $window = $WindowHandle
    $record.dialogDescendant = [DshSupportDialogNative]::IsChild($DialogHandle, $window)
    if (-not $record.dialogDescendant) { return $record }
    $record.id = [DshSupportDialogNative]::GetDlgCtrlID($window)
    $record.parentId = [DshSupportDialogNative]::GetDlgCtrlID([DshSupportDialogNative]::GetParent($window))
    $name = [System.Text.StringBuilder]::new(256)
    $length = [DshSupportDialogNative]::GetClassName($window, $name, $name.Capacity)
    if ($length -gt 0) {
        $record.kind = switch -CaseSensitive ($name.ToString()) { 'Edit' { 'edit' } 'Button' { 'button' } 'ComboBox' { 'combo-box' } 'ComboBoxEx32' { 'combo-box-host' } default { 'other' } }
    }
    return $record
}
function ConvertTo-SupportControlDiagnostic {
    param([string]$AutomationId, [int]$ControlType, [bool]$Enabled, [bool]$Offscreen, [bool]$ValuePattern, [bool]$InvokePattern, [string]$Name, [hashtable]$Native, [Nullable[bool]]$DefaultFilenameMatch, [hashtable]$ValueObservation)
    $id = if ($AutomationId -cmatch '\A[0-9]{1,5}\z' -or $AutomationId -cin @('FileNameControlHost', 'FileNameTextBox')) { $AutomationId } else { '<other>' }
    $kind = switch ($ControlType) { 50000 { 'button' } 50003 { 'combo-box' } 50004 { 'edit' } default { 'other' } }
    $typeId = if ($ControlType -ge 50000 -and $ControlType -le 50040) { $ControlType } else { 0 }
    $captionRole = 'other'
    $normalizedCaptionRole = 'other'
    foreach ($role in @('filename', 'save', 'cancel')) {
        if (Test-SupportControlCaption -Role $role -Name $Name) { $captionRole = $role }
        if (Test-SupportControlCaption -Role $role -Name $Name.Trim().Replace('&', '')) { $normalizedCaptionRole = $role }
    }
    return @{ id = $id; idPresent = -not [string]::IsNullOrEmpty($AutomationId); kind = $kind; controlTypeId = $typeId; defaultFilenameMatch = $DefaultFilenameMatch; valueObservation = $ValueObservation; captionRole = $captionRole; normalizedCaptionRole = $normalizedCaptionRole; namePresent = -not [string]::IsNullOrEmpty($Name); native = $Native; enabled = $Enabled; offscreen = $Offscreen; valuePattern = $ValuePattern; invokePattern = $InvokePattern }
}
function ConvertTo-SupportValueDiagnostic {
    param([object]$Availability, [object]$Pattern, [object]$Value, [object]$ReadOnly, [string]$Expected)
    $state = if ($null -eq $Value) { 'null' }
        elseif ($Value -isnot [string]) { 'non-string' }
        elseif ($Value.Length -eq 0) { 'empty' }
        elseif ($Value -ceq $Expected) { 'expected' }
        elseif ($Value -ceq [IO.Path]::GetFileNameWithoutExtension($Expected)) { 'expected-stem' }
        elseif ([IO.Path]::GetFileName($Value) -ceq $Expected) { 'expected-leaf' }
        else { 'other' }
    return @{
        availabilityIsBoolean = $Availability -is [bool]
        patternIsValuePattern = $Pattern -is [System.Windows.Automation.ValuePattern]
        readOnly = if ($ReadOnly -is [bool]) { $ReadOnly } else { $null }
        state = $state
    }
}
function Write-SupportControlDiagnostic {
    $nativeRows = @($script:lastNativeEdits | ForEach-Object {
        @{ native = $_.Native; visible = $_.Visible; enabled = $_.Enabled; readOnly = $_.ReadOnly
           valueState = (ConvertTo-SupportValueDiagnostic -Value $_.Value -Expected $ExpectedFileName).state }
    })
    [Console]::Error.WriteLine((@{ schemaVersion = 1; scope = 'candidate-support-native-edits'; controls = $nativeRows } | ConvertTo-Json -Depth 5 -Compress))
    try {
        $interactive = [System.Windows.Automation.OrCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new($element::IsValuePatternAvailableProperty, $true),
            [System.Windows.Automation.PropertyCondition]::new($element::IsInvokePatternAvailableProperty, $true)
        )
        $uiaDialog = $element::FromHandle($script:dialogHandle)
        $controls = $uiaDialog.FindAll($scope::Descendants, $interactive)
        $rows = @()
        for ($index = 0; $index -lt [Math]::Min($controls.Count, 64); $index++) {
            $control = $controls[$index]
            $current = $control.Current
            $native = Get-SupportNativeControlDiagnostic -WindowHandle $current.NativeWindowHandle -DialogHandle $script:dialogHandle
            $availability = $control.GetCurrentPropertyValue($element::IsValuePatternAvailableProperty)
            $valueAvailable = $availability -eq $true
            $defaultMatch = $null
            $valueObservation = $null
            if ($valueAvailable) {
                $value = $control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $defaultMatch = $value.Current.Value -ceq $ExpectedFileName
                $valueObservation = ConvertTo-SupportValueDiagnostic -Availability $availability -Pattern $value -Value $value.Current.Value -ReadOnly $value.Current.IsReadOnly -Expected $ExpectedFileName
            }
            $rows += ConvertTo-SupportControlDiagnostic -AutomationId $current.AutomationId -ControlType $current.ControlType.Id -Name $current.Name `
                -Enabled $current.IsEnabled -Offscreen $current.IsOffscreen `
                -Native $native `
                -ValuePattern $valueAvailable -DefaultFilenameMatch $defaultMatch -ValueObservation $valueObservation `
                -InvokePattern ($control.GetCurrentPropertyValue($element::IsInvokePatternAvailableProperty) -eq $true)
        }
        $record = @{ schemaVersion = 1; scope = 'candidate-support-controls'; truncated = $controls.Count -gt 64; controls = $rows }
        [Console]::Error.WriteLine(($record | ConvertTo-Json -Depth 5 -Compress))
    } catch {
        [Console]::Error.WriteLine('{"schemaVersion":1,"scope":"candidate-support-controls","unavailable":true}')
    }
}
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:lastNativeEdits = @()
$nativeDialog = $null
Write-SupportPhase -Phase 'find-dialog'
do {
    $nativeDialog = Find-SupportDialog
    if ($Action -eq 'absent') {
        if ($null -ne $nativeDialog) { throw 'A refused export opened a native save dialog' }
    } elseif ($null -ne $nativeDialog) { break }
    Start-Sleep -Milliseconds 100
} while ($clock.ElapsedMilliseconds -lt $TimeoutMilliseconds)
if ($Action -eq 'absent') {
    @{ schemaVersion = 1; action = $Action; dialogObserved = $false; dialogClosed = $true } | ConvertTo-Json -Compress
    exit 0
}
if ($null -eq $nativeDialog) { throw 'Candidate support save dialog did not appear' }
[Console]::Error.WriteLine((@{ schemaVersion = 1; scope = 'candidate-support-window'; visible = [DshSupportDialogNative]::IsWindowVisible($script:dialogHandle); minimized = [DshSupportDialogNative]::IsIconic($script:dialogHandle) } | ConvertTo-Json -Compress))
if ($Action -eq 'observe') {
    @{ schemaVersion = 1; action = $Action; dialogObserved = $true; dialogClosed = $false } | ConvertTo-Json -Compress
    exit 0
}
if ($Action -eq 'save') {
    if ([string]::IsNullOrEmpty($Destination) -or -not [System.IO.Path]::IsPathFullyQualified($Destination)) {
        throw 'Saving requires an absolute test-owned destination'
    }
    if ([string]::IsNullOrEmpty($ExpectedFileName) -or [IO.Path]::GetFileName($ExpectedFileName) -cne $ExpectedFileName) {
        throw 'Saving requires the known default filename without a directory'
    }
    try {
        $filename = Wait-SupportElement -Clock $clock -TimeoutMilliseconds $TimeoutMilliseconds `
            -Probe { Find-SupportFilename -Expected $ExpectedFileName -Controls @(Get-SupportNativeEdits) } `
            -Failure 'Candidate save dialog has no ready writable filename value'
    } catch {
        Write-SupportControlDiagnostic
        throw
    }
    Write-SupportPhase -Phase 'filename-selected'
    [uint32]$filenameOwner = 0
    $null = [DshSupportDialogNative]::GetWindowThreadProcessId($filename.Window, [ref]$filenameOwner)
    if ($filenameOwner -ne $CandidateProcessId -or -not [DshSupportDialogNative]::IsChild($script:dialogHandle, $filename.Window)) {
        throw 'Candidate native filename ownership changed before writing'
    }
    if (-not (Test-SupportDefaultFilename -Value (Read-SupportNativeText -Window $filename.Window) -Expected $ExpectedFileName)) {
        throw 'Candidate native filename changed before writing'
    }
    Write-SupportPhase -Phase 'write-value'
    [UIntPtr]$writeResult = [UIntPtr]::Zero
    $written = [DshSupportDialogNative]::WriteWindowText($filename.Window, 0x000C, [UIntPtr]::Zero, $Destination, 0x0002, (Get-SupportRemainingWait), [ref]$writeResult)
    if ($written -eq [IntPtr]::Zero -or $writeResult -eq [UIntPtr]::Zero) { throw 'Candidate native filename write was refused' }
    Write-SupportPhase -Phase 'read-value'
    if ((Read-SupportNativeText -Window $filename.Window) -cne $Destination) { throw 'Native filename control did not accept the destination' }
}
$remaining = $TimeoutMilliseconds - $clock.ElapsedMilliseconds
if ($remaining -le 0) { throw 'Candidate support dialog command exhausted its deadline' }
[uint32]$owner = 0
$null = [DshSupportDialogNative]::GetWindowThreadProcessId($script:dialogHandle, [ref]$owner)
if ($owner -ne $CandidateProcessId) { throw 'Candidate support dialog owner changed before the native command' }
$command = if ($Action -ceq 'save') { 1 } else { 2 }
$button = Wait-SupportElement -Clock $clock -TimeoutMilliseconds $TimeoutMilliseconds `
    -Probe { Find-SupportButton -Command $command } -Failure 'Candidate native dialog button did not become ready'
[UIntPtr]$messageResult = [UIntPtr]::Zero
# BM_CLICK lets the actual button notify its owner and submit the common dialog's filename state.
Write-SupportPhase -Phase 'native-command'
$sent = [DshSupportDialogNative]::SendMessageTimeout($button, 0x00F5, [UIntPtr]::Zero, [IntPtr]::Zero, 0x0002, (Get-SupportRemainingWait), [ref]$messageResult)
if ($sent -eq [IntPtr]::Zero) { throw 'Candidate support dialog did not process its native command' }
Write-SupportPhase -Phase 'wait-closed'
while ($null -ne (Find-SupportDialog)) {
    if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) { throw 'Candidate support save dialog did not close' }
    Start-Sleep -Milliseconds 100
}
@{ schemaVersion = 1; action = $Action; dialogObserved = $true; dialogClosed = $true } | ConvertTo-Json -Compress

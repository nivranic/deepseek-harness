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
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DshSupportDialogNative {
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsChild(IntPtr parent, IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter, IntPtr data, uint flags, uint milliseconds, out UIntPtr result);
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
        return $element::FromHandle($script:dialogHandle)
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
function Find-SupportFilename {
    param([string]$Expected, [System.Windows.Automation.Condition]$Condition)
    $controls = $nativeDialog.FindAll($scope::Descendants, $Condition)
    $selected = @($controls | Where-Object {
        $pattern = $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        -not $pattern.Current.IsReadOnly -and $pattern.Current.Value -ceq $Expected
    })
    if ($selected.Count -gt 1) { throw 'Candidate has multiple matching native support controls' }
    if ($selected.Count -eq 1) { return $selected[0] }
    return $null
}
function Get-SupportNativeControlDiagnostic {
    param([int]$WindowHandle, [IntPtr]$DialogHandle)
    $record = @{ handlePresent = $WindowHandle -ne 0; dialogDescendant = $false; id = -1; parentId = -1; kind = 'other' }
    if ($WindowHandle -eq 0 -or $DialogHandle -eq [IntPtr]::Zero) { return $record }
    $window = [IntPtr]::new($WindowHandle)
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
    param([string]$AutomationId, [int]$ControlType, [bool]$Enabled, [bool]$Offscreen, [bool]$ValuePattern, [bool]$InvokePattern, [string]$Name, [hashtable]$Native)
    $id = if ($AutomationId -cmatch '\A[0-9]{1,5}\z' -or $AutomationId -cin @('FileNameControlHost', 'FileNameTextBox')) { $AutomationId } else { '<other>' }
    $kind = switch ($ControlType) { 50000 { 'button' } 50003 { 'combo-box' } 50004 { 'edit' } default { 'other' } }
    $captionRole = 'other'
    $normalizedCaptionRole = 'other'
    foreach ($role in @('filename', 'save', 'cancel')) {
        if (Test-SupportControlCaption -Role $role -Name $Name) { $captionRole = $role }
        if (Test-SupportControlCaption -Role $role -Name $Name.Trim().Replace('&', '')) { $normalizedCaptionRole = $role }
    }
    return @{ id = $id; idPresent = -not [string]::IsNullOrEmpty($AutomationId); kind = $kind; captionRole = $captionRole; normalizedCaptionRole = $normalizedCaptionRole; namePresent = -not [string]::IsNullOrEmpty($Name); native = $Native; enabled = $Enabled; offscreen = $Offscreen; valuePattern = $ValuePattern; invokePattern = $InvokePattern }
}
function Write-SupportControlDiagnostic {
    try {
        $interactive = [System.Windows.Automation.OrCondition]::new(
            [System.Windows.Automation.OrCondition]::new(
                [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit),
                [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::ComboBox)
            ),
            [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        )
        $controls = $nativeDialog.FindAll($scope::Descendants, $interactive)
        $rows = @()
        for ($index = 0; $index -lt [Math]::Min($controls.Count, 64); $index++) {
            $control = $controls[$index]
            $current = $control.Current
            $native = Get-SupportNativeControlDiagnostic -WindowHandle $current.NativeWindowHandle -DialogHandle $script:dialogHandle
            $rows += ConvertTo-SupportControlDiagnostic -AutomationId $current.AutomationId -ControlType $current.ControlType.Id -Name $current.Name `
                -Enabled $current.IsEnabled -Offscreen $current.IsOffscreen `
                -Native $native `
                -ValuePattern ($control.GetCurrentPropertyValue($element::IsValuePatternAvailableProperty) -eq $true) `
                -InvokePattern ($control.GetCurrentPropertyValue($element::IsInvokePatternAvailableProperty) -eq $true)
        }
        $record = @{ schemaVersion = 1; scope = 'candidate-support-controls'; truncated = $controls.Count -gt 64; controls = $rows }
        [Console]::Error.WriteLine(($record | ConvertTo-Json -Depth 5 -Compress))
    } catch {
        [Console]::Error.WriteLine('{"schemaVersion":1,"scope":"candidate-support-controls","unavailable":true}')
    }
}
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$nativeDialog = $null
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
    $filenameCondition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit),
            [System.Windows.Automation.PropertyCondition]::new($element::IsOffscreenProperty, $false)
        ),
        [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new($element::IsEnabledProperty, $true),
            [System.Windows.Automation.PropertyCondition]::new($element::IsValuePatternAvailableProperty, $true)
        )
    )
    try {
        $filename = Wait-SupportElement -Clock $clock -TimeoutMilliseconds $TimeoutMilliseconds `
            -Probe { Find-SupportFilename -Expected $ExpectedFileName -Condition $filenameCondition } `
            -Failure 'Candidate save dialog has no ready native filename edit control'
    } catch {
        Write-SupportControlDiagnostic
        throw
    }
    $value = [System.Windows.Automation.ValuePattern]$filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($Destination)
    if ($value.Current.Value -cne $Destination) { throw 'Native filename control did not accept the destination' }
}
$remaining = $TimeoutMilliseconds - $clock.ElapsedMilliseconds
if ($remaining -le 0) { throw 'Candidate support dialog command exhausted its deadline' }
[uint32]$owner = 0
$null = [DshSupportDialogNative]::GetWindowThreadProcessId($script:dialogHandle, [ref]$owner)
if ($owner -ne $CandidateProcessId) { throw 'Candidate support dialog owner changed before the native command' }
$command = if ($Action -ceq 'save') { 1 } else { 2 }
[UIntPtr]$messageResult = [UIntPtr]::Zero
# WM_COMMAND routes IDOK/IDCANCEL through the common dialog's own validation and result handling.
$sent = [DshSupportDialogNative]::SendMessageTimeout($script:dialogHandle, 0x0111, [UIntPtr]::new([uint32]$command), [IntPtr]::Zero, 0x0002, [uint32]$remaining, [ref]$messageResult)
if ($sent -eq [IntPtr]::Zero) { throw 'Candidate support dialog did not process its native command' }
while ($null -ne (Find-SupportDialog)) {
    if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) { throw 'Candidate support save dialog did not close' }
    Start-Sleep -Milliseconds 100
}
@{ schemaVersion = 1; action = $Action; dialogObserved = $true; dialogClosed = $true } | ConvertTo-Json -Compress

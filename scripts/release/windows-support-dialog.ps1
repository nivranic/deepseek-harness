<#
.SYNOPSIS
Operate only the specified candidate process's real Windows support save dialog on a disposable runner.
#>
param(
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$CandidateProcessId,
    [Parameter(Mandatory)][ValidateSet('save', 'cancel', 'observe', 'absent')][string]$Action,
    [string]$Destination,
    [ValidateRange(100, 60000)][int]$TimeoutMilliseconds = 30000
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') {
    throw 'Native dialog interaction requires a disposable GitHub-hosted Windows runner'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$scope = [System.Windows.Automation.TreeScope]
$element = [System.Windows.Automation.AutomationElement]
$condition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new($element::ProcessIdProperty, $CandidateProcessId),
    [System.Windows.Automation.PropertyCondition]::new($element::ClassNameProperty, '#32770')
)
function Find-SupportDialog {
    $matches = $element::RootElement.FindAll($scope::Children, $condition)
    $selected = @($matches | Where-Object { $_.Current.Name -ceq 'Export diagnostics' -or $_.Current.Name -ceq '导出诊断信息' })
    if ($selected.Count -gt 1) { throw 'Candidate has multiple support save dialogs' }
    if ($selected.Count -eq 1) { return $selected[0] }
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
function Find-SupportControl {
    param([string]$Role, [System.Windows.Automation.Condition]$Condition)
    $controls = $nativeDialog.FindAll($scope::Descendants, $Condition)
    $selected = @($controls | Where-Object { Test-SupportControlCaption -Role $Role -Name $_.Current.Name })
    if ($selected.Count -gt 1) { throw 'Candidate has multiple matching native support controls' }
    if ($selected.Count -eq 1) { return $selected[0] }
    return $null
}
function ConvertTo-SupportControlDiagnostic {
    param([string]$AutomationId, [int]$ControlType, [bool]$Enabled, [bool]$Offscreen, [bool]$ValuePattern, [bool]$InvokePattern, [string]$Name)
    $id = if ($AutomationId -cmatch '\A[0-9]{1,5}\z' -or $AutomationId -cin @('FileNameControlHost', 'FileNameTextBox')) { $AutomationId } else { '<other>' }
    $kind = switch ($ControlType) { 50000 { 'button' } 50003 { 'combo-box' } 50004 { 'edit' } default { 'other' } }
    $captionRole = 'other'
    foreach ($role in @('filename', 'save', 'cancel')) {
        if (Test-SupportControlCaption -Role $role -Name $Name) { $captionRole = $role; break }
    }
    return @{ id = $id; idPresent = -not [string]::IsNullOrEmpty($AutomationId); kind = $kind; captionRole = $captionRole; enabled = $Enabled; offscreen = $Offscreen; valuePattern = $ValuePattern; invokePattern = $InvokePattern }
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
            $rows += ConvertTo-SupportControlDiagnostic -AutomationId $current.AutomationId -ControlType $current.ControlType.Id -Name $current.Name `
                -Enabled $current.IsEnabled -Offscreen $current.IsOffscreen `
                -ValuePattern ($control.GetCurrentPropertyValue($element::IsValuePatternAvailableProperty) -eq $true) `
                -InvokePattern ($control.GetCurrentPropertyValue($element::IsInvokePatternAvailableProperty) -eq $true)
        }
        $record = @{ schemaVersion = 1; scope = 'candidate-support-controls'; truncated = $controls.Count -gt 64; controls = $rows }
        [Console]::Error.WriteLine(($record | ConvertTo-Json -Depth 4 -Compress))
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
            -Probe { Find-SupportControl -Role 'filename' -Condition $filenameCondition } `
            -Failure 'Candidate save dialog has no ready native filename edit control'
    } catch {
        Write-SupportControlDiagnostic
        throw
    }
    $value = [System.Windows.Automation.ValuePattern]$filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($Destination)
    if ($value.Current.Value -cne $Destination) { throw 'Native filename control did not accept the destination' }
}
$buttonCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button),
        [System.Windows.Automation.PropertyCondition]::new($element::IsOffscreenProperty, $false)
    ),
    [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new($element::IsEnabledProperty, $true),
        [System.Windows.Automation.PropertyCondition]::new($element::IsInvokePatternAvailableProperty, $true)
    )
)
try {
    $button = Wait-SupportElement -Clock $clock -TimeoutMilliseconds $TimeoutMilliseconds `
        -Probe { Find-SupportControl -Role $Action -Condition $buttonCondition } `
        -Failure 'Candidate save dialog has no ready requested native button'
} catch {
    Write-SupportControlDiagnostic
    throw
}
$invoke = [System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
while ($null -ne (Find-SupportDialog)) {
    if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) { throw 'Candidate support save dialog did not close' }
    Start-Sleep -Milliseconds 100
}
@{ schemaVersion = 1; action = $Action; dialogObserved = $true; dialogClosed = $true } | ConvertTo-Json -Compress

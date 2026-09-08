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
    $filename = $nativeDialog.FindFirst($scope::Descendants,
        [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new($element::AutomationIdProperty, '1001'),
            [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
        ))
    if ($null -eq $filename) { throw 'Candidate save dialog has no native filename edit control' }
    $value = [System.Windows.Automation.ValuePattern]$filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($Destination)
    if ($value.Current.Value -cne $Destination) { throw 'Native filename control did not accept the destination' }
}
$buttonId = if ($Action -eq 'save') { '1' } else { '2' }
$button = $nativeDialog.FindFirst($scope::Descendants,
    [System.Windows.Automation.PropertyCondition]::new($element::AutomationIdProperty, $buttonId))
if ($null -eq $button) { throw 'Candidate save dialog has no requested native button' }
$invoke = [System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
$clock.Restart()
while ($null -ne (Find-SupportDialog)) {
    if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) { throw 'Candidate support save dialog did not close' }
    Start-Sleep -Milliseconds 100
}
@{ schemaVersion = 1; action = $Action; dialogObserved = $true; dialogClosed = $true } | ConvertTo-Json -Compress

<# Pure readiness and metadata tests; no desktop or UIAutomation entry point is executed. #>
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$source = Join-Path $PSScriptRoot 'windows-support-dialog.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Native dialog script has syntax errors' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
foreach ($name in @('Wait-SupportElement', 'Test-SupportControlCaption', 'Find-SupportControl', 'ConvertTo-SupportControlDiagnostic')) {
    $definitions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false))
    if ($definitions.Count -ne 1) { throw 'Expected one owned helper definition' }
    . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$observed = @{ attempts = 0 }
$ready = [object]::new()
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$result = Wait-SupportElement -Clock $clock -TimeoutMilliseconds 2000 -Failure 'not ready' -Probe {
    $observed.attempts++
    if ($observed.attempts -eq 3) { return $ready }
    return $null
}
if (-not [object]::ReferenceEquals($result, $ready) -or $observed.attempts -ne 3) { throw 'Delayed readiness was not awaited' }

$clock = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Milliseconds 10
$observed.attempts = 0
try {
    $null = Wait-SupportElement -Clock $clock -TimeoutMilliseconds 1 -Failure 'expired budget' -Probe { $observed.attempts++; return $ready }
    throw 'Expired budget admitted a control'
} catch {
    if ($_.Exception.Message -cne 'expired budget' -or $observed.attempts -ne 0) { throw }
}

try {
    $null = Wait-SupportElement -Clock ([System.Diagnostics.Stopwatch]::StartNew()) -TimeoutMilliseconds 1000 -Failure 'not ready' -Probe { throw 'probe failed' }
    throw 'Probe failure was swallowed'
} catch {
    if ($_.Exception.Message -cne 'probe failed') { throw }
}

$rows = foreach ($id in @('1001', '1148', 'FileNameControlHost', 'private-value-canary', 'C:\private\file.json', "1001`n")) {
    ConvertTo-SupportControlDiagnostic -AutomationId $id -ControlType 50004 -Enabled $true -Offscreen $false -ValuePattern $true -InvokePattern $false
}
if (($rows.id -join ',') -cne '1001,1148,FileNameControlHost,<other>,<other>,<other>') { throw 'Control identifier projection differs' }
$json = ConvertTo-Json -InputObject @($rows) -Compress
if ($json.Contains('private') -or $json.Contains('canary')) { throw 'Private control identifier leaked' }
foreach ($row in $rows) {
    if (($row.Keys | Sort-Object) -join ',' -cne 'captionRole,enabled,id,idPresent,invokePattern,kind,offscreen,valuePattern') { throw 'Unexpected diagnostic field' }
    if ($row.kind -cne 'edit') { throw 'Control type projection differs' }
}
foreach ($case in @(@('filename', 'File name:'), @('filename', '文件名(N):'), @('save', 'Save'), @('save', '保存'), @('cancel', 'Cancel'), @('cancel', '取消'))) {
    if (-not (Test-SupportControlCaption -Role $case[0] -Name $case[1])) { throw 'Supported native caption was refused' }
}
foreach ($name in @('Address', 'Search', 'File name: private-value-canary', 'File name: extra', 'Save as type:')) {
    if (Test-SupportControlCaption -Role 'filename' -Name $name) { throw 'Unrelated or partial caption was accepted' }
    $row = ConvertTo-SupportControlDiagnostic -AutomationId '' -ControlType 50004 -Enabled $true -Offscreen $false -ValuePattern $true -InvokePattern $false -Name $name
    if ($row.captionRole -cne 'other' -or ($row | ConvertTo-Json -Compress).Contains($name)) { throw 'Native caption leaked' }
}
$scope = [System.Windows.Automation.TreeScope]
$nativeDialog = [pscustomobject]@{ Nodes = @([pscustomobject]@{ Current = @{ Name = 'Search' } }, [pscustomobject]@{ Current = @{ Name = 'File name:' } }) }
$nativeDialog | Add-Member -MemberType ScriptMethod -Name FindAll -Value { param($SearchScope, $Condition) return $this.Nodes }
$selected = Find-SupportControl -Role 'filename' -Condition ([System.Windows.Automation.Condition]::TrueCondition)
if (-not [object]::ReferenceEquals($selected, $nativeDialog.Nodes[1])) { throw 'The unrelated edit control was selected' }
$nativeDialog.Nodes += [pscustomobject]@{ Current = @{ Name = 'File name:' } }
try {
    $null = Find-SupportControl -Role 'filename' -Condition ([System.Windows.Automation.Condition]::TrueCondition)
    throw 'Ambiguous control selection was accepted'
} catch {
    if ($_.Exception.Message -cne 'Candidate has multiple matching native support controls') { throw }
}
@{ status = 'PASS'; scenarios = 7; desktopLaunched = $false } | ConvertTo-Json -Compress

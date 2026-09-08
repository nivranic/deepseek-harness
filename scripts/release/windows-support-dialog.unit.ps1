<# Pure readiness and metadata tests; no desktop or UIAutomation entry point is executed. #>
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$source = Join-Path $PSScriptRoot 'windows-support-dialog.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Native dialog script has syntax errors' }
foreach ($name in @('Wait-SupportElement', 'ConvertTo-SupportControlDiagnostic')) {
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
    if (($row.Keys | Sort-Object) -join ',' -cne 'enabled,id,invokePattern,kind,offscreen,valuePattern') { throw 'Unexpected diagnostic field' }
    if ($row.kind -cne 'edit') { throw 'Control type projection differs' }
}
@{ status = 'PASS'; scenarios = 5; desktopLaunched = $false } | ConvertTo-Json -Compress

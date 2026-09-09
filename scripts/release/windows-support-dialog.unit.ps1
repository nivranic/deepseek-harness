<# Pure readiness and metadata tests; no desktop or UIAutomation entry point is executed. #>
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$source = Join-Path $PSScriptRoot 'windows-support-dialog.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Native dialog script has syntax errors' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$nativeDefinitions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class DshSupportDialogNative') }, $false))
if ($nativeDefinitions.Count -ne 1) { throw 'Expected one native diagnostic declaration' }
Add-Type -TypeDefinition $nativeDefinitions[0].Value
$phaseClock = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($name in @('Write-SupportPhase', 'Wait-SupportElement', 'Test-SupportControlCaption', 'Test-SupportDefaultFilename', 'Find-SupportFilename', 'Get-SupportRemainingWait', 'Get-SupportNativeControlDiagnostic', 'ConvertTo-SupportControlDiagnostic', 'ConvertTo-SupportValueDiagnostic')) {
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
    if (($row.Keys | Sort-Object) -join ',' -cne 'captionRole,controlTypeId,defaultFilenameMatch,enabled,id,idPresent,invokePattern,kind,namePresent,native,normalizedCaptionRole,offscreen,valueObservation,valuePattern') { throw 'Unexpected diagnostic field' }
    if ($row.kind -cne 'edit') { throw 'Control type projection differs' }
}
$missingHandle = Get-SupportNativeControlDiagnostic -WindowHandle 0 -DialogHandle 0
if ($missingHandle.handlePresent -or $missingHandle.dialogDescendant -or $missingHandle.id -ne -1 -or $missingHandle.parentId -ne -1 -or $missingHandle.kind -cne 'other') { throw 'Absent native handle acquired an identity' }
$accelerator = ConvertTo-SupportControlDiagnostic -AutomationId '' -ControlType 50000 -Name ' &Save '
if ($accelerator.captionRole -cne 'other' -or $accelerator.normalizedCaptionRole -cne 'save' -or ($accelerator | ConvertTo-Json -Compress).Contains('&Save')) { throw 'Caption normalization leaked or changed raw selection facts' }
foreach ($case in @(@('filename', 'File name:'), @('filename', '文件名(N):'), @('save', 'Save'), @('save', '保存'), @('cancel', 'Cancel'), @('cancel', '取消'))) {
    if (-not (Test-SupportControlCaption -Role $case[0] -Name $case[1])) { throw 'Supported native caption was refused' }
}
foreach ($name in @('Address', 'Search', 'File name: private-value-canary', 'File name: extra', 'Save as type:')) {
    if (Test-SupportControlCaption -Role 'filename' -Name $name) { throw 'Unrelated or partial caption was accepted' }
    $row = ConvertTo-SupportControlDiagnostic -AutomationId '' -ControlType 50004 -Enabled $true -Offscreen $false -ValuePattern $true -InvokePattern $false -Name $name
    if ($row.captionRole -cne 'other' -or ($row | ConvertTo-Json -Compress).Contains($name)) { throw 'Native caption leaked' }
}
function New-FixtureEdit {
    param([string]$Value, [bool]$ReadOnly = $false, [bool]$Visible = $true, [bool]$Enabled = $true)
    return [pscustomobject]@{ Value = $Value; ReadOnly = $ReadOnly; Visible = $Visible; Enabled = $Enabled }
}
$controls = @((New-FixtureEdit -Value 'Search'), (New-FixtureEdit -Value 'fixture.json'), (New-FixtureEdit -Value 'fixture.json' -ReadOnly $true),
    (New-FixtureEdit -Value 'fixture.json' -Visible $false), (New-FixtureEdit -Value 'fixture.json' -Enabled $false))
$selected = Find-SupportFilename -Expected 'fixture.json' -Controls $controls
if (-not [object]::ReferenceEquals($selected, $controls[1])) { throw 'An unrelated or unavailable edit control was selected' }
$controls += New-FixtureEdit -Value 'fixture'
try {
    $null = Find-SupportFilename -Expected 'fixture.json' -Controls $controls
    throw 'Ambiguous control selection was accepted'
} catch {
    if ($_.Exception.Message -cne 'Candidate has multiple matching native support controls') { throw }
}
$stemControl = New-FixtureEdit -Value 'fixture'
$selected = Find-SupportFilename -Expected 'fixture.json' -Controls @($stemControl)
if (-not [object]::ReferenceEquals($selected, $stemControl)) { throw 'The extension-hidden default filename was refused' }
if (Test-SupportDefaultFilename -Value '' -Expected '.json') { throw 'An empty filename became a valid default' }
$absent = Find-SupportFilename -Expected 'fixture.json' -Controls @((New-FixtureEdit -Value 'fixture.txt'), (New-FixtureEdit -Value 'FIXTURE'), (New-FixtureEdit -Value ''), (New-FixtureEdit -Value 'C:\private\fixture.json'))
if ($null -ne $absent) { throw 'An inexact native filename was selected' }
$clock = [Diagnostics.Stopwatch]::StartNew()
$TimeoutMilliseconds = 2000
if ((Get-SupportRemainingWait) -gt 2000) { throw 'Native command extended the deadline' }
$TimeoutMilliseconds = 1
Start-Sleep -Milliseconds 10
try {
    $null = Get-SupportRemainingWait
    throw 'Native command admitted an exhausted deadline'
} catch {
    if ($_.Exception.Message -cne 'Candidate support dialog command exhausted its deadline') { throw }
}
$values = @($null, 123, '', 'fixture.json', 'fixture', 'C:\private-canary\fixture.json', 'private-value-canary')
$expectedStates = @('null', 'non-string', 'empty', 'expected', 'expected-stem', 'expected-leaf', 'other')
for ($index = 0; $index -lt $values.Count; $index++) {
    $row = ConvertTo-SupportValueDiagnostic -Availability $true -Value $values[$index] -ReadOnly $false -Expected 'fixture.json'
    if ($row.state -cne $expectedStates[$index] -or $row.readOnly -cne $false -or -not $row.availabilityIsBoolean -or $row.patternIsValuePattern) { throw 'Value metadata projection differs' }
    if (($row.Keys | Sort-Object) -join ',' -cne 'availabilityIsBoolean,patternIsValuePattern,readOnly,state') { throw 'Unexpected value diagnostic field' }
    if (($row | ConvertTo-Json -Compress).Contains('canary')) { throw 'Private native value leaked' }
}
$row = ConvertTo-SupportValueDiagnostic -Availability 'private-canary' -Pattern ([object]::new()) -ReadOnly 'private-canary'
if ($row.availabilityIsBoolean -or $row.patternIsValuePattern -or $null -ne $row.readOnly) { throw 'Unknown pattern metadata became authoritative' }
$row = ConvertTo-SupportValueDiagnostic -Availability $true -ReadOnly $true
if ($row.readOnly -cne $true) { throw 'Read-only metadata was lost' }
@{ status = 'PASS'; scenarios = 12; desktopLaunched = $false } | ConvertTo-Json -Compress

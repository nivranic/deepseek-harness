<# Exercise the actual Windows common save dialog only on a disposable hosted runner. #>
param([switch]$Fixture, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') {
    throw 'Native dialog regression requires a disposable GitHub-hosted Windows runner'
}
$temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)
function Assert-FixtureRoot {
    param([string]$Path)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Native dialog fixture requires an absolute owned directory' }
    $full = [IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetDirectoryName($full) -cne $temporaryRoot -or [IO.Path]::GetFileName($full) -cnotmatch '\Adsh-native-dialog-[a-f0-9]{32}\z') {
        throw 'Native dialog fixture escaped the runner temporary directory'
    }
    if ((Get-Item -LiteralPath $full).LinkType) { throw 'Native dialog fixture directory is linked' }
}
if ($Fixture) {
    Assert-FixtureRoot -Path $FixtureRoot
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $dialog = [System.Windows.Forms.SaveFileDialog]::new()
    try {
        $dialog.AutoUpgradeEnabled = $true
        $dialog.Title = 'Export diagnostics'
        $dialog.InitialDirectory = $FixtureRoot
        $dialog.FileName = 'fixture.json'
        $dialog.Filter = 'Diagnostics (*.json)|*.json'
        $dialog.DefaultExt = 'json'
        $result = $dialog.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            $expected = Join-Path $FixtureRoot 'saved.json'
            if ($dialog.FileName -cne $expected) { throw 'Native save dialog returned a different destination' }
            [IO.File]::WriteAllText($expected, '{"fixture":true}')
            @{ status = 'saved' } | ConvertTo-Json -Compress
        } elseif ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
            @{ status = 'cancelled' } | ConvertTo-Json -Compress
        } else {
            throw 'Native dialog returned an unexpected result'
        }
    } finally {
        $dialog.Dispose()
    }
    exit 0
}
if ($FixtureRoot) { throw 'The regression owns its fixture directory' }
function Start-DialogTestProcess {
    param([string[]]$Arguments)
    $start = [Diagnostics.ProcessStartInfo]::new('pwsh')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment.Clear()
    foreach ($key in @('Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_TEMP')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if ($null -ne $value) { $start.Environment[$key] = $value }
    }
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    return [Diagnostics.Process]::Start($start)
}
$root = Join-Path $temporaryRoot ('dsh-native-dialog-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
Assert-FixtureRoot -Path $root
$process = $null
$driver = $null
$failures = [Collections.Generic.List[Exception]]::new()
try {
    foreach ($action in @('save', 'cancel')) {
        $process = Start-DialogTestProcess -Arguments @('-NoProfile', '-STA', '-File', $PSCommandPath, '-Fixture', '-FixtureRoot', $root)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $arguments = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'windows-support-dialog.ps1'), '-CandidateProcessId', [string]$process.Id, '-Action', $action)
        if ($action -ceq 'save') { $arguments += @('-Destination', (Join-Path $root 'saved.json'), '-ExpectedFileName', 'fixture.json') }
        $driver = Start-DialogTestProcess -Arguments $arguments
        $driverOutput = $driver.StandardOutput.ReadToEndAsync()
        $driverError = $driver.StandardError.ReadToEndAsync()
        if (-not $driver.WaitForExit(40000)) { throw 'Native dialog driver exceeded its process deadline' }
        if ($driver.ExitCode -ne 0) {
            [Console]::Error.WriteLine($driverError.GetAwaiter().GetResult())
            throw 'Native dialog driver failed against the common dialog fixture'
        }
        $observation = $driverOutput.GetAwaiter().GetResult()
        $driver.Dispose()
        $driver = $null
        if (-not $process.WaitForExit(10000)) { throw 'Native dialog fixture did not exit' }
        if ($process.ExitCode -ne 0 -or $stderr.GetAwaiter().GetResult()) { throw 'Native dialog fixture reported a failure' }
        $record = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json
        $expected = if ($action -ceq 'save') { 'saved' } else { 'cancelled' }
        if (($record.PSObject.Properties.Name -join ',') -cne 'status' -or $record.status -cne $expected) { throw 'Native dialog fixture result differs' }
        $native = $observation | ConvertFrom-Json
        if ($native.action -cne $action -or -not $native.dialogObserved -or -not $native.dialogClosed) { throw 'Native dialog observation differs' }
        if ([IO.File]::ReadAllText((Join-Path $root 'saved.json')) -cne '{"fixture":true}') { throw 'Native fixture save bytes differ' }
        $process.Dispose()
        $process = $null
    }
} catch {
    $failures.Add($_.Exception)
} finally {
    $quiescent = $true
    foreach ($owned in @($driver, $process)) {
        if ($null -eq $owned) { continue }
        try {
            if (-not $owned.HasExited) { $owned.Kill($true) }
            if (-not $owned.WaitForExit(10000)) { throw 'Native dialog fixture cleanup did not reach process exit' }
            $owned.Dispose()
        } catch {
            $quiescent = $false
            $failures.Add($_.Exception)
        }
    }
    if ($quiescent) {
        try {
            Assert-FixtureRoot -Path $root
            Remove-Item -LiteralPath $root -Recurse -Force
        } catch {
            $failures.Add($_.Exception)
        }
    }
}
if ($failures.Count -ne 0) { throw [AggregateException]::new('Native save dialog regression or cleanup failed', $failures) }
@{ status = 'PASS'; scenarios = 2; fixture = 'Windows common save dialog' } | ConvertTo-Json -Compress

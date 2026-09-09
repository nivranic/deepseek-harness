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
    $stage = 'configure'
    $destinationFacts = $null
    try {
        $dialog.AutoUpgradeEnabled = $true
        $dialog.Title = 'Export diagnostics'
        $dialog.InitialDirectory = $FixtureRoot
        $dialog.FileName = 'fixture.json'
        $dialog.Filter = 'Diagnostics (*.json)|*.json'
        $dialog.DefaultExt = 'json'
        $stage = 'show'
        $result = $dialog.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            $stage = 'validate-path'
            $expected = Join-Path $FixtureRoot 'saved.json'
            $destinationFacts = @{ exact = $dialog.FileName -ceq $expected; parentMatches = [IO.Path]::GetDirectoryName($dialog.FileName) -ceq $FixtureRoot
                leafMatches = [IO.Path]::GetFileName($dialog.FileName) -ceq 'saved.json'; duplicateExtension = [IO.Path]::GetFileName($dialog.FileName) -ceq 'saved.json.json' }
            if ($dialog.FileName -cne $expected) { throw 'Native save dialog returned a different destination' }
            $stage = 'write-file'
            [IO.File]::WriteAllText($expected, '{"fixture":true}')
            @{ status = 'saved' } | ConvertTo-Json -Compress
        } elseif ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
            @{ status = 'cancelled' } | ConvertTo-Json -Compress
        } else {
            throw 'Native dialog returned an unexpected result'
        }
    } catch {
        @{ status = 'failed'; stage = $stage; destinationFacts = $destinationFacts } | ConvertTo-Json -Compress
        throw
    } finally {
        $dialog.Dispose()
    }
    exit 0
}
if ($FixtureRoot) { throw 'The regression owns its fixture directory' }
function ConvertTo-DialogFixtureFailure {
    param([int]$ExitCode, [string]$Output, [string]$ErrorOutput)
    $record = $null
    try { $record = $Output | ConvertFrom-Json } catch { <# Only malformed fixture stdout is unavailable. #> }
    $status = if ($record.status -cin @('saved', 'cancelled', 'failed')) { $record.status } else { 'unavailable' }
    $stage = if ($record.stage -cin @('configure', 'show', 'validate-path', 'write-file')) { $record.stage } else { 'unavailable' }
    $facts = @{}
    foreach ($key in @('exact', 'parentMatches', 'leafMatches', 'duplicateExtension')) {
        $facts[$key] = if ($record.destinationFacts.$key -is [bool]) { $record.destinationFacts.$key } else { $null }
    }
    return @{ schemaVersion = 1; scope = 'candidate-dialog-fixture'; exitCode = $ExitCode; status = $status; stage = $stage; destinationFacts = $facts
        stderrPresent = $ErrorOutput.Length -ne 0; stderrIsClixml = $ErrorOutput.StartsWith('#< CLIXML'); stderrHasProgress = $ErrorOutput.Contains('S="progress"') }
}
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
        if ($action -ceq 'save') {
            foreach ($probe in @('observe', 'absent')) {
                $target = if ($probe -ceq 'observe') { $process.Id } else { $PID }
                $budget = if ($probe -ceq 'observe') { 30000 } else { 300 }
                $driver = Start-DialogTestProcess -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'windows-support-dialog.ps1'),
                    '-CandidateProcessId', [string]$target, '-Action', $probe, '-TimeoutMilliseconds', [string]$budget)
                $driverOutput = $driver.StandardOutput.ReadToEndAsync()
                $driverError = $driver.StandardError.ReadToEndAsync()
                if (-not $driver.WaitForExit(40000) -or $driver.ExitCode -ne 0) { throw 'Native dialog process isolation regression failed' }
                $observed = $driverOutput.GetAwaiter().GetResult() | ConvertFrom-Json
                if ($observed.action -cne $probe -or $observed.dialogObserved -ne ($probe -ceq 'observe') -or $observed.dialogClosed -ne ($probe -ceq 'absent')) { throw 'Another process acquired the native dialog' }
                if ($process.HasExited) { throw 'Process isolation probe closed the native dialog' }
                $driver.Dispose()
                $driver = $null
            }
        }
        $arguments = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'windows-support-dialog.ps1'), '-CandidateProcessId', [string]$process.Id, '-Action', $action)
        if ($action -ceq 'save') { $arguments += @('-Destination', (Join-Path $root 'saved.json'), '-ExpectedFileName', 'fixture.json') }
        $driver = Start-DialogTestProcess -Arguments $arguments
        $driverOutput = $driver.StandardOutput.ReadToEndAsync()
        $driverError = $driver.StandardError.ReadToEndAsync()
        if (-not $driver.WaitForExit(40000)) { throw 'Native dialog driver exceeded its process deadline' }
        if ($driver.ExitCode -ne 0) {
            throw 'Native dialog driver failed against the common dialog fixture'
        }
        $observation = $driverOutput.GetAwaiter().GetResult()
        [Console]::Error.WriteLine($driverError.GetAwaiter().GetResult())
        $driver.Dispose()
        $driver = $null
        if (-not $process.WaitForExit(10000)) { throw 'Native dialog fixture did not exit' }
        if ($process.ExitCode -ne 0 -or $stderr.GetAwaiter().GetResult()) {
            [Console]::Error.WriteLine(((ConvertTo-DialogFixtureFailure -ExitCode $process.ExitCode -Output $stdout.GetAwaiter().GetResult() -ErrorOutput $stderr.GetAwaiter().GetResult()) | ConvertTo-Json -Depth 4 -Compress))
            throw 'Native dialog fixture reported a failure'
        }
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
            if ([object]::ReferenceEquals($owned, $driver)) { [Console]::Error.WriteLine($driverError.GetAwaiter().GetResult()) }
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
@{ status = 'PASS'; scenarios = 3; fixture = 'Windows common save dialog' } | ConvertTo-Json -Compress

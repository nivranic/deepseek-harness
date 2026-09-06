# Read only this candidate's Application Error records; never emit full event messages or paths.
param([Parameter(Mandatory = $true)][string] $ExecutablePath)
$ErrorActionPreference = 'Stop'

$executable = Get-Item -LiteralPath $ExecutablePath
if ($executable.PSIsContainer) { throw 'Installer diagnostic input must be a file' }
$requestedPath = $ExecutablePath.Replace('/', '\')
$records = [Collections.Generic.List[object]]::new()
$state = 'queried'
$malformed = 0
try {
    $events = @(Get-WinEvent -FilterHashtable @{
        LogName = 'Application'; ProviderName = 'Application Error'; ID = 1000
        StartTime = (Get-Date).AddMinutes(-45)
    } -MaxEvents 100 -ErrorAction Stop)
} catch {
    # NoMatchingEventsFound is a successful empty query; other host errors remain unavailable.
    $events = @()
    if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { $state = 'unavailable' }
}
foreach ($event in $events) {
    try { [xml] $xml = $event.ToXml() } catch {
        # Event payload parsing failures have no safe diagnostic text to publish.
        $malformed++
        continue
    }
    if ([string] $xml.Event.System.EventID -ne '1000' -or
        [string] $xml.Event.System.Provider.Name -ne 'Application Error') { continue }
    $fields = @{}
    foreach ($data in $xml.Event.EventData.Data) { $fields[[string] $data.Name] = [string] $data.'#text' }
    $matchesRequested = [IO.Path]::IsPathFullyQualified($requestedPath) -and
        [StringComparer]::OrdinalIgnoreCase.Equals($fields.AppPath, $requestedPath)
    if (-not $matchesRequested -and -not [StringComparer]::OrdinalIgnoreCase.Equals($fields.AppPath, $executable.FullName)) { continue }
    $module = [IO.Path]::GetFileName([string] $fields.ModuleName)
    if ($module -cnotmatch '^[A-Za-z0-9_.-]{1,128}$') { $module = $null }
    $exception = [string] $fields.ExceptionCode
    if ($exception -match '^(?:0x)?([a-f0-9]{8})$') { $exception = '0x' + $Matches[1].ToLowerInvariant() } else { $exception = $null }
    $offset = [string] $fields.FaultingOffset
    if ($offset -match '^(?:0x)?([a-f0-9]{1,16})$') { $offset = '0x' + $Matches[1].ToLowerInvariant() } else { $offset = $null }
    $version = [string] $fields.AppVersion
    if ($version -notmatch '^\d{1,10}(?:\.\d{1,10}){0,3}$') { $version = $null }
    $records.Add([ordered]@{ module = $module; exceptionCode = $exception; faultOffset = $offset; applicationVersion = $version })
}
[ordered]@{
    schemaVersion = 1
    scope = 'windows-installer-crash-diagnostic'
    queryState = $state
    malformedRecords = $malformed
    sha256 = (Get-FileHash -LiteralPath $executable.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes = $executable.Length
    records = @($records.ToArray())
} | ConvertTo-Json -Depth 4 -Compress

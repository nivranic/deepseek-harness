# Read actual Windows PE metadata and Authenticode state; this command never executes the files.
param(
    [Parameter(Mandatory=$true)][string]$InputFile,
    [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
if (@($request.files).Count -ne 4) { throw 'Require installer, portable, unpacked and installed executable metadata' }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$facts = foreach ($path in $request.files) {
    $item = Get-Item -LiteralPath $path
    if (-not $seen.Add($item.FullName)) { throw 'Candidate executable references must be distinct' }
    $version = $item.VersionInfo
    $numericFile = '{0}.{1}.{2}.{3}' -f $version.FileMajorPart,$version.FileMinorPart,$version.FileBuildPart,$version.FilePrivatePart
    $numericProduct = '{0}.{1}.{2}.{3}' -f $version.ProductMajorPart,$version.ProductMinorPart,$version.ProductBuildPart,$version.ProductPrivatePart
    $signature = (Get-AuthenticodeSignature -LiteralPath $path).Status.ToString()
    if ($version.FileVersion -cne $request.identity.windowsFileVersion -or $numericFile -cne $request.identity.windowsFileVersion -or
        $numericProduct -cne $request.identity.windowsFileVersion -or $version.ProductVersion -cne $request.identity.version -or $signature -cne 'NotSigned') {
        throw 'Candidate PE version or unsigned state differs from the expected identity'
    }
    @{fileVersion=$version.FileVersion;productVersion=$version.ProductVersion;numericFileVersion=$numericFile;numericProductVersion=$numericProduct;signature=$signature}
}
if (@($facts).Count -ne 4) { throw 'Require installer, portable, unpacked and installed executable metadata' }
@{status='PASS';files=@($facts)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputFile -Encoding utf8

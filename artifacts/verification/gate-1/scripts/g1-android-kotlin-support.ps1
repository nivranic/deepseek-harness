$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$commit = 'b3d3a9165803f5e416e0c1cb65a3956b3a6c16a3'
$repo = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to resolve the repository root'
}

$resolvedCommit = (& git -C $repo rev-parse "$commit^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or $resolvedCommit -ne $commit) {
    throw "Required commit is unavailable: $commit"
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$auditRoot = Join-Path $tempBase ("dsh-g1-android-$($commit.Substring(0, 12))-" + [Guid]::NewGuid().ToString('N'))
$resolvedAuditRoot = [IO.Path]::GetFullPath($auditRoot)
$expectedPrefix = "dsh-g1-android-$($commit.Substring(0, 12))-"
if (-not $resolvedAuditRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($resolvedAuditRoot)).StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
    throw "Unexpected verification root: $resolvedAuditRoot"
}

try {
    $sourceRoot = Join-Path $resolvedAuditRoot 'source'
    $deps = Join-Path $resolvedAuditRoot 'deps'
    $compilerRoot = Join-Path $resolvedAuditRoot 'compiler'
    $mainOut = Join-Path $resolvedAuditRoot 'main-classes'
    $testOut = Join-Path $resolvedAuditRoot 'test-classes'
    New-Item -ItemType Directory -Path $sourceRoot, $deps, $compilerRoot, $mainOut, $testOut | Out-Null

    $sourceTar = Join-Path $resolvedAuditRoot 'source.tar'
    & git -C $repo archive --format=tar "--output=$sourceTar" $commit `
        apps/android/build.gradle.kts `
        apps/android/settings.gradle.kts `
        apps/android/core
    if ($LASTEXITCODE -ne 0) {
        throw 'git archive failed'
    }

    & tar.exe -xf $sourceTar -C $sourceRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'source archive extraction failed'
    }

    $java = (Get-Command java.exe -ErrorAction Stop).Source
    $keytool = (Get-Command keytool.exe -ErrorAction Stop).Source
    if ((Split-Path -Parent $java) -ne (Split-Path -Parent $keytool)) {
        throw 'java.exe and keytool.exe must come from the same JDK'
    }
    $javaVersion = (& $java -version 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch 'version "17\.') {
        throw "JDK 17 required; observed:`n$javaVersion"
    }

    $compilerZip = Join-Path $resolvedAuditRoot 'kotlin-compiler-2.1.20.zip'
    $downloads = [ordered]@{
        $compilerZip = @(
            'https://github.com/JetBrains/kotlin/releases/download/v2.1.20/kotlin-compiler-2.1.20.zip',
            'a118197b0de55ffab2bc8d5cd03a5e39033cfb53383d6931bc761dec0784891a'
        )
        (Join-Path $deps 'annotations-23.0.0.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/annotations/23.0.0/annotations-23.0.0.jar',
            '7b0f19724082cbfcbc66e5abea2b9bc92cf08a1ea11e191933ed43801eb3cd05'
        )
        (Join-Path $deps 'kotlin-stdlib-2.1.21.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.1.21/kotlin-stdlib-2.1.21.jar',
            '263bdc679e1f62012db7b091796279b6d71cf36f4797a98ff1ace05835f201c8'
        )
        (Join-Path $deps 'kotlin-test-2.1.20.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-test/2.1.20/kotlin-test-2.1.20.jar',
            '0028b5c74191184519f60e727c5aa4e5d7e3ac04fc0bed559f49d37165dec961'
        )
        (Join-Path $deps 'kotlin-test-junit5-2.1.20.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-test-junit5/2.1.20/kotlin-test-junit5-2.1.20.jar',
            '9da61772c8c2b52f022b9576a53a1b0f87aff1a6372039ce86c2e93b3eeb19cb'
        )
        (Join-Path $deps 'kotlinx-coroutines-core-jvm-1.10.2.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.10.2/kotlinx-coroutines-core-jvm-1.10.2.jar',
            '5ca175b38df331fd64155b35cd8cae1251fa9ee369709b36d42e0a288ccce3fd'
        )
        (Join-Path $deps 'kotlinx-coroutines-test-jvm-1.10.2.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-test-jvm/1.10.2/kotlinx-coroutines-test-jvm-1.10.2.jar',
            '590a549f8c1db590c9d98a8a20424a1f581a34162a369e6a6bd884ce7d36d3d7'
        )
        (Join-Path $deps 'kotlinx-serialization-core-jvm-1.8.0.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-serialization-core-jvm/1.8.0/kotlinx-serialization-core-jvm-1.8.0.jar',
            'd3c94e9d829bba6e0c4cd3ae478a40846dd49d5475d6707877be853976afe416'
        )
        (Join-Path $deps 'kotlinx-serialization-json-jvm-1.8.0.jar') = @(
            'https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-serialization-json-jvm/1.8.0/kotlinx-serialization-json-jvm-1.8.0.jar',
            '7b7c445880cef94dc464f4733da1b33b94bee78805041ea08ae06e8507e4620e'
        )
        (Join-Path $deps 'okhttp-jvm-5.5.0.jar') = @(
            'https://repo.maven.apache.org/maven2/com/squareup/okhttp3/okhttp-jvm/5.5.0/okhttp-jvm-5.5.0.jar',
            '234194a04aac54858df0a750d243af7b2e39df5e4eb86e9912043ad33a9f9a52'
        )
        (Join-Path $deps 'okio-jvm-3.18.1.jar') = @(
            'https://repo.maven.apache.org/maven2/com/squareup/okio/okio-jvm/3.18.1/okio-jvm-3.18.1.jar',
            'b97b640557a650d15411f2be29aef558c4e422a83653cb18ba494311dbed18be'
        )
        (Join-Path $deps 'turbine-jvm-1.2.0.jar') = @(
            'https://repo.maven.apache.org/maven2/app/cash/turbine/turbine-jvm/1.2.0/turbine-jvm-1.2.0.jar',
            'dcc2e85dbf7d4a0375eb9ff0d4587475e256914f7796aa6c006cc29b66b339da'
        )
        (Join-Path $deps 'junit-platform-console-standalone-1.11.4.jar') = @(
            'https://repo.maven.apache.org/maven2/org/junit/platform/junit-platform-console-standalone/1.11.4/junit-platform-console-standalone-1.11.4.jar',
            'b016ef6b1c3454d6d7c2c88ce081dabf289699686af6622d6e4e2e1b54b4a2fc'
        )
    }

    foreach ($download in $downloads.GetEnumerator()) {
        & curl.exe --fail --location --silent --show-error --retry 3 `
            --output $download.Key $download.Value[0]
        if ($LASTEXITCODE -ne 0) {
            throw "Dependency download failed: $($download.Value[0])"
        }
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $download.Key).Hash.ToLowerInvariant()
        if ($actualHash -ne $download.Value[1]) {
            throw "SHA-256 mismatch for $($download.Key): $actualHash"
        }
    }

    Expand-Archive -LiteralPath $compilerZip -DestinationPath $compilerRoot
    $kotlinHome = Join-Path $compilerRoot 'kotlinc'
    $kotlinc = Join-Path $kotlinHome 'bin\kotlinc.bat'
    $compilerVersion = (& $kotlinc -version 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $compilerVersion -notmatch '2\.1\.20') {
        throw "Kotlin 2.1.20 required; observed:`n$compilerVersion"
    }

    function Join-ClassPath([string[]] $Items) {
        return [string]::Join([IO.Path]::PathSeparator, $Items)
    }

    $coreRoot = Join-Path $sourceRoot 'apps\android\core'
    $mainSources = @(
        Get-ChildItem -LiteralPath (Join-Path $coreRoot 'src\main\kotlin') -Recurse -File -Filter '*.kt' |
            Sort-Object FullName |
            ForEach-Object FullName
    )
    $testSources = @(
        Get-ChildItem -LiteralPath (Join-Path $coreRoot 'src\test\kotlin') -Recurse -File -Filter '*.kt' |
            Sort-Object FullName |
            ForEach-Object FullName
    )
    if ($mainSources.Count -ne 25) {
        throw "Expected 25 main sources, found $($mainSources.Count)"
    }
    if ($testSources.Count -ne 21) {
        throw "Expected 21 test sources, found $($testSources.Count)"
    }

    $mainJars = @(
        (Join-Path $deps 'kotlin-stdlib-2.1.21.jar')
        (Join-Path $deps 'annotations-23.0.0.jar')
        (Join-Path $deps 'kotlinx-coroutines-core-jvm-1.10.2.jar')
        (Join-Path $deps 'kotlinx-serialization-core-jvm-1.8.0.jar')
        (Join-Path $deps 'kotlinx-serialization-json-jvm-1.8.0.jar')
        (Join-Path $deps 'okio-jvm-3.18.1.jar')
        (Join-Path $deps 'okhttp-jvm-5.5.0.jar')
    )
    $compilerClasspath = Join-Path $kotlinHome 'lib\*'
    $mainClasspath = Join-ClassPath $mainJars
    & $java -cp $compilerClasspath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
        -kotlin-home $kotlinHome `
        -no-stdlib `
        -no-reflect `
        -jvm-target 17 `
        -Xjdk-release=17 `
        -module-name dsh_android_core `
        -classpath $mainClasspath `
        -d $mainOut `
        @mainSources
    if ($LASTEXITCODE -ne 0) {
        throw 'Compilation of 25 main sources failed'
    }

    $mainClassCount = @(Get-ChildItem -LiteralPath $mainOut -Recurse -File -Filter '*.class').Count
    if ($mainClassCount -ne 288) {
        throw "Expected 288 main class files, found $mainClassCount"
    }

    $testOnlyJars = @(
        (Join-Path $deps 'kotlin-test-2.1.20.jar')
        (Join-Path $deps 'kotlin-test-junit5-2.1.20.jar')
        (Join-Path $deps 'kotlinx-coroutines-test-jvm-1.10.2.jar')
        (Join-Path $deps 'turbine-jvm-1.2.0.jar')
        (Join-Path $deps 'junit-platform-console-standalone-1.11.4.jar')
    )
    $testCompileClasspath = Join-ClassPath (@($mainOut) + $mainJars + $testOnlyJars)
    & $java -cp $compilerClasspath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
        -kotlin-home $kotlinHome `
        -no-stdlib `
        -no-reflect `
        -jvm-target 17 `
        -Xjdk-release=17 `
        -module-name dsh_android_core_test `
        "-Xfriend-paths=$mainOut" `
        -classpath $testCompileClasspath `
        -d $testOut `
        @testSources
    if ($LASTEXITCODE -ne 0) {
        throw 'Compilation of 21 test sources failed'
    }

    $testClassCount = @(Get-ChildItem -LiteralPath $testOut -Recurse -File -Filter '*.class').Count
    if ($testClassCount -ne 286) {
        throw "Expected 286 test class files, found $testClassCount"
    }

    $runtimeClasspath = Join-ClassPath (
        @($mainOut, $testOut, (Join-Path $coreRoot 'src\test\resources')) +
        $mainJars +
        @(
            (Join-Path $deps 'kotlin-test-2.1.20.jar')
            (Join-Path $deps 'kotlin-test-junit5-2.1.20.jar')
            (Join-Path $deps 'kotlinx-coroutines-test-jvm-1.10.2.jar')
            (Join-Path $deps 'turbine-jvm-1.2.0.jar')
        )
    )
    $junitConsole = Join-Path $deps 'junit-platform-console-standalone-1.11.4.jar'
    $junitOutput = & $java `
        --add-modules jdk.httpserver `
        -jar $junitConsole `
        execute `
        "--class-path=$runtimeClasspath" `
        --select-package=ai.deepseek.dsh.link `
        --select-class=ai.deepseek.dsh.companion.CompanionModelTest `
        --disable-ansi-colors `
        --details=tree `
        --fail-if-no-tests 2>&1
    $junitExitCode = $LASTEXITCODE
    $junitText = $junitOutput | Out-String
    $junitOutput | Out-Host
    if ($junitExitCode -ne 0) {
        throw "JUnit Console failed with exit code $junitExitCode"
    }
    if ($junitText -notmatch '\b47 tests successful\b' -or $junitText -notmatch '\b0 tests failed\b') {
        throw 'Expected exactly 47 successful and 0 failed tests'
    }
    if ($junitText -notmatch 'clientTransportAcceptsTheRightPinAndRejectsTheWrongPinBeforeRequestBytes\(\) \[OK\]') {
        throw 'The right-pin/wrong-pin transport test did not pass'
    }

    [ordered]@{
        sourceHead = $commit
        java = '17'
        kotlinCompiler = '2.1.20'
        kotlinStdlib = '2.1.21'
        mainSources = $mainSources.Count
        mainClasses = $mainClassCount
        testSources = $testSources.Count
        testClasses = $testClassCount
        testsSuccessful = 47
        testsFailed = 0
        pinning = 'right-pin accepted; wrong-pin rejected before application request bytes'
        evidenceLevel = 'E2_SUPPORTING_ONLY'
    } | ConvertTo-Json
} finally {
    if (Test-Path -LiteralPath $resolvedAuditRoot) {
        $cleanupTarget = [IO.Path]::GetFullPath($resolvedAuditRoot)
        if (-not $cleanupTarget.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($cleanupTarget)).StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected verification root: $cleanupTarget"
        }
        Remove-Item -LiteralPath $cleanupTarget -Recurse -Force
    }
}

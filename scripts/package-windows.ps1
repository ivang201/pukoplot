#Requires -Version 5.1
[CmdletBinding()]
param(
    [string] $Revision = 'HEAD',
    [string] $Bun = 'bun',
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (!$OutputPath) { $OutputPath = Join-Path $repo 'dist/Pukoplot-Windows-x64.zip' }
$outputFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
if ([IO.Path]::GetExtension($outputFile) -ne '.zip') { throw 'OutputPath must name a ZIP file.' }

$compiler = (Get-Command $Bun -CommandType Application).Source
$version = & $compiler --version
if ($LASTEXITCODE -ne 0 -or $version -ne '1.2.23') { throw 'Build with Bun 1.2.23 for Windows x64.' }
$tree = & git -C $repo rev-parse --verify --end-of-options "${Revision}^{tree}"
if ($LASTEXITCODE -ne 0) { throw "Cannot read Git revision: $Revision" }

# Read paths byte-for-byte as UTF-8, including the name of the Russian player guide.
$originalEncoding = [Console]::OutputEncoding
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $tracked = @(& git -C $repo -c core.quotePath=false ls-tree -r --name-only $tree)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list the Git tree.' }
} finally {
    [Console]::OutputEncoding = $originalEncoding
}

$serverFiles = @('server.mjs', 'store.mjs')
foreach ($required in $serverFiles + 'public/index.html') {
    if ($tracked -cnotcontains $required) { throw "Missing in Git revision: $required" }
}
$resources = @($tracked | Where-Object {
    $_ -cmatch '^public/[\w-]+\.(?:html|css|js)$' -or
    $_ -cmatch '^public/art/(?:(?!_parts/)[\w-]+/)*[\w-]+\.(?:webp|png|jpg|jpeg|svg|ico)$' -or
    $_ -cmatch '^public/fonts/[\w.-]+\.(?:woff2|txt)$' -or
    $_ -cmatch '^public/vendor/[\w.-]+\.(?:js|txt)$' -or
    $_ -cin @('public/shirts/README.txt', 'docs/river-run.webp', 'README.md', 'LICENSE', 'ИНСТРУКЦИЯ.txt')
})

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$buildName = 'pukoplot-windows-' + [guid]::NewGuid().ToString('N')
$buildDir = Join-Path $tempRoot $buildName
$outputDir = [IO.Path]::GetDirectoryName($outputFile)
$pendingZip = Join-Path $outputDir ($buildName + '.tmp')
[void][IO.Directory]::CreateDirectory($buildDir)
try {
    $src = Join-Path $buildDir 'source'
    $sourceZip = Join-Path $buildDir 'source.zip'
    $sourceFiles = $serverFiles + $resources
    & git -C $repo archive --format=zip "--output=$sourceZip" $tree -- @sourceFiles
    if ($LASTEXITCODE -ne 0) { throw 'Cannot export the source from Git.' }
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $src)

    Push-Location -LiteralPath $src
    try {
        & $compiler build --compile --target=bun-windows-x64 --windows-icon=./public/art/club-icon.ico --windows-title=Пукоплот --windows-description="Кооперативный сплав на плоту" ./server.mjs --outfile Pukoplot.exe
        if ($LASTEXITCODE -ne 0) { throw 'Bun compilation failed.' }
    } finally {
        Pop-Location
    }

    [void][IO.Directory]::CreateDirectory($outputDir)
    $zip = [IO.Compression.ZipFile]::Open($pendingZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        # Git orders the paths. A fixed timestamp keeps ZIP entries independent of build time.
        $stamp = [datetime]::new(2000, 1, 1, 0, 0, 0)
        foreach ($name in @('Pukoplot.exe') + $resources) {
            $inputFile = Join-Path $src $name
            [IO.File]::SetLastWriteTime($inputFile, $stamp)
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $inputFile, $name, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally {
        $zip.Dispose()
    }
    Move-Item -LiteralPath $pendingZip -Destination $outputFile -Force
    Write-Host "Git tree: $tree"
    Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile
} finally {
    if ([IO.File]::Exists($pendingZip)) { [IO.File]::Delete($pendingZip) }
    $actual = (Resolve-Path -LiteralPath $buildDir).ProviderPath
    if ([IO.Path]::GetDirectoryName($actual) -eq $tempRoot -and [IO.Path]::GetFileName($actual) -eq $buildName) {
        Remove-Item -Recurse -Force -LiteralPath $actual
    }
}

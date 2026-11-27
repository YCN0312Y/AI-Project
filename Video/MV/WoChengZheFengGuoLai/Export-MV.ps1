# Run from PowerShell with .\Export-MV.ps1 to render the adjacent HTML animation.
$ErrorActionPreference = 'Stop'
$stem = 'WoChengZheFengGuoLai'
$html = Join-Path $PSScriptRoot ($stem + '_MV.html')
$music = Join-Path $PSScriptRoot ("Music/" + $stem + '.mp3')
if (!(Test-Path -LiteralPath $music -PathType Leaf)) { throw "Missing soundtrack: $music" }
$document = [IO.File]::ReadAllText($html)
$timeMatch = [regex]::Match($document, '\bconst\s+DURATION\s*=\s*(\d+(?:\.\d+)?)\s*;')
if (!$timeMatch.Success) { throw 'Cannot read DURATION from the MV.' }
$duration = [double]::Parse($timeMatch.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
$fps = 30
$frameCount = [int][Math]::Round($duration * $fps)
if ($frameCount -lt 1) { throw 'The MV has no frames.' }
$ffCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffmpeg = if ($ffCommand) { $ffCommand.Source } else { 'F:\YU\Software\FormatFactory\ffmpeg.exe' }
if (!(Test-Path -LiteralPath $ffmpeg -PathType Leaf)) { throw 'FFmpeg is required.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$priorNodePath = $env:NODE_PATH
$runtimeModules = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$base = Join-Path $PSScriptRoot ($stem + '_MV')
$dest = $base + '.mp4'
for ($version = 2; Test-Path -LiteralPath $dest; $version++) { $dest = "$base-$version.mp4" }

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$jobName = 'MV-Export-' + [guid]::NewGuid().ToString('N')
$job = Join-Path $tempRoot $jobName
[void][IO.Directory]::CreateDirectory($job)
$helper = Join-Path $job 'frames.cjs'
try {
    if (Test-Path -LiteralPath $runtimeModules) {
        $env:NODE_PATH = (@($runtimeModules, $priorNodePath) | Where-Object { $_ }) -join ';'
    }
    $renderer = @'
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sharp = require("sharp");
const { createCanvas, Path2D } = require("@napi-rs/canvas");

const [htmlPath, firstFrame, batchSize, totalFrames, frameRate] = process.argv.slice(2);
const width = 1920;
const height = 1080;
const canvas = createCanvas(width, height);
canvas.style = {};

// The player initializes its controls before rendering its first frame.
const control = {
    style: {}, classList: { add() {} }, addEventListener() {}, appendChild() {},
    querySelector() { return this; }
};
const document = {
    getElementById(id) { return id === "cv" ? canvas : control; },
    createElement(tag) { return tag === "canvas" ? createCanvas(1, 1) : control; }
};
const player = {
    document, Path2D, URLSearchParams, location: { search: "?t=0" },
    innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    addEventListener() {}, requestAnimationFrame() {}
};
const html = fs.readFileSync(htmlPath, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const entry = script.replace(/\}\)\(\);\s*$/, "globalThis.drawFrame = render; })();");
vm.runInNewContext(entry, player);

async function writeFrames() {
    const end = Math.min(Number(firstFrame) + Number(batchSize), Number(totalFrames));
    for (let index = Number(firstFrame); index < end; index++) {
        player.drawFrame(index / Number(frameRate));
        const filename = "frame-" + String(index).padStart(5, "0") + ".png";
        await sharp(canvas.data(), { raw: { width, height, channels: 4 } })
            .removeAlpha().png({ compressionLevel: 1 }).toFile(path.join(__dirname, filename));
    }
}
writeFrames().catch(error => { console.error(error); process.exitCode = 1; });
'@
    [IO.File]::WriteAllText($helper, $renderer, [Text.UTF8Encoding]::new($false))
    for ($offset = 0; $offset -lt $frameCount; $offset += 90) {
        & $node $helper $html $offset 90 $frameCount $fps
        if ($LASTEXITCODE -ne 0) { throw "Frame rendering failed at $offset." }
        Write-Progress -Activity 'Rendering MV' -Status "$([Math]::Min($offset + 90, $frameCount)) / $frameCount" -PercentComplete ([Math]::Min(100, ($offset + 90) * 100 / $frameCount))
    }
    Write-Progress -Activity 'Rendering MV' -Completed
    $encoded = Join-Path $job 'encoded.mp4'
    $videoSeconds = ($frameCount / [double]$fps).ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture)
    $encodeArgs = @(
        '-hide_banner', '-loglevel', 'warning', '-stats', '-nostdin', '-n',
        '-framerate', $fps, '-start_number', 0, '-i', (Join-Path $job 'frame-%05d.png'),
        '-i', $music, '-map', '0:v:0', '-map', '1:a:0', '-t', $videoSeconds, '-af', 'apad',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', 18, '-pix_fmt', 'yuv420p',
        '-vf', 'scale=out_color_matrix=bt709', '-colorspace', 'bt709', '-color_primaries', 'bt709',
        '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', $encoded
    )
    & $ffmpeg @encodeArgs
    if ($LASTEXITCODE -ne 0) { throw 'MP4 encoding failed.' }
    [IO.File]::Copy($encoded, $dest, $false)
    Write-Output "Saved $dest"
} finally {
    $env:NODE_PATH = $priorNodePath
    $actualJob = (Resolve-Path -LiteralPath $job).ProviderPath
    if (([IO.Path]::GetFileName($actualJob) -eq $jobName) -and
        ([IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($actualJob)).TrimEnd('\') -eq $tempRoot.TrimEnd('\'))) {
        Remove-Item -LiteralPath $actualJob -Recurse -Force
    }
}

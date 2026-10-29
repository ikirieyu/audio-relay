Add-Type -AssemblyName System.Drawing

$root = Resolve-Path "."
$srcPath = Join-Path $root "AudioRelay Wireless Logo.png"

if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found: $srcPath"
    exit 1
}

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$bgColor = [System.Drawing.Color]::FromArgb(255, 12, 19, 30) # #0C131E

Write-Host "Source image loaded: $($src.Width)x$($src.Height)"

# Helper functions
function Resize-Image($source, $width, $height) {
    $dest = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($source, 0, 0, $width, $height)
    $g.Dispose()
    return $dest
}

function Create-Round-Image($source, $size) {
    $dest = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $g.SetClip($path)
    $g.DrawImage($source, 0, 0, $size, $size)
    $path.Dispose()
    $g.Dispose()
    return $dest
}

function Create-Adaptive-Foreground($source, $canvasSize, $logoSize) {
    $dest = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $offset = [int](($canvasSize - $logoSize) / 2)
    $g.DrawImage($source, $offset, $offset, $logoSize, $logoSize)
    $g.Dispose()
    return $dest
}

function Create-Splash($source, $width, $height) {
    $dest = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear($bgColor)
    
    $minDim = [Math]::Min($width, $height)
    $logoSize = [int]($minDim * 0.40)
    if ($logoSize -gt 500) { $logoSize = 500 }
    if ($logoSize -lt 120) { $logoSize = 120 }
    
    $offsetX = [int](($width - $logoSize) / 2)
    $offsetY = [int](($height - $logoSize) / 2)
    $g.DrawImage($source, $offsetX, $offsetY, $logoSize, $logoSize)
    $g.Dispose()
    return $dest
}

function Get-PngBytes($bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Desktop Assets (Windows .ico, icon.png, tray-icon.png)
# ─────────────────────────────────────────────────────────────────────────────
$desktopAssets = Join-Path $root "desktop\assets"
if (-not (Test-Path $desktopAssets)) {
    New-Item -ItemType Directory -Path $desktopAssets -Force | Out-Null
}

Write-Host "Generating Desktop assets..."

# Standard icon.png (512x512)
$icon512 = Resize-Image $src 512 512
$icon512.Save((Join-Path $desktopAssets "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$icon512.Dispose()

# Tray icon (32x32)
$tray = Resize-Image $src 32 32
$tray.Save((Join-Path $desktopAssets "tray-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$tray.Dispose()

# Multi-resolution ICO: 256, 128, 64, 48, 32, 16
$icoSizes = @(256, 128, 64, 48, 32, 16)
$pngBytesList = New-Object System.Collections.Generic.List[byte[]]

foreach ($s in $icoSizes) {
    $bmp = Resize-Image $src $s $s
    $bytes = Get-PngBytes $bmp
    $pngBytesList.Add($bytes)
    $bmp.Dispose()
}

$icoPath = Join-Path $desktopAssets "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

$count = $icoSizes.Length
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type 1 = Icon
$bw.Write([uint16]$count)

$dataOffset = 6 + (16 * $count)
for ($i = 0; $i -lt $count; $i++) {
    $size = $icoSizes[$i]
    $w = if ($size -ge 256) { 0 } else { $size }
    $h = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)   # Color count
    $bw.Write([byte]0)   # Reserved
    $bw.Write([uint16]1)  # Color planes
    $bw.Write([uint16]32) # Bits per pixel
    $len = $pngBytesList[$i].Length
    $bw.Write([uint32]$len)        # Bytes in resource
    $bw.Write([uint32]$dataOffset) # Image offset
    $dataOffset += $len
}

for ($i = 0; $i -lt $count; $i++) {
    $bw.Write($pngBytesList[$i])
}

$bw.Close()
$fs.Close()
Write-Host "Created $icoPath successfully!"

# Also copy to root build/ if needed by electron-builder default
$desktopBuild = Join-Path $root "desktop\build"
if (-not (Test-Path $desktopBuild)) {
    New-Item -ItemType Directory -Path $desktopBuild -Force | Out-Null
}
Copy-Item $icoPath (Join-Path $desktopBuild "icon.ico") -Force
Copy-Item (Join-Path $desktopAssets "icon.png") (Join-Path $desktopBuild "icon.png") -Force

# ─────────────────────────────────────────────────────────────────────────────
# 2. Android Mipmap Icons
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "Generating Android mipmap icons..."
$androidRes = Join-Path $root "mobile\android\app\src\main\res"

$densities = @(
    @{ name = "mipmap-mdpi";    launcher = 48;  fgCanvas = 108; fgLogo = 72 },
    @{ name = "mipmap-hdpi";    launcher = 72;  fgCanvas = 162; fgLogo = 108 },
    @{ name = "mipmap-xhdpi";   launcher = 96;  fgCanvas = 216; fgLogo = 144 },
    @{ name = "mipmap-xxhdpi";  launcher = 144; fgCanvas = 324; fgLogo = 216 },
    @{ name = "mipmap-xxxhdpi"; launcher = 192; fgCanvas = 432; fgLogo = 288 }
)

foreach ($d in $densities) {
    $folder = Join-Path $androidRes $d.name
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }

    # ic_launcher.png
    $launcher = Resize-Image $src $d.launcher $d.launcher
    $launcher.Save((Join-Path $folder "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $launcher.Dispose()

    # ic_launcher_round.png
    $round = Create-Round-Image $src $d.launcher
    $round.Save((Join-Path $folder "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $round.Dispose()

    # ic_launcher_foreground.png
    $fg = Create-Adaptive-Foreground $src $d.fgCanvas $d.fgLogo
    $fg.Save((Join-Path $folder "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()
    
    Write-Host "  Updated $($d.name)"
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. Android Splash Screens
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "Generating Android splash screens..."

$splashes = @(
    @{ folder = "drawable";               w = 480;  h = 320 },
    @{ folder = "drawable-land-hdpi";      w = 800;  h = 480 },
    @{ folder = "drawable-land-mdpi";      w = 480;  h = 320 },
    @{ folder = "drawable-land-xhdpi";     w = 1280; h = 720 },
    @{ folder = "drawable-land-xxhdpi";    w = 1600; h = 960 },
    @{ folder = "drawable-land-xxxhdpi";   w = 1920; h = 1280 },
    @{ folder = "drawable-port-hdpi";      w = 480;  h = 800 },
    @{ folder = "drawable-port-mdpi";      w = 320;  h = 480 },
    @{ folder = "drawable-port-xhdpi";     w = 720;  h = 1280 },
    @{ folder = "drawable-port-xxhdpi";    w = 960;  h = 1600 },
    @{ folder = "drawable-port-xxxhdpi";   w = 1280; h = 1920 }
)

foreach ($sp in $splashes) {
    $folder = Join-Path $androidRes $sp.folder
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
    $splashBmp = Create-Splash $src $sp.w $sp.h
    $splashBmp.Save((Join-Path $folder "splash.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $splashBmp.Dispose()
    Write-Host "  Updated $($sp.folder)/splash.png ($($sp.w)x$($sp.h))"
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. Web UI Logo Assets
# ─────────────────────────────────────────────────────────────────────────────
# Mobile web public logo
$mobilePublic = Join-Path $root "mobile\public"
if (-not (Test-Path $mobilePublic)) {
    New-Item -ItemType Directory -Path $mobilePublic -Force | Out-Null
}
$webLogo192 = Resize-Image $src 192 192
$webLogo192.Save((Join-Path $mobilePublic "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$webLogo192.Dispose()

$src.Dispose()
Write-Host "All assets generated successfully!"

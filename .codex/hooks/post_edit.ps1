# DirtyBirds PostToolUse hook: syntax-check edited JS/Python, then mirror the
# file into the live ComfyUI custom_nodes install.
#
# Reads the hook JSON from stdin, acts only on files inside this repo.
# Exit 2 + stderr on a syntax error so Claude sees and fixes it.

$ErrorActionPreference = "Stop"

$repo    = "C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse"
$install = "C:\Users\mpick\ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\DirtyBirds-Playhouse"

$raw = [Console]::In.ReadToEnd()
try { $data = $raw | ConvertFrom-Json } catch { exit 0 }

$fp = $data.tool_input.file_path
if (-not $fp -or -not (Test-Path $fp)) { exit 0 }

$full = (Resolve-Path $fp).Path
# Only handle files inside the dev repo.
if (-not $full.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { exit 0 }
# Never act on files under .claude/ itself.
if ($full -like "*\.claude\*") { exit 0 }

$ext = [System.IO.Path]::GetExtension($full).ToLower()

# ── Syntax check ──────────────────────────────────────────────────────────
if ($ext -eq ".js") {
    $out = & node --check $full 2>&1
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("JS syntax error in $full`n$out")
        exit 2
    }
} elseif ($ext -eq ".py") {
    $out = & python -m py_compile $full 2>&1
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("Python syntax error in $full`n$out")
        exit 2
    }
}

# ── Mirror into the live install ──────────────────────────────────────────
$rel  = $full.Substring($repo.Length).TrimStart('\')
$dest = Join-Path $install $rel
$destDir = Split-Path $dest -Parent
if (-not (Test-Path $install)) { exit 0 }   # install not present; skip silently
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
Copy-Item -Path $full -Destination $dest -Force

if ($ext -eq ".py") {
    Write-Output "Synced $rel -> install. Restart the ComfyUI server (Python change)."
} else {
    Write-Output "Synced $rel -> install. Hard-reload the browser (JS/CSS change)."
}
exit 0

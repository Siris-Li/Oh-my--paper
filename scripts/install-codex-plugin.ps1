$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$manager = Join-Path $scriptDir "manage-codex-plugin.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node is required to run this installer."
}

& node $manager install @args

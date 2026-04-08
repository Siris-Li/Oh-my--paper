#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to run this installer." >&2
  exit 1
fi

node "$SCRIPT_DIR/manage-codex-plugin.mjs" install "$@"

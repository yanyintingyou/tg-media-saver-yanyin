#!/usr/bin/env bash
#
# Copies the single source of truth (src/content.js) into the extension folder.
# Run after editing src/content.js, then reload the unpacked extension in Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cp src/content.js extension/content.js
echo "  ✓ extension/content.js"

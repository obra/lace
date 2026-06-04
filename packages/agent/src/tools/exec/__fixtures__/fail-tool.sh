#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"fail","description":"x","inputSchema":{"type":"object","properties":{}}}'; exit 0; fi
echo "boom" >&2; exit 3

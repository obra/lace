#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"envdump","description":"x","inputSchema":{"type":"object","properties":{}}}'; exit 0; fi
env; exit 0

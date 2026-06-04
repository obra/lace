#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"slow","description":"x","inputSchema":{"type":"object","properties":{}}}'; exit 0; fi
sleep 30

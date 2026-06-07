#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"context-dump","description":"echoes the received context block","inputSchema":{"type":"object","properties":{}},"capabilities":["credentials"]}'; exit 0; fi
if [ "${1:-}" = "lace-tool-invoke" ]; then
  p="$(cat)"
  # Extract the context object verbatim and return it as the content string.
  ctx="$(printf '%s' "$p" | sed -n 's/.*"context":\({.*}\)}$/\1/p')"
  printf '{"content":%s}' "$ctx"; exit 0; fi
echo "unknown subcommand" >&2; exit 2

#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'; exit 0; fi
if [ "${1:-}" = "lace-tool-invoke" ]; then
  p="$(cat)"; msg="$(printf '%s' "$p" | sed -n 's/.*"msg":"\([^"]*\)".*/\1/p')"
  persona="$(printf '%s' "$p" | sed -n 's/.*"persona":"\([^"]*\)".*/\1/p')"
  printf '{"content":"echo:%s persona:%s"}' "$msg" "$persona"; exit 0; fi
echo "unknown subcommand" >&2; exit 2

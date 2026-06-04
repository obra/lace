#!/usr/bin/env bash
# ABOUTME: Fixture — valid exec tool for discover tests
# Drain stdin to avoid EPIPE when caller sends empty string
cat > /dev/null
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"valid","description":"a valid test tool","inputSchema":{"type":"object","properties":{}}}'; exit 0; fi
if [ "${1:-}" = "lace-tool-invoke" ]; then
  printf '{"content":"ok"}'; exit 0; fi
exit 0

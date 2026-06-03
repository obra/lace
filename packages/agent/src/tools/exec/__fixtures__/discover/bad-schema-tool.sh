#!/usr/bin/env bash
# ABOUTME: Fixture — outputs invalid schema JSON (missing required fields) for discover tests
# Drain stdin to avoid EPIPE when caller sends empty string
cat > /dev/null
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"not_a_valid_schema":true}'; exit 0; fi
exit 0

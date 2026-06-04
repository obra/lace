#!/usr/bin/env node
// ABOUTME: Reference exec-tool fixture — used by the whole-system integration test.
// Implements the two-command protocol: lace-tool-schema and lace-tool-invoke.
/* global process */

const cmd = process.argv[2];

if (cmd === 'lace-tool-schema') {
  process.stdout.write(
    JSON.stringify({
      name: 'echo-tool',
      description: 'Echoes the input back as content (reference fixture)',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: [] },
    }) + '\n'
  );
  process.exit(0);
} else if (cmd === 'lace-tool-invoke') {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let message = '';
    try {
      const payload = JSON.parse(raw);
      message = String(payload?.input?.message ?? '');
    } catch {
      // ignore parse errors — echo empty
    }
    process.stdout.write(JSON.stringify({ content: message }) + '\n');
    process.exit(0);
  });
} else {
  process.stderr.write(`echo-tool: unknown command: ${cmd ?? '(none)'}\n`);
  process.exit(1);
}

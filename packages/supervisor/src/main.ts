/* eslint-disable no-console -- CLI process */

import { parseArgs } from 'node:util';
import { createSupervisorServer } from './http/server';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '0' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
lace-supervisor

Usage: node dist/main.js [--host 127.0.0.1] [--port 0]

Requires: LACE_DIR environment variable
`);
  process.exit(0);
}

const laceDir = process.env.LACE_DIR;
if (!laceDir) {
  console.error('Missing LACE_DIR');
  process.exit(1);
}

const port = Number(values.port);
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  console.error(`Invalid port: ${values.port}`);
  process.exit(1);
}

const server = createSupervisorServer({ storeDir: laceDir, host: values.host, port });

server
  .listen()
  .then(({ baseUrl, port: actualPort }) => {
    console.log(`SUPERVISOR_SERVER_URL:${baseUrl}`);
    console.log(`SUPERVISOR_SERVER_PORT:${actualPort}`);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

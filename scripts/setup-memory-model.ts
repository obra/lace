// ABOUTME: Explicit installation of Lace's fixed public text-encoder assets; runtime never downloads.
import { mkdir, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import {
  MEMORY_MODEL,
  memoryModelDirectory,
  verifyMemoryModel,
} from '../packages/agent/src/memory/encoder';

const directory = memoryModelDirectory();
const staging = `${directory}.install-${randomUUID()}`;
try {
  for (const asset of MEMORY_MODEL.assets) {
    const file = join(staging, asset.name);
    await mkdir(dirname(file), { recursive: true });
    const response = await fetch(asset.url);
    if (!response.ok || !response.body)
      throw new Error(`Model asset download failed: ${asset.name} (${response.status})`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx' }));
  }
  await verifyMemoryModel(staging);
  await mkdir(dirname(directory), { recursive: true });
  await rename(staging, directory);
  console.log(`Verified local memory model installed at ${directory}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

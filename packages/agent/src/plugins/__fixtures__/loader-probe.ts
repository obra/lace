// ABOUTME: Probe — runs the loader like main.ts does and prints contributed persona entry names
// ABOUTME: Used by plugin-subagent-reach.test.ts to verify env-inherited LACE_PLUGINS loads in a child process
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadPlugins, personaDirs } from '../index';
async function main(): Promise<void> {
  await loadPlugins(process.env.LACE_PLUGINS);
  const entries: string[] = [];
  for (const { dir } of personaDirs()) {
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.md')) entries.push(path.basename(file, '.md'));
      }
    }
  }
  process.stdout.write(entries.join(',') + '\n');
}
void main();

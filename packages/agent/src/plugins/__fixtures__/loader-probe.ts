// ABOUTME: Probe — runs the loader like main.ts does and prints registered persona names
// ABOUTME: Used by plugin-subagent-reach.test.ts to verify env-inherited LACE_PLUGINS loads in a child process
import { loadPlugins, registries } from '../index';
async function main(): Promise<void> {
  await loadPlugins(process.env.LACE_PLUGINS);
  process.stdout.write(registries.personas.names().join(',') + '\n');
}
void main();

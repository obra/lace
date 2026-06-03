// ABOUTME: Fixture — well-formed plugin with meta + manifest, registers a persona
import type { PluginApi } from '../api';
export const meta = { name: 'good', namespace: 'good', version: '1.2.3' };
export const manifest = { capabilities: [] as const };
export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.personas.register('fixture-persona', {
    config: { runtime: { type: 'root' } },
    body: 'hi',
  } as never);
}

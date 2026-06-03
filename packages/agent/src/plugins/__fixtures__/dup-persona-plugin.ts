// ABOUTME: Fixture — registers the same persona name as good-plugin (dup→fatal)
import type { PluginApi } from '../api';
export const meta = { name: 'dup', namespace: 'dup', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.personas.register('fixture-persona', {
    config: { runtime: { type: 'root' } },
    body: 'x',
  } as never);
}

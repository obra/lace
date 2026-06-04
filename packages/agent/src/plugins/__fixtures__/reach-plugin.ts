// ABOUTME: Fixture — reach plugin that registers a reach-persona; used by the subagent-reach e2e test
import type { PluginApi } from '../api';
export const meta = { name: 'reach', namespace: 'reach', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.personas.register('reach-persona', {
    config: { runtime: { type: 'root' } },
    body: 'reached',
  } as never);
}

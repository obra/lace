import type { PluginApi } from '../api';
export const meta = { name: 'boom', namespace: 'boom', version: '1.0.0' };
export function register(_api: PluginApi): void {
  throw new Error('boom during register');
}

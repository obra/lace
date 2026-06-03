import type { PluginApi } from '../api';
export const meta = { name: 'skew', namespace: 'skew', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.assertVersion(999);
}

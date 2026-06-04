// ABOUTME: Fixture — plugin with an invalid namespace (contains /); used to test namespace validation
import type { PluginApi } from '../api';
export const meta = { name: 'bad-namespace', namespace: '@scope/pkg', version: '1.0.0' };
export function register(_api: PluginApi): void {
  /* never reached */
}

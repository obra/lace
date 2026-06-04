// ABOUTME: Fixture — declares the credentials capability
import type { PluginApi } from '../api';
export const meta = { name: 'creds', namespace: 'creds', version: '1.0.0' };
export const manifest = { capabilities: ['credentials' as const] };
export function register(_api: PluginApi): void {
  /* registers nothing for this test */
}

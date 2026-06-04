// ABOUTME: Fixture — reach plugin that contributes a reach-persona dir; used by the subagent-reach e2e test
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { PluginApi } from '../api';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const meta = { name: 'reach', namespace: 'reach', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.personas.addDir(path.join(moduleDir, 'reach-plugin-personas'));
}

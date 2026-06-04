// ABOUTME: Verifies that createToolExecutorForMode injects persona tools into toolsForProvider
// before the advertised tool list is materialised, so runtime executor and provider match.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { PersonaRegistry } from './config/persona-registry';
import { createToolExecutorForMode } from './server';

/**
 * Build a temp directory structured as a user-personas path with a persona
 * that has one exec tool. Returns the userPersonasPath and the tool name.
 */
function makePersonaWithTool(personaName: string, toolName: string): { userPersonasPath: string } {
  const userPersonasPath = mkdtempSync(join(tmpdir(), 'persona-exec-test-'));

  // Persona file (minimal, no frontmatter needed for this test)
  writeFileSync(join(userPersonasPath, `${personaName}.md`), `# ${personaName}\n`);

  // Tools directory: <userPersonasPath>/<personaName>/tools/<toolName>.mjs
  const toolsDir = join(userPersonasPath, personaName, 'tools');
  mkdirSync(toolsDir, { recursive: true });

  const toolScript = join(toolsDir, `${toolName}.mjs`);
  // Minimal exec-tool script: responds to lace-tool-schema probe
  writeFileSync(
    toolScript,
    `#!/usr/bin/env node\nif (process.argv[2] === 'lace-tool-schema') ` +
      `process.stdout.write(JSON.stringify({name:"${toolName}",description:"d",inputSchema:{type:"object"}}));`
  );
  chmodSync(toolScript, 0o755);

  return { userPersonasPath };
}

describe('createToolExecutorForMode persona tool injection', () => {
  beforeEach(() => {
    resetRegistriesForTest();
    registerBuiltinTools();
  });

  it('includes persona tool in toolsForProvider when activePersona is given', async () => {
    const personaName = 'scout';
    const toolName = 'scout-helper';
    const { userPersonasPath } = makePersonaWithTool(personaName, toolName);

    const registry = new PersonaRegistry({
      bundledPersonasPath: join(userPersonasPath, '__nonexistent__'), // no bundled in test
      userPersonasPaths: [userPersonasPath],
    });

    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined, // mcpServerManager
      undefined, // jobManager
      undefined, // skillRegistry
      undefined, // toolScope
      registry,
      personaName
    );

    const names = toolsForProvider.map((t) => t.name);
    expect(names).toContain(toolName);
  });

  it('does NOT include persona tool in toolsForProvider when no activePersona is given', async () => {
    const personaName = 'scout';
    const toolName = 'scout-helper';
    const { userPersonasPath } = makePersonaWithTool(personaName, toolName);

    const registry = new PersonaRegistry({
      bundledPersonasPath: join(userPersonasPath, '__nonexistent__'),
      userPersonasPaths: [userPersonasPath],
    });

    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined, // mcpServerManager
      undefined, // jobManager
      undefined, // skillRegistry
      undefined, // toolScope
      registry
      // no activePersona
    );

    const names = toolsForProvider.map((t) => t.name);
    expect(names).not.toContain(toolName);
  });

  it('persona tool is present in both executor and toolsForProvider — they agree', async () => {
    const personaName = 'scout';
    const toolName = 'scout-unique-tool';
    const { userPersonasPath } = makePersonaWithTool(personaName, toolName);

    const registry = new PersonaRegistry({
      bundledPersonasPath: join(userPersonasPath, '__nonexistent__'),
      userPersonasPaths: [userPersonasPath],
    });

    const { executor, toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
      personaName
    );

    // Both the runtime executor and the advertised list must agree.
    expect(executor.getTool(toolName)).toBeDefined();
    expect(toolsForProvider.map((t) => t.name)).toContain(toolName);
  });
});

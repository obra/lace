// ABOUTME: Regression guard — a persona's declared MCP servers must survive
// ABOUTME: session/resume, so a resumed subagent keeps tools like the browser.

import { describe, it, expect } from 'vitest';
import { applyEmbedderMcpServers } from '@lace/agent/rpc/session-config';

/**
 * A browser-user subagent declares its browser MCP server in persona
 * frontmatter, so the stored entry is `source: 'embedder'`. `subagent-job.ts`
 * resumes with `mcpServers: []`, and `applyEmbedderMcpServers` treats the
 * embedder's list as authoritative — which drops the persona's server.
 *
 * Observed live: a resumed browser-user's tool count fell 10 -> 9 with
 * `superpowers-chrome_use_browser` gone, while the model (seeing successful
 * browser calls in its own history) kept trying to call it and got
 * tool-not-found. The browser PROFILE survives on disk; only the tool is lost.
 */
describe('applyEmbedderMcpServers — persona servers across resume', () => {
  const personaServer = {
    name: 'superpowers-chrome',
    command: 'node',
    args: ['/opt/superpowers-chrome/mcp/dist/index.js', '--headed'],
    placement: 'toolRuntime' as const,
    source: 'persona' as const,
  };

  it('keeps a persona-owned server when the embedder resumes with an empty list', () => {
    const merged = applyEmbedderMcpServers([personaServer], []);

    expect(merged.map((s) => s.name)).toContain('superpowers-chrome');
  });

  it('keeps a persona-owned server alongside embedder servers', () => {
    const merged = applyEmbedderMcpServers(
      [personaServer, { name: 'gone', command: 'x', source: 'embedder' as const }],
      [{ name: 'fresh', command: 'y' }]
    );
    const names = merged.map((s) => s.name);

    expect(names).toContain('superpowers-chrome');
    expect(names).toContain('fresh');
    // Still drops a since-deleted embedder server — the behaviour this
    // function was written to guarantee.
    expect(names).not.toContain('gone');
  });

  it('lets an embedder server of the same name win over the persona default', () => {
    const merged = applyEmbedderMcpServers(
      [personaServer],
      [{ name: 'superpowers-chrome', command: 'override' }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.command).toBe('override');
  });
});

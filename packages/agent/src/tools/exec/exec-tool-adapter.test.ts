import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { ExecToolAdapter } from './exec-tool-adapter';
import { parseExecToolDescriptor } from './descriptor';
import type { ToolContext } from '@lace/agent/tools/types';
const FIX = path.join(__dirname, '__fixtures__');
const echo = parseExecToolDescriptor(
  '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'
);
const credDescriptor = parseExecToolDescriptor(
  '{"name":"context-dump","description":"echoes the received context block","inputSchema":{"type":"object","properties":{}},"capabilities":["credentials"]}'
);
const plainDescriptor = parseExecToolDescriptor(
  '{"name":"context-dump","description":"echoes the received context block","inputSchema":{"type":"object","properties":{}}}'
);
const DUMP = path.join(FIX, 'context-dump-tool.sh');
async function dumpedContext(
  adapter: ExecToolAdapter,
  c: ToolContext
): Promise<Record<string, unknown>> {
  const r = await adapter.execute({}, c);
  expect(r.status).toBe('completed');
  return JSON.parse(r.content[0].text as string) as Record<string, unknown>;
}
const ctx = (o: Partial<ToolContext> = {}): ToolContext => ({
  signal: new AbortController().signal,
  activeSessionId: 'sess',
  persona: 'researcher',
  ...o,
});
describe('ExecToolAdapter', () => {
  it('exposes descriptor name/description/schema (required defaults to [])', () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echo);
    expect(t.name).toBe('echo');
    expect(t.inputSchema.type).toBe('object');
    expect(Array.isArray(t.inputSchema.required)).toBe(true);
  });
  it('builds the context block server-side (persona from ctx, not args) and maps stdout', async () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echo);
    const r = await t.execute({ msg: 'hi', persona: 'attacker' }, ctx());
    expect(r.status).toBe('completed');
    expect(r.content[0].text).toContain('echo:hi');
    expect(r.content[0].text).toContain('persona:researcher');
  });
  it('forwards the broker socket only for a trusted credentials tool', async () => {
    const SOCK = '/run/host/sen-cred-role.sock';
    // Trusted provenance + capabilities:['credentials'] → socket forwarded.
    const trusted = new ExecToolAdapter(DUMP, credDescriptor, undefined, true);
    expect(
      (await dumpedContext(trusted, ctx({ credentialBrokerSocket: SOCK }))).credentialBrokerSocket
    ).toBe(SOCK);
    // Same descriptor, UNtrusted provenance → socket absent.
    const untrusted = new ExecToolAdapter(DUMP, credDescriptor, undefined, false);
    expect(
      (await dumpedContext(untrusted, ctx({ credentialBrokerSocket: SOCK }))).credentialBrokerSocket
    ).toBeUndefined();
    // Trusted provenance but no credentials capability → socket absent.
    const plain = new ExecToolAdapter(DUMP, plainDescriptor, undefined, true);
    expect(
      (await dumpedContext(plain, ctx({ credentialBrokerSocket: SOCK }))).credentialBrokerSocket
    ).toBeUndefined();
  });
  it('maps non-zero exit to failed', async () => {
    const fail = parseExecToolDescriptor(
      '{"name":"fail","description":"x","inputSchema":{"type":"object","properties":{}}}'
    );
    expect(
      (await new ExecToolAdapter(path.join(FIX, 'fail-tool.sh'), fail).execute({}, ctx())).status
    ).toBe('failed');
  });
  it('maps abort to aborted', async () => {
    const slow = parseExecToolDescriptor(
      '{"name":"slow","description":"x","inputSchema":{"type":"object","properties":{}}}'
    );
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    expect(
      (
        await new ExecToolAdapter(path.join(FIX, 'slow-tool.sh'), slow).execute(
          {},
          ctx({ signal: ac.signal })
        )
      ).status
    ).toBe('aborted');
  });
});

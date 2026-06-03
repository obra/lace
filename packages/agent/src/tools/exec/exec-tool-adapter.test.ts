import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { ExecToolAdapter } from './exec-tool-adapter';
import { parseExecToolDescriptor } from './descriptor';
import type { ToolContext } from '@lace/agent/tools/types';
const FIX = path.join(__dirname, '__fixtures__');
const echo = parseExecToolDescriptor(
  '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'
);
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

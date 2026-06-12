// ABOUTME: The exec-tool schema descriptor (output of `<bin> lace-tool-schema`)
import { z } from 'zod';
import type { Capability } from '@lace/agent/plugins';

export class ExecToolDescriptorError extends Error {
  constructor(m: string) {
    super(m);
    this.name = 'ExecToolDescriptorError';
  }
}
const schema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.object({ type: z.literal('object') }).passthrough(),
    capabilities: z.array(z.enum(['credentials'])).optional(),
  })
  .strict();

export interface ExecToolDescriptor {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  capabilities?: Capability[];
}
export function parseExecToolDescriptor(raw: string): ExecToolDescriptor {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ExecToolDescriptorError(`not JSON: ${raw.slice(0, 200)}`);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new ExecToolDescriptorError(`invalid descriptor: ${r.error.message}`);
  const inputSchema = r.data.inputSchema as Record<string, unknown>;
  for (const key of ['oneOf', 'allOf', 'anyOf', 'if']) {
    if (Object.prototype.hasOwnProperty.call(inputSchema, key)) {
      throw new ExecToolDescriptorError(
        `inputSchema must not use top-level oneOf/allOf/anyOf/if (the Anthropic tool API rejects them; express per-variant requirements in field descriptions): found ${key}`
      );
    }
  }
  return r.data as ExecToolDescriptor;
}

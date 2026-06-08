// ABOUTME: ExecToolAdapter — a one-shot executable behind the Tool interface
// ABOUTME: lace builds the unforgeable context block; lace does NO input validation (binary validates)
import { z, ZodType } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext, ToolInputSchema } from '@lace/agent/tools/types';
import { runExecToolProcess } from './run-once';
import type { ExecToolDescriptor } from './descriptor';

let inFlight = 0;
const MAX = 16;
const waiters: Array<() => void> = [];
async function acquire() {
  if (inFlight < MAX) {
    inFlight++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  inFlight++;
}
function release() {
  inFlight--;
  waiters.shift()?.();
}
const resultSchema = z
  .object({
    content: z.union([z.string(), z.record(z.unknown())]).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export class ExecToolAdapter extends Tool {
  name: string;
  description: string;
  schema: ZodType;
  constructor(
    private binPath: string,
    private descriptor: ExecToolDescriptor,
    nameOverride?: string,
    private trustedCredentialProvenance = false
  ) {
    super();
    this.name = nameOverride ?? descriptor.name;
    this.description = descriptor.description;
    this.schema = z.object({}).passthrough(); // lace does not validate; the binary is the source of truth
  }
  // Advertise the binary's JSON Schema to the model; default properties:{} and required:[]
  // so a descriptor omitting either field still yields a structurally-complete ToolInputSchema.
  get inputSchema(): ToolInputSchema {
    return {
      ...this.descriptor.inputSchema,
      properties: this.descriptor.inputSchema.properties ?? {},
      required: this.descriptor.inputSchema.required ?? [],
    } as ToolInputSchema;
  }
  protected async executeValidated(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    // The capabilities flag is self-declared by the binary, so directory
    // provenance is the real control: forward the broker socket only when the
    // tool was discovered from the host-only credential dir AND it declares the
    // credentials capability.
    const allowCredentialSocket =
      this.trustedCredentialProvenance &&
      (this.descriptor.capabilities?.includes('credentials') ?? false);
    const payload = JSON.stringify({
      input: args,
      context: {
        sessionId: context.activeSessionId ?? '',
        persona: context.persona ?? '',
        ...(allowCredentialSocket && context.credentialBrokerSocket
          ? {
              role: context.persona ?? '',
              credentialBrokerSocket: context.credentialBrokerSocket,
              // The role's spawn environment (Part B): the broker binds a minted
              // placeholder to it. Forwarded with the broker socket under the
              // same provenance gate.
              environment: context.roleEnvironment ?? '',
            }
          : {}),
      },
    });
    await acquire();
    try {
      const res = await runExecToolProcess(this.binPath, ['lace-tool-invoke'], {
        stdin: payload,
        cwd: context.workingDirectory ?? context.toolTempDir ?? process.cwd(),
        timeoutMs: context.timeoutMs ?? 120_000,
        signal: context.signal,
      });
      if (res.aborted) return this.createCancellationResult(res.stdout || undefined);
      if (res.timedOut) return this.createError(`exec tool "${this.name}" timed out`);
      if (res.exitCode !== 0)
        return this.createError(
          `exec tool "${this.name}" failed (exit ${res.exitCode}): ${res.stderr.trim()}`
        );
      const parsed = resultSchema.safeParse(safeJson(res.stdout));
      if (!parsed.success) return this.createResult(res.stdout.trim());
      return this.createResult(
        (parsed.data.content as string | Record<string, unknown> | undefined) ?? res.stdout.trim(),
        parsed.data.metadata as Record<string, unknown> | undefined
      );
    } finally {
      release();
    }
  }
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

import { spawn } from 'node:child_process';
import type { ToolInfo, ToolResult } from '../protocol/types';

export type ShellExecInput = {
  command: string;
  cwd?: string;
};

export const shellExecTool: ToolInfo = {
  name: 'shell.exec',
  description: 'Run a shell command',
  kind: 'execute',
  requiresPermission: true,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
    },
    required: ['command'],
  },
};

export async function runShellExec(
  input: ShellExecInput,
  options: { defaultCwd: string; signal?: AbortSignal }
): Promise<ToolResult> {
  const cwd = input.cwd || options.defaultCwd;

  return await new Promise<ToolResult>((resolve) => {
    const child = spawn(input.command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const abort = () => {
      child.kill('SIGTERM');
    };

    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }

    child.on('close', (code, signal) => {
      if (options.signal) options.signal.removeEventListener('abort', abort);

      if (options.signal?.aborted) {
        resolve({
          outcome: 'cancelled',
          content: [{ type: 'error', message: 'Cancelled' }],
          meta: { exitCode: code ?? null, signal },
        });
        return;
      }

      const exitCode = code ?? 0;
      if (exitCode === 0) {
        resolve({
          outcome: 'completed',
          content: [
            ...(stdout ? [{ type: 'text' as const, text: stdout }] : []),
            ...(stderr ? [{ type: 'text' as const, text: stderr }] : []),
          ],
          meta: { exitCode },
        });
      } else {
        resolve({
          outcome: 'failed',
          content: [
            { type: 'error', message: `Command failed with exit code ${exitCode}` },
            ...(stdout ? [{ type: 'text' as const, text: stdout }] : []),
            ...(stderr ? [{ type: 'text' as const, text: stderr }] : []),
          ],
          meta: { exitCode },
        });
      }
    });
  });
}

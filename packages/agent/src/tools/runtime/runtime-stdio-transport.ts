import type { RuntimeProcessHandle, ToolRuntime } from './types';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface RuntimeStdioClientTransportOptions {
  runtime: ToolRuntime;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

export class RuntimeStdioClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  private readonly readBuffer = new ReadBuffer();
  private process?: RuntimeProcessHandle;
  private closed = false;
  private exited = false;

  constructor(private readonly options: RuntimeStdioClientTransportOptions) {}

  async start(): Promise<void> {
    if (this.process) {
      throw new Error(
        'RuntimeStdioClientTransport already started! If using Client class, note that connect() calls start() automatically.'
      );
    }

    try {
      const handle = await this.options.runtime.process.start(
        [this.options.command, ...(this.options.args ?? [])],
        {
          cwd: this.options.cwd ?? this.options.runtime.cwd,
          env: this.options.env ?? {},
        }
      );
      this.process = handle;
      this.exited = false;
      this.closed = false;

      handle.stdin?.on('error', (error) => {
        this.onerror?.(error);
      });
      handle.stdout?.on('data', (chunk: Buffer) => {
        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });
      handle.stdout?.on('error', (error) => {
        this.onerror?.(error);
      });
      handle.stderr?.on('error', (error) => {
        this.onerror?.(error);
      });
      handle.completion
        .catch((error: unknown) => {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          this.exited = true;
          if (this.process === handle) {
            this.process = undefined;
          }
          this.notifyClosed();
        });
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.process?.stdin;
    if (!stdin) {
      throw new Error('Not connected');
    }

    const json = serializeMessage(message);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stdin.off('drain', onDrain);
        reject(error);
      };
      const onDrain = () => {
        stdin.off('error', onError);
        resolve();
      };

      stdin.once('error', onError);
      if (stdin.write(json)) {
        stdin.off('error', onError);
        resolve();
      } else {
        stdin.once('drain', onDrain);
      }
    });
  }

  async close(): Promise<void> {
    const processToClose = this.process;
    this.process = undefined;

    if (processToClose) {
      try {
        processToClose.stdin?.end();
      } catch {
        // Ignore shutdown races.
      }

      await Promise.race([processToClose.completion.catch(() => undefined), delay(500)]);
      if (!this.exited) {
        try {
          processToClose.kill('SIGTERM');
        } catch {
          // Ignore shutdown races.
        }
        await Promise.race([processToClose.completion.catch(() => undefined), delay(500)]);
      }
      if (!this.exited) {
        try {
          processToClose.kill('SIGKILL');
        } catch {
          // Ignore shutdown races.
        }
      }
    }

    this.readBuffer.clear();
    this.notifyClosed();
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private notifyClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

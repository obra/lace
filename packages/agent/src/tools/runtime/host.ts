import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  RuntimeFileSystem,
  RuntimeFetchOptions,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessOptions,
  RuntimeProcessRunner,
  ToolRuntime,
} from './types';

const execFileAsync = promisify(execFile);

interface ExecFileError extends Error {
  code?: string | number;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function outputToString(output: string | Buffer | undefined): string {
  if (output === undefined) return '';
  return typeof output === 'string' ? output : output.toString('utf8');
}

class HostPathService implements RuntimePathService {
  constructor(private readonly cwd: string) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = isAbsolute(inputPath) ? inputPath : resolve(this.cwd, inputPath);
    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return resolve(path.runtimePath);
  }
}

class HostFileSystem implements RuntimeFileSystem {
  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    const result = await stat(path.hostPath ?? path.runtimePath);
    return {
      type: result.isDirectory() ? 'directory' : 'file',
      size: result.size,
      mtime: result.mtime,
    };
  }

  async readTextFile(path: RuntimePath): Promise<string> {
    return await readFile(path.hostPath ?? path.runtimePath, 'utf8');
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
    await writeFile(path.hostPath ?? path.runtimePath, content, 'utf8');
  }

  async mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void> {
    await mkdir(path.hostPath ?? path.runtimePath, {
      recursive: opts?.recursive,
    });
  }

  async readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    const entries = await readdir(path.hostPath ?? path.runtimePath, {
      withFileTypes: true,
    });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
  }
}

class HostProcessRunner implements RuntimeProcessRunner {
  #cwd: string;
  #defaultEnv: NodeJS.ProcessEnv;

  constructor(cwd: string, defaultEnv?: NodeJS.ProcessEnv) {
    this.#cwd = cwd;
    this.#defaultEnv = defaultProcessEnv(defaultEnv);
  }

  private envFor(opts: RuntimeProcessOptions): NodeJS.ProcessEnv {
    if (opts.envMode === 'replace') {
      return { ...(opts.env ?? {}) };
    }
    return { ...this.#defaultEnv, ...(opts.env ?? {}) };
  }

  async exec(command: string[], opts: RuntimeProcessOptions = {}) {
    const [file, ...args] = command;
    if (!file) throw new Error('runtime process command is empty');
    try {
      const result = await execFileAsync(file, args, {
        cwd: opts.cwd ?? this.#cwd,
        env: this.envFor(opts),
        signal: opts.signal,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const execError = error as ExecFileError;
      if (typeof execError.code !== 'number') throw error;
      return {
        exitCode: execError.code,
        stdout: outputToString(execError.stdout),
        stderr: outputToString(execError.stderr),
      };
    }
  }

  async start(command: string[], opts: RuntimeProcessOptions = {}) {
    const [file, ...args] = command;
    if (!file) throw new Error('runtime process command is empty');
    const child = spawn(file, args, {
      cwd: opts.cwd ?? this.#cwd,
      env: this.envFor(opts),
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    return {
      pid: child.pid,
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      kill: (signal?: NodeJS.Signals) => child.kill(signal),
      completion: new Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>(
        (resolve, reject) => {
          child.on('error', reject);
          child.on('close', (exitCode, signal) =>
            resolve({ exitCode, signal: signal ?? undefined })
          );
        }
      ),
    };
  }
}

function defaultProcessEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return { ...process.env, ...env };
}

class HostNetworkClient implements RuntimeNetworkClient {
  async fetch(url: string, opts: RuntimeFetchOptions = {}) {
    const response = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      redirect: opts.redirect,
      signal: opts.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}

export class HostToolRuntime implements ToolRuntime {
  readonly kind = 'local' as const;
  readonly label = 'Host';
  readonly paths: RuntimePathService;
  readonly fs = new HostFileSystem();
  readonly process: RuntimeProcessRunner;
  readonly network = new HostNetworkClient();

  constructor(input: { id: string; cwd: string; env?: NodeJS.ProcessEnv }) {
    this.id = input.id;
    this.cwd = input.cwd;
    this.paths = new HostPathService(input.cwd);
    this.process = new HostProcessRunner(input.cwd, input.env);
  }

  readonly id: string;
  readonly cwd: string;
}

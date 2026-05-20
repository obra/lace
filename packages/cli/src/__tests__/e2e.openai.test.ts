import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

function readOpenAiKeyFromRepoEnv(): string | undefined {
  const envPath = resolve(__dirname, '../../../../.env');
  if (!existsSync(envPath)) return undefined;

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (key !== 'OPENAI_API_KEY') continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) return value;
  }
  return undefined;
}

const runOpenAiE2e = process.env.RUN_OPENAI_E2E === '1';
const openAiApiKey = runOpenAiE2e
  ? (process.env.OPENAI_API_KEY ?? readOpenAiKeyFromRepoEnv())
  : undefined;
const maybeIt = openAiApiKey ? it : it.skip;

type Spawned = {
  proc: ReturnType<typeof spawn>;
  lines: string[];
};

function spawnCli(options: { workDir: string; laceDir: string; openAiApiKey: string }): Spawned {
  const cliMain = resolve(__dirname, '../../dist/main.js');
  const agentMain = resolve(__dirname, '../../../agent/dist/main.js');

  const proc = spawn(
    process.execPath,
    [
      cliMain,
      '--workdir',
      options.workDir,
      '--timeout-ms',
      '60000',
      '--agent-cmd',
      `${process.execPath} ${agentMain}`,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        LACE_DIR: options.laceDir,
        OPENAI_API_KEY: options.openAiApiKey,
      },
    }
  );

  const lines: string[] = [];
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) lines.push(line);
    }
  });

  return { proc, lines };
}

function findJsonLine(lines: string[], predicate: (obj: any) => boolean): any | undefined {
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line);
      if (predicate(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return undefined;
}

describe('cli e2e (OpenAI, opt-in)', () => {
  maybeIt('configures an OpenAI connection and prompts the model', async () => {
    const base = await mkdtemp(resolve(tmpdir(), 'lace-cli-openai-test-'));
    const laceDir = resolve(base, 'lace-dir');
    const workDir = resolve(base, 'workdir');
    await mkdir(laceDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    const { proc, lines } = spawnCli({ workDir, laceDir, openAiApiKey });

    await waitFor(() => lines.some((l) => l.startsWith('new session ')), 20_000);
    const sessionId = lines.find((l) => l.startsWith('new session '))!.slice('new session '.length);

    proc.stdin.write(':raw {"method":"ent/providers/list","params":{}}\n');
    await waitFor(() => lines.some((l) => l.includes('"providers"')), 20_000);

    const providersRes = findJsonLine(lines, (obj) => Array.isArray(obj?.providers));
    expect(providersRes).toBeTruthy();
    const providers = providersRes.providers as Array<{ providerId: string; displayName: string }>;

    const openAiProvider = providers.find(
      (p) =>
        typeof p.providerId === 'string' &&
        (p.providerId.toLowerCase().includes('openai') ||
          p.displayName.toLowerCase().includes('openai'))
    );
    expect(openAiProvider).toBeTruthy();

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'ent/connections/upsert',
        params: {
          providerId: openAiProvider!.providerId,
          connection: { name: 'test', config: {} },
        },
      })}\n`
    );

    await waitFor(() => lines.some((l) => l.includes('"connectionId"')), 20_000);
    const upsertRes = findJsonLine(
      lines,
      (obj) => typeof obj?.connectionId === 'string' && typeof obj?.providerId === 'string'
    );
    expect(upsertRes).toBeTruthy();
    const connectionId = upsertRes.connectionId as string;

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'ent/connections/credentials/submit',
        params: { connectionId, values: { apiKey: openAiApiKey } },
      })}\n`
    );

    await waitFor(() => !!findJsonLine(lines, (obj) => obj?.ok === true), 20_000);

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'ent/connections/test',
        params: { connectionId },
      })}\n`
    );

    await waitFor(() => !!findJsonLine(lines, (obj) => obj?.ok === true), 30_000);

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'ent/models/list',
        params: { connectionId },
      })}\n`
    );

    await waitFor(() => lines.some((l) => l.includes('"models"')), 30_000);
    const modelsRes = findJsonLine(
      lines,
      (obj) => Array.isArray(obj?.models) && obj?.connectionId === connectionId
    );
    expect(modelsRes).toBeTruthy();
    const models = modelsRes.models as Array<{ modelId: string }>;
    expect(models.length).toBeGreaterThan(0);
    const modelId = models[0]!.modelId;

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'ent/session/configure',
        params: { connectionId },
      })}\n`
    );
    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'session/set_config_option',
        params: { sessionId, configId: 'model', value: modelId },
      })}\n`
    );
    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'session/set_config_option',
        params: { sessionId, configId: 'approvalMode', value: 'deny' },
      })}\n`
    );

    await waitFor(
      () => !!findJsonLine(lines, (obj) => obj?.result?.config?.connectionId === connectionId),
      20_000
    );
    await waitFor(
      () =>
        !!findJsonLine(lines, (obj) =>
          obj?.result?.configOptions?.some?.(
            (o: { id?: string; currentValue?: string }) =>
              o.id === 'model' && o.currentValue === modelId
          )
        ),
      20_000
    );
    await waitFor(
      () =>
        !!findJsonLine(lines, (obj) =>
          obj?.result?.configOptions?.some?.(
            (o: { id?: string; currentValue?: string }) =>
              o.id === 'approvalMode' && o.currentValue === 'deny'
          )
        ),
      20_000
    );

    proc.stdin.write(
      `:raw ${JSON.stringify({
        method: 'session/prompt',
        params: { content: [{ type: 'text', text: 'hi' }], maxTurns: 1 },
      })}\n`
    );

    await waitFor(
      () =>
        !!findJsonLine(
          lines,
          (obj) => obj?.stopReason === 'end_turn' && typeof obj?.turnId === 'string'
        ),
      60_000
    );

    proc.stdin.write(':exit\n');

    const exitCode = await new Promise<number>((resolveExit) => {
      proc.once('exit', (code) => resolveExit(code ?? 1));
    });

    expect(exitCode).toBe(0);
  });
});

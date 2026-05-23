#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { HelperRequest, HelperResponse } from './helper-protocol';

function readFirstLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const onData = (chunk: string) => {
      data += chunk;
      const newlineIndex = data.indexOf('\n');
      if (newlineIndex !== -1) {
        cleanup();
        resolve(data.slice(0, newlineIndex));
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(data);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

function fileTypeFromStats(stats: { isDirectory(): boolean }): 'file' | 'directory' {
  return stats.isDirectory() ? 'directory' : 'file';
}

function errorResponse(error: unknown): HelperResponse {
  if (error && typeof error === 'object') {
    const err = error as NodeJS.ErrnoException;
    return {
      ok: false,
      error: {
        code: err.code ?? 'ERROR',
        message: err.message ?? String(error),
      },
    };
  }
  return { ok: false, error: { code: 'ERROR', message: String(error) } };
}

async function handle(request: HelperRequest): Promise<unknown> {
  switch (request.op) {
    case 'stat': {
      const stats = await stat(request.path);
      return {
        type: fileTypeFromStats(stats),
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      };
    }
    case 'readTextFile':
      return await readFile(request.path, 'utf8');
    case 'writeTextFile':
      await writeFile(request.path, request.content, 'utf8');
      return null;
    case 'mkdir':
      await mkdir(request.path, { recursive: request.recursive });
      return null;
    case 'readdir': {
      const entries = await readdir(request.path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
    }
    case 'fetch': {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (request.maxBytes !== undefined && bytes.byteLength > request.maxBytes) {
        throw Object.assign(
          new Error(
            `Response size (${bytes.byteLength} bytes) exceeds maximum allowed size (${request.maxBytes} bytes)`
          ),
          { code: 'ERR_RESPONSE_TOO_LARGE' }
        );
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bytes.toString('base64'),
      };
    }
    default:
      throw Object.assign(new Error(`Unsupported helper op: ${(request as { op?: string }).op}`), {
        code: 'ERR_UNSUPPORTED_OP',
      });
  }
}

async function main(): Promise<void> {
  try {
    const line = await readFirstLine();
    const request = JSON.parse(line.trim()) as HelperRequest;
    const value = await handle(request);
    const response: HelperResponse = { ok: true, value };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorResponse(error))}\n`);
  }
  process.exit(0);
}

void main();

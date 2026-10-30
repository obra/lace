// ABOUTME: Incremental retained-event discovery and immutable committed-document reads.
import { open, readdir, stat, realpath } from 'node:fs/promises';
import { realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename, isAbsolute, relative, resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { isSessionId } from '@lace/ent-protocol';
import { agentSessionsDir, getSessionDir } from '../storage/session-store';
import { readAllSessionEventLines } from '../storage/event-log';
import { transcriptsRoot } from '../storage/transcript-paths';
import { getLaceDir } from '../config/lace-dir';
import { readToolResultOriginal } from '../storage/tool-result-store';
import type { ContentBlock } from '../providers/base-provider';
import type { MemoryNotes } from './notes';
import {
  MEMORY_LIMITS as L,
  type MemoryConfiguration,
  type Source,
  type SourceReference,
  type SuppliedSource,
} from './types';

const execute = promisify(execFile);
const EVENT_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
async function git(root: string, args: string[], maxBuffer = L.sourceBytes + 1): Promise<string> {
  return (await execute('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer })).stdout;
}
function eventContent(
  line: string,
  ref: Extract<SourceReference, { kind: 'event' }>
): ContentBlock[] {
  const event = JSON.parse(line) as { type: string; eventSeq: number; data: any };
  if (event.eventSeq !== ref.eventSeq) throw new Error('Source event replaced');
  const data = event.data;
  if (event.type === 'tool_use') {
    if (data?.name === 'recall') return [];
    if (!data?.result || data.result.outcome !== 'completed') return [];
    const blocks: ContentBlock[] = [
      { type: 'text', text: `tool=${data.name}\ninput=${JSON.stringify(data.input)}` },
    ];
    let spilled = false;
    for (const block of data.result.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        if (block.text.includes('bytes elided of') && block.text.includes('read_tool_result(')) {
          if (!spilled) {
            const full = readToolResultOriginal(ref.sessionId, data.toolCallId, L.sourceBytes);
            blocks.push({ type: 'text', text: full });
            spilled = true;
          }
        } else blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'image')
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: block.mediaType, data: block.data },
        });
      else throw new Error('Unsupported tool result input');
    }
    return blocks;
  }
  if (!['prompt', 'message', 'context_injected'].includes(event.type)) return [];
  if (typeof data?.content === 'string')
    return [
      {
        type: 'text',
        text: `Transcript event type=${event.type}; session=${ref.sessionId}; seq=${ref.eventSeq}\n${data.content}`,
      },
    ];
  if (!Array.isArray(data?.content)) throw new Error('Missing event input');
  return [
    {
      type: 'text',
      text: `Transcript event type=${event.type}; session=${ref.sessionId}; seq=${ref.eventSeq}`,
    },
    ...data.content.map((block: any) => {
      if (
        block?.type === 'image' &&
        typeof block.data === 'string' &&
        typeof block.mediaType === 'string'
      )
        return {
          type: 'image',
          source: { type: 'base64', media_type: block.mediaType, data: block.data },
        };
      return block;
    }),
  ] as ContentBlock[];
}
function retainedLine(ref: Extract<SourceReference, { kind: 'event' }>): string {
  try {
    return locatedLine(ref);
  } catch {
    for (const line of readAllSessionEventLines(getSessionDir(ref.sessionId))) {
      try {
        if ((JSON.parse(line) as { eventSeq: number }).eventSeq === ref.eventSeq) return line;
      } catch {
        /* Skip partial lines. */
      }
    }
    throw new Error('Missing retained event input');
  }
}
function locatedLine(ref: Extract<SourceReference, { kind: 'event' }>): string {
  if (ref.bytes > EVENT_BYTES) throw new Error('Oversize event input');
  const fd = openSync(ref.file, 'r');
  try {
    const buffer = Buffer.alloc(ref.bytes);
    if (readSync(fd, buffer, 0, buffer.length, ref.offset) !== ref.bytes)
      throw new Error('Missing event input');
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}
function supplied(source: Source, content: ContentBlock[], images: boolean): SuppliedSource {
  let textBytes = 0;
  let imageBytes = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string')
      textBytes += Buffer.byteLength(block.text);
    else if (
      block.type === 'image' &&
      imageTypes.has(block.source?.media_type) &&
      typeof block.source.data === 'string'
    ) {
      if (!images) throw new Error('Unsupported image input for configured model');
      imageBytes += Buffer.byteLength(block.source.data, 'base64');
    } else throw new Error('Unsupported source input');
  }
  if (textBytes > L.sourceBytes || imageBytes > L.imageBytes)
    throw new Error('Oversize source input');
  return { ...source, content, textBytes, imageBytes };
}

export class MemorySources {
  private documentCommit?: string;
  constructor(
    private notes: MemoryNotes,
    private configuration: MemoryConfiguration
  ) {}
  async documents(): Promise<void> {
    const config = this.configuration.documentSources;
    if (!config) return;
    const root = await realpath(config.gitRoot);
    if ((await git(root, ['rev-parse', '--show-toplevel'])).trim() !== root)
      throw new Error('Memory document gitRoot must identify its repository root');
    const commit = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (commit === this.documentCommit) return;
    // Literal pathspecs prevent host configuration from accidentally widening discovery.
    const listing = await git(
      root,
      ['ls-tree', '-rz', '--full-tree', commit, '--', ...config.paths.map((p) => `:(literal)${p}`)],
      4 * 1024 * 1024
    );
    const heads = new Map<string, string>();
    for (const entry of listing.split('\0').filter(Boolean)) {
      const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (!match) continue;
      const path = match[3];
      if (config.extensions && !config.extensions.some((extension) => path.endsWith(extension)))
        continue;
      const blob = match[2];
      heads.set(path, blob);
    }
    this.notes.write(() => this.notes.db.prepare('UPDATE memory_documents SET version=NULL').run());
    const entries = [...heads];
    for (let offset = 0; offset < entries.length; offset += 128) {
      this.notes.write(() => {
        for (const [path, blob] of entries.slice(offset, offset + 128)) {
          this.notes.discover({
            id: `document:${path}`,
            version: blob,
            reference: { kind: 'document', gitRoot: root, path, commit, blob },
          });
          this.notes.db
            .prepare('INSERT OR REPLACE INTO memory_documents(path,version) VALUES(?,?)')
            .run(path, blob);
        }
      });
      await yieldTurn();
    }
    this.documentCommit = commit;
  }
  async discover(): Promise<void> {
    await this.documents();
    const files: string[] = [];
    const legacy = agentSessionsDir();
    for (const entry of await readdir(legacy, { withFileTypes: true }))
      if (entry.isDirectory() && isSessionId(entry.name))
        files.push(join(legacy, entry.name, 'events.jsonl'));
    const root = transcriptsRoot(getLaceDir());
    async function walk(dir: string, depth: number): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && depth > 0) await walk(join(dir, entry.name), depth - 1);
        else if (
          entry.isFile() &&
          entry.name.endsWith('.jsonl') &&
          isSessionId(entry.name.slice(0, -6))
        )
          files.push(join(dir, entry.name));
      }
      await yieldTurn();
    }
    await walk(root, 2);
    for (const file of files) {
      let info;
      try {
        info = await stat(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const identity = `${info.dev}:${info.ino}`;
      const cursor = this.notes.db
        .prepare('SELECT identity,offset FROM memory_scan WHERE file=?')
        .get(file) as { identity: string; offset: number } | undefined;
      let offset = cursor?.identity === identity && cursor.offset <= info.size ? cursor.offset : 0;
      const handle = await open(file, 'r');
      try {
        while (offset < info.size) {
          let buffer = Buffer.alloc(Math.min(L.discoveryBytes, info.size - offset));
          let count = (await handle.read(buffer, 0, buffer.length, offset)).bytesRead;
          let end = buffer.subarray(0, count).lastIndexOf(10);
          if (end < 0 && count === buffer.length && buffer.length < EVENT_BYTES) {
            buffer = Buffer.alloc(Math.min(EVENT_BYTES, info.size - offset));
            count = (await handle.read(buffer, 0, buffer.length, offset)).bytesRead;
            end = buffer.subarray(0, count).lastIndexOf(10);
          }
          if (end < 0) break; // Partial or oversized input remains unprocessed.
          let start = 0;
          while (start <= end) {
            const newline = buffer.indexOf(10, start);
            const line = buffer.subarray(start, newline).toString('utf8');
            try {
              const event = JSON.parse(line) as { eventSeq: number };
              if (Number.isSafeInteger(event.eventSeq) && event.eventSeq > 0) {
                const sessionId =
                  basename(file) === 'events.jsonl'
                    ? basename(resolve(file, '..'))
                    : basename(file, '.jsonl');
                const reference: Extract<SourceReference, { kind: 'event' }> = {
                  kind: 'event',
                  sessionId,
                  eventSeq: event.eventSeq,
                  file,
                  offset: offset + start,
                  bytes: newline - start,
                };
                const id = `event:${sessionId}:${event.eventSeq}`;
                try {
                  const content = eventContent(line, reference);
                  if (content.length)
                    this.notes.discover({ id, version: hash(JSON.stringify(content)), reference });
                } catch (error) {
                  const source = { id, version: hash(line), reference };
                  this.notes.discover(source);
                  this.notes.status(source, 'unavailable', String(error));
                }
              }
            } catch {
              /* Malformed retained lines are not successful extraction input. */
            }
            start = newline + 1;
          }
          offset += end + 1;
          this.notes.write(() =>
            this.notes.db
              .prepare('INSERT OR REPLACE INTO memory_scan VALUES(?,?,?)')
              .run(file, identity, offset)
          );
          await yieldTurn();
        }
      } finally {
        await handle.close();
      }
    }
  }
  async load(source: Source, images: boolean): Promise<SuppliedSource> {
    const ref = source.reference;
    const content: ContentBlock[] =
      ref.kind === 'document'
        ? [{ type: 'text', text: await git(ref.gitRoot, ['cat-file', 'blob', ref.blob]) }]
        : eventContent(retainedLine(ref), ref);
    if (
      !content.length ||
      (ref.kind === 'event' && hash(JSON.stringify(content)) !== source.version)
    )
      throw new Error('Source event unavailable or replaced');
    return supplied(source, content, images);
  }
  async status(source: Source): Promise<string> {
    try {
      if (source.reference.kind === 'document') {
        const ref = source.reference;
        const commit = (await git(ref.gitRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
        const current = (
          await git(ref.gitRoot, ['ls-tree', '-z', commit, '--', `:(literal)${ref.path}`])
        )
          .split('\t')[0]
          ?.split(' ')[2];
        if (!current) return 'missing';
        if (current !== ref.blob) return 'superseded';
      }
      await this.load(source, true);
      return 'current';
    } catch {
      return 'unavailable';
    }
  }
  validateAtAcceptance(expected: SuppliedSource[]): void {
    const commits = new Map<string, string>();
    for (const source of expected) {
      const ref = source.reference;
      let status = 'current';
      if (ref.kind === 'event') {
        if (hash(JSON.stringify(eventContent(retainedLine(ref), ref))) !== source.version)
          throw new Error('Retained source changed');
      } else {
        let commit = commits.get(ref.gitRoot);
        if (!commit) {
          commit = execFileSync(
            'git',
            ['-C', ref.gitRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
            { encoding: 'utf8' }
          ).trim();
          commits.set(ref.gitRoot, commit);
        }
        const entry = execFileSync(
          'git',
          ['-C', ref.gitRoot, 'ls-tree', '-z', commit, '--', `:(literal)${ref.path}`],
          { encoding: 'utf8', maxBuffer: 4096 }
        );
        const blob = entry.split('\t')[0]?.split(' ')[2];
        status = !blob ? 'missing' : blob !== ref.blob ? 'superseded' : 'current';
      }
      if (status !== source.sourceStatus) throw new Error('Source changed before acceptance');
    }
  }
  static validatePaths(configuration: MemoryConfiguration): void {
    const config = configuration.documentSources;
    if (!config) return;
    if (
      !isAbsolute(config.gitRoot) ||
      !config.paths.length ||
      config.paths.some(
        (p) =>
          isAbsolute(p) ||
          !p ||
          p.includes('\0') ||
          p.split(/[\\/]/).includes('..') ||
          relative(config.gitRoot, resolve(config.gitRoot, p)).startsWith('..')
      )
    )
      throw new Error('Memory document paths must stay within the configured Git root');
    // Opening configuration must prove the host-visible directory exists.
    const root = realpathSync(config.gitRoot);
    if (
      !statSync(root).isDirectory() ||
      execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
      }).trim() !== root
    )
      throw new Error('Memory document gitRoot must identify its repository root');
    config.gitRoot = root;
  }
}

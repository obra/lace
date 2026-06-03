// ABOUTME: file-outline-plugin — extracts a structural outline from TypeScript/JavaScript
// ABOUTME: source files: top-level functions, classes, interfaces, type aliases, and
// ABOUTME: exported const declarations. Useful for a coding agent to grasp file shape
// ABOUTME: without reading every line.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// Ships as a SEPARATE package from @lace/agent. Mark @lace/agent EXTERNAL in
// your bundler so there is exactly one registry instance.
// Type-only imports are erased at build time and are safe.
// The only value import from the kernel is the Tool base class (you extends it).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'file-outline',
  namespace: 'file-outline',
  version: '1.0.0',
};

// ── Outline extraction ────────────────────────────────────────────────────────

/** A single entry in the structural outline of a source file. */
interface OutlineEntry {
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';
  name: string;
  /** 1-based line number of the declaration */
  line: number;
  exported: boolean;
  /** For classes: names of direct public methods found in the body */
  methods?: string[];
}

/**
 * Extracts top-level declarations from TypeScript/JavaScript source text using
 * line-by-line regex matching. This is intentionally a lightweight, zero-dependency
 * approach — no AST parser — so it runs fast on large files and works on syntactically
 * partial source. It handles the most common declaration forms.
 */
function extractOutline(source: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const lines = source.split('\n');

  // Patterns for top-level declarations.
  // We match both exported and non-exported forms.
  const patterns: {
    kind: OutlineEntry['kind'];
    re: RegExp;
    nameGroup: number;
    exportGroup: number;
  }[] = [
    // function foo / export function foo / export async function foo / async function foo
    {
      kind: 'function',
      re: /^(export\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/,
      nameGroup: 3,
      exportGroup: 1,
    },
    // class Foo / export class Foo / export abstract class Foo / export default class Foo
    // Note: no suffix constraint after the name — the class may have `extends`, `implements`,
    // or generic parameters before the opening brace.
    {
      kind: 'class',
      re: /^(export\s+)?(abstract\s+|default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
      nameGroup: 3,
      exportGroup: 1,
    },
    // interface Foo / export interface Foo
    {
      kind: 'interface',
      re: /^(export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[{<]/,
      nameGroup: 2,
      exportGroup: 1,
    },
    // type Foo = / export type Foo =
    {
      kind: 'type',
      re: /^(export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=<]/,
      nameGroup: 2,
      exportGroup: 1,
    },
    // enum Foo / export enum Foo / export const enum Foo
    {
      kind: 'enum',
      re: /^(export\s+)?(const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\{/,
      nameGroup: 3,
      exportGroup: 1,
    },
    // export const FOO = / export const foo: Type = (skip non-exported — too noisy)
    {
      kind: 'const',
      re: /^(export\s+)const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=:]/,
      nameGroup: 2,
      exportGroup: 1,
    },
  ];

  // Method pattern used inside class bodies (public/protected/private, async, static)
  const methodRe =
    /^\s+(public|protected|private)?\s*(static\s+)?(async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;

  let insideClass: OutlineEntry | null = null;
  let braceDepth = 0;
  let classStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Track brace depth to know when a class body ends.
    // We do a simple character-count scan (ignoring strings/comments — good enough
    // for the common case; does not handle multi-line strings or comments perfectly).
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (insideClass !== null) {
      // We're inside a class body — look for methods.
      // Check the depth BEFORE adding this line's braces so that method signature
      // lines (which often have a trailing `{`) are correctly recognized as
      // being at the direct class-body level.
      const depthBeforeLine = braceDepth;
      braceDepth += opens - closes;
      if (braceDepth <= classStartDepth) {
        // Exited the class body.
        insideClass = null;
      } else if (depthBeforeLine === classStartDepth + 1) {
        // Line starts at the direct class body level — scan for method signatures.
        const m = methodRe.exec(line);
        if (m) {
          const methodName = m[4];
          // Skip constructor; avoid keywords accidentally captured.
          if (methodName && methodName !== 'constructor') {
            insideClass.methods ??= [];
            if (!insideClass.methods.includes(methodName)) {
              insideClass.methods.push(methodName);
            }
          }
        }
      }
      // Don't try to match top-level declarations while inside a class.
      continue;
    }

    // Not inside a class — look for top-level declarations.
    braceDepth += opens - closes;

    for (const { kind, re, nameGroup, exportGroup } of patterns) {
      const m = re.exec(line);
      if (!m) continue;

      const name = m[nameGroup];
      const exported = Boolean(m[exportGroup]);

      if (!name) continue;

      const entry: OutlineEntry = { kind, name, line: lineNo, exported };

      if (kind === 'class') {
        // Start tracking the class body for methods.
        // braceDepth already includes this line's opens, so subtract them to get
        // the depth before this line (the "floor" the class body sits above).
        insideClass = entry;
        classStartDepth = braceDepth - opens;
      }

      entries.push(entry);
      break; // Only one pattern can match per line.
    }
  }

  return entries;
}

// ── Supported extensions ─────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isSupportedExtension(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

// ── Tool ─────────────────────────────────────────────────────────────────────

class FileOutlineTool extends Tool {
  name = 'file-outline/outline';
  description =
    'Extracts a structural outline of a TypeScript or JavaScript source file: ' +
    'top-level functions, classes (with their public methods), interfaces, type aliases, ' +
    'enums, and exported constants. Returns line numbers and export status. ' +
    "Useful for understanding a file's shape without reading every line.";

  schema = z.object({
    path: z
      .string()
      .min(1)
      .describe('Absolute or working-directory-relative path to the source file to outline.'),
    exported_only: z
      .boolean()
      .optional()
      .describe(
        'When true, include only exported declarations. Default: false (include all top-level).'
      ),
  });

  protected async executeValidated(
    args: { path: string; exported_only?: boolean },
    ctx: ToolContext
  ): Promise<ToolResult> {
    // Resolve the path against the working directory when relative.
    const base = ctx.workingDirectory ?? process.cwd();
    const resolvedPath = resolve(base, args.path);

    const ext = extname(resolvedPath);
    if (!isSupportedExtension(ext)) {
      return this.createError(
        `Unsupported file type '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`
      );
    }

    let source: string;
    try {
      source = await readFile(resolvedPath, 'utf8');
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return this.createError(`File not found: ${resolvedPath}`);
      }
      if (nodeErr.code === 'EACCES') {
        return this.createError(`Permission denied: ${resolvedPath}`);
      }
      return this.createError(`Failed to read file: ${nodeErr.message}`);
    }

    let entries = extractOutline(source);

    if (args.exported_only === true) {
      entries = entries.filter((e) => e.exported);
    }

    if (entries.length === 0) {
      return this.createResult(
        JSON.stringify({
          path: resolvedPath,
          entries: [],
          note: 'No top-level declarations found (or none matching the filter).',
        })
      );
    }

    return this.createResult(
      JSON.stringify({
        path: resolvedPath,
        total: entries.length,
        entries,
      })
    );
  }
}

// ── register ─────────────────────────────────────────────────────────────────

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('file-outline/outline', new FileOutlineTool());
}

export default { meta, register } satisfies PluginModule;

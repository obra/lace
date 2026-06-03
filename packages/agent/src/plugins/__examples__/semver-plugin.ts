// ABOUTME: semver-plugin — a SemVer 2.0.0 toolset for developer workflows.
// ABOUTME: Provides three tools under the 'semver' namespace:
// ABOUTME:   semver/parse   — parse a version string into its components
// ABOUTME:   semver/compare — compare two version strings (< | = | >)
// ABOUTME:   semver/bump    — increment a version by release type
// ABOUTME: All tools implement the full SemVer 2.0.0 spec including prerelease
// ABOUTME: ordering and build metadata. No network, no npm deps — stdlib only.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// Ships as a SEPARATE package from @lace/agent. Mark @lace/agent EXTERNAL in
// your bundler so there is exactly one registry instance.
// Type-only imports are erased at build time and are safe.
// The only value import from the kernel is the Tool base class (you extends it).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'semver',
  namespace: 'semver',
  version: '1.0.0',
};

// ── SemVer 2.0.0 parser ───────────────────────────────────────────────────────

/**
 * Parsed representation of a SemVer 2.0.0 version string.
 * https://semver.org/spec/v2.0.0.html
 */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, e.g. ["alpha","1"] for "1.0.0-alpha.1" */
  prerelease: string[];
  /** Dot-separated build-metadata identifiers — ignored in precedence comparisons */
  buildMetadata: string[];
  /** The canonical string form (without build metadata, which is excluded from precedence) */
  versionCore: string;
}

// SemVer regex per the spec. Capture groups:
//  1: major  2: minor  3: patch  4: prerelease (optional)  5: buildmeta (optional)
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function parse(raw: string): ParsedVersion | null {
  const m = SEMVER_RE.exec(raw.trim());
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = parseInt(m[3], 10);
  const prerelease = m[4] ? m[4].split('.') : [];
  const buildMetadata = m[5] ? m[5].split('.') : [];
  const versionCore =
    prerelease.length > 0 ? `${major}.${minor}.${patch}-${m[4]}` : `${major}.${minor}.${patch}`;
  return { major, minor, patch, prerelease, buildMetadata, versionCore };
}

// ── SemVer 2.0.0 comparator ───────────────────────────────────────────────────

/**
 * Compares two pre-release identifier arrays per SemVer 2.0.0 §11.4.
 * Returns -1 | 0 | 1.
 */
function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  // A version without pre-release has higher precedence than one with pre-release.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.length) return -1; // a has fewer identifiers → lower precedence
    if (i >= b.length) return 1;

    const ai = a[i];
    const bi = b[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);

    if (aNum && bNum) {
      // Both numeric: compare as integers
      const diff = parseInt(ai, 10) - parseInt(bi, 10);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum) {
      // Numeric < alphanumeric
      return -1;
    } else if (bNum) {
      return 1;
    } else {
      // Both alphanumeric: lexicographic
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return 0;
}

/**
 * Compares two parsed versions. Returns -1 | 0 | 1.
 * Build metadata is ignored (per spec §10).
 */
function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

// ── SemVer bumper ─────────────────────────────────────────────────────────────

type BumpType = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';

/**
 * Increments a parsed version by the given release type and returns the new
 * version string.
 *
 * - major/minor/patch: standard release bumps; clears pre-release.
 * - premajor/preminor/prepatch: bumps the corresponding numeric field and
 *   starts a pre-release with the given identifier (default 0).
 * - prerelease: if already on a pre-release with the same identifier, increments
 *   its trailing numeric part; otherwise starts a new pre-release on the same
 *   patch position.
 */
function bump(v: ParsedVersion, type: BumpType, prereleaseId: string): string {
  let { major, minor, patch, prerelease } = v;

  switch (type) {
    case 'major':
      // If already at a pre-release on a fresh major, just strip pre-release.
      if (minor === 0 && patch === 0 && prerelease.length > 0) {
        prerelease = [];
      } else {
        major++;
        minor = 0;
        patch = 0;
        prerelease = [];
      }
      break;

    case 'minor':
      if (patch === 0 && prerelease.length > 0) {
        prerelease = [];
      } else {
        minor++;
        patch = 0;
        prerelease = [];
      }
      break;

    case 'patch':
      if (prerelease.length > 0) {
        prerelease = [];
      } else {
        patch++;
        prerelease = [];
      }
      break;

    case 'premajor':
      major++;
      minor = 0;
      patch = 0;
      prerelease = [prereleaseId, '0'];
      break;

    case 'preminor':
      minor++;
      patch = 0;
      prerelease = [prereleaseId, '0'];
      break;

    case 'prepatch':
      patch++;
      prerelease = [prereleaseId, '0'];
      break;

    case 'prerelease': {
      if (prerelease.length > 0) {
        // If the last identifier is numeric, increment it; otherwise append '.0'.
        const last = prerelease[prerelease.length - 1];
        if (/^\d+$/.test(last)) {
          prerelease = [...prerelease.slice(0, -1), String(parseInt(last, 10) + 1)];
        } else {
          prerelease = [...prerelease, '0'];
        }
      } else {
        patch++;
        prerelease = [prereleaseId, '0'];
      }
      break;
    }
  }

  const pre = prerelease.length > 0 ? `-${prerelease.join('.')}` : '';
  return `${major}.${minor}.${patch}${pre}`;
}

// ── Tool: semver/parse ────────────────────────────────────────────────────────

class SemverParseTool extends Tool {
  name = 'semver/parse';
  description =
    'Parses a SemVer 2.0.0 version string into its components: major, minor, patch, ' +
    'pre-release identifiers, and build metadata. Returns an error if the string is ' +
    'not a valid SemVer version. Useful for extracting structured data from version ' +
    'strings in package.json, lockfiles, or CI tag names.';

  schema = z.object({
    version: z
      .string()
      .min(1)
      .describe(
        'The version string to parse, e.g. "1.2.3", "2.0.0-alpha.1", "3.1.0-rc.2+build.42".'
      ),
  });

  protected async executeValidated(
    args: { version: string },
    _ctx: ToolContext
  ): Promise<ToolResult> {
    const parsed = parse(args.version);
    if (!parsed) {
      return this.createError(
        `"${args.version}" is not a valid SemVer 2.0.0 string. ` +
          `Expected the form MAJOR.MINOR.PATCH[-prerelease][+buildmeta] ` +
          `where each numeric part has no leading zeros.`
      );
    }

    return this.createResult(
      JSON.stringify({
        valid: true,
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch,
        prerelease: parsed.prerelease,
        buildMetadata: parsed.buildMetadata,
        isPrerelease: parsed.prerelease.length > 0,
        versionCore: parsed.versionCore,
      })
    );
  }
}

// ── Tool: semver/compare ──────────────────────────────────────────────────────

class SemverCompareTool extends Tool {
  name = 'semver/compare';
  description =
    'Compares two SemVer 2.0.0 version strings and returns their ordering relationship. ' +
    'Result is -1 (a < b), 0 (a == b), or 1 (a > b). Pre-release ordering follows the ' +
    'SemVer spec (numeric identifiers compared as integers; a release version is always ' +
    'greater than any pre-release of the same triple). Build metadata is ignored in the ' +
    'comparison. Useful for checking whether a dependency upgrade is a major, minor, or ' +
    'patch bump, or for sorting a list of release tags.';

  schema = z.object({
    a: z.string().min(1).describe('The first version string to compare.'),
    b: z.string().min(1).describe('The second version string to compare.'),
  });

  protected async executeValidated(
    args: { a: string; b: string },
    _ctx: ToolContext
  ): Promise<ToolResult> {
    const pa = parse(args.a);
    if (!pa) {
      return this.createError(`"${args.a}" is not a valid SemVer 2.0.0 string.`);
    }
    const pb = parse(args.b);
    if (!pb) {
      return this.createError(`"${args.b}" is not a valid SemVer 2.0.0 string.`);
    }

    const result = compareVersions(pa, pb);
    const relationship = result === -1 ? 'a < b' : result === 1 ? 'a > b' : 'a == b';

    return this.createResult(
      JSON.stringify({
        result,
        relationship,
        a: args.a,
        b: args.b,
      })
    );
  }
}

// ── Tool: semver/bump ─────────────────────────────────────────────────────────

class SemverBumpTool extends Tool {
  name = 'semver/bump';
  description =
    'Increments a SemVer 2.0.0 version string by a release type and returns the next ' +
    'version string. Release types: major (breaking change), minor (new feature), ' +
    'patch (bug fix), premajor/preminor/prepatch (start a pre-release series), ' +
    'prerelease (increment an existing pre-release or start one on patch). ' +
    'Build metadata from the input is always stripped in the output (it is non-normative). ' +
    'Useful for computing the next release version in a CI pipeline or changelog tool.';

  schema = z.object({
    version: z.string().min(1).describe('The current version string to increment.'),
    type: z
      .enum(['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'])
      .describe('The release type to apply.'),
    prerelease_id: z
      .string()
      .optional()
      .describe(
        'Identifier to use for pre-release bumps (premajor/preminor/prepatch/prerelease). ' +
          'Defaults to "0" if omitted. Example: "alpha", "rc", "beta".'
      ),
  });

  protected async executeValidated(
    args: { version: string; type: BumpType; prerelease_id?: string },
    _ctx: ToolContext
  ): Promise<ToolResult> {
    const parsed = parse(args.version);
    if (!parsed) {
      return this.createError(`"${args.version}" is not a valid SemVer 2.0.0 string.`);
    }

    const prereleaseId = args.prerelease_id ?? '0';
    const next = bump(parsed, args.type, prereleaseId);

    return this.createResult(
      JSON.stringify({
        from: args.version,
        type: args.type,
        to: next,
      })
    );
  }
}

// ── register ──────────────────────────────────────────────────────────────────

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('semver/parse', new SemverParseTool());
  api.tools.register('semver/compare', new SemverCompareTool());
  api.tools.register('semver/bump', new SemverBumpTool());
}

export default { meta, register } satisfies PluginModule;

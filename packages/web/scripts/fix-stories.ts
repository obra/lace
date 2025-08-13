// ABOUTME: Utility to enforce coding guidelines on Storybook stories
// - Ensures each .stories.tsx starts with an ABOUTME comment
// - Rewrites import aliases from "@/" to "~/"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const STORIES_ROOT = path.join(ROOT, 'components');

function* walk(dir: string): Generator<string> {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      yield* walk(full);
    } else if (item.isFile() && full.endsWith('.stories.tsx')) {
      yield full;
    }
  }
}

function ensureAboutMe(content: string, filename: string): { updated: string; changed: boolean } {
  if (content.startsWith('// ABOUTME:')) return { updated: content, changed: false };
  const header = `// ABOUTME: Storybook story for ${path.basename(filename)}\n`;
  return { updated: `${header}${content}`, changed: true };
}

function rewriteAliases(content: string): { updated: string; changed: boolean } {
  // Replace imports starting with "@/" to "~/"
  const replaced = content.replace(/from\s+['"]@\//g, "from '~/");
  return { updated: replaced, changed: replaced !== content };
}

function main() {
  const files = Array.from(walk(STORIES_ROOT));
  const report: { file: string; aboutme: boolean; alias: boolean }[] = [];

  for (const file of files) {
    const orig = fs.readFileSync(file, 'utf8');
    let next = orig;
    let aboutChanged = false;
    let aliasChanged = false;

    // ABOUTME header
    const about = ensureAboutMe(next, file);
    next = about.updated;
    aboutChanged = about.changed;

    // Alias rewrite
    const alias = rewriteAliases(next);
    next = alias.updated;
    aliasChanged = alias.changed;

    if (aboutChanged || aliasChanged) {
      fs.writeFileSync(file, next, 'utf8');
    }

    report.push({ file, aboutme: aboutChanged, alias: aliasChanged });
  }

  // Pretty print summary
  const changed = report.filter((r) => r.aboutme || r.alias);
  console.log(`Processed ${report.length} story files. Updated ${changed.length}.`);
  for (const r of changed) {
    const parts = [] as string[];
    if (r.aboutme) parts.push('ABOUTME');
    if (r.alias) parts.push('alias');
    console.log(`- ${path.relative(ROOT, r.file)} [${parts.join(', ')}]`);
  }
}

main();

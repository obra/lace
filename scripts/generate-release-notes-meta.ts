// ABOUTME: Generates release notes metadata (SHA hash) during build process
// ABOUTME: Creates packages/web/app/generated/release-notes-meta.json with hash and content

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ReleaseNotesMeta {
  hash: string;
  content: string;
  generatedAt: string;
}

function generateReleaseNotesMeta(): void {
  const rootDir = path.resolve(__dirname, '..');
  const releaseNotesPath = path.join(rootDir, 'RELEASE_NOTES.md');
  const outputDir = path.join(rootDir, 'packages/web/app/generated');
  const outputPath = path.join(outputDir, 'release-notes-meta.json');

  // Ensure RELEASE_NOTES.md exists
  if (!fs.existsSync(releaseNotesPath)) {
    console.error('RELEASE_NOTES.md not found at', releaseNotesPath);
    process.exit(1);
  }

  // Read the release notes content
  const content = fs.readFileSync(releaseNotesPath, 'utf-8');

  // Calculate SHA-256 hash of the content
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

  // Create metadata object
  const meta: ReleaseNotesMeta = {
    hash,
    content,
    generatedAt: new Date().toISOString(),
  };

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Write metadata file
  fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`Generated release notes metadata:`);
  console.log(`  Hash: ${hash}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Size: ${content.length} bytes`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateReleaseNotesMeta();
}

export { generateReleaseNotesMeta };

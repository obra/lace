// ABOUTME: Captures baseline persona renders for the PRI-1674 @path migration scenario test.
// ABOUTME: Renders each bundled persona with a fixed empty context and writes the bytes to disk.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TemplateEngine } from '../../../packages/agent/src/config/template-engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledPersonasDir = path.resolve(
  __dirname,
  '../../../packages/agent/config/agent-personas'
);
const outputDir = __dirname;

const personaFiles = fs
  .readdirSync(bundledPersonasDir)
  .filter((name) => name.endsWith('.md'));

const engine = new TemplateEngine([bundledPersonasDir]);

for (const file of personaFiles) {
  const rendered = engine.render(file, {});
  const outPath = path.join(outputDir, file);
  fs.writeFileSync(outPath, rendered);
  // eslint-disable-next-line no-console
  console.log(`wrote ${path.relative(process.cwd(), outPath)} (${rendered.length} bytes)`);
}

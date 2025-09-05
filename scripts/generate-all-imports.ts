// ABOUTME: Generate imports for all JSON and MD files that need embedding
// ABOUTME: Creates explicit imports that Bun needs for file embedding

import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';

// Central output directory for generated embed file
const OUTPUT_DIR = 'build/temp';

interface EmbeddedFile {
  importName: string;
  filePath: string;
  originalPath: string;
}

function scanForFiles(dirPath: string, extension: string, prefix: string): EmbeddedFile[] {
  const files: EmbeddedFile[] = [];
  let counter = 0;

  function scanDirectory(dir: string) {
    if (!existsSync(dir)) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.endsWith(extension)) {
        // Generate relative path from build/temp/ to the file
        const relativePath = relative('build/temp', fullPath).replace(/\\/g, '/');

        files.push({
          importName: `${prefix}${counter++}`,
          filePath: relativePath,
          originalPath: fullPath,
        });
      }
    }
  }

  scanDirectory(dirPath);
  return files;
}

function generateAllImports() {
  console.log('📁 Scanning for files to embed...');

  // Scan for JSON catalogs
  const jsonFiles = scanForFiles('packages/core/src/providers/catalog/data', '.json', 'catalog');
  console.log(`📋 Found ${jsonFiles.length} catalog files`);

  // Scan for MD personas
  const mdFiles = scanForFiles('packages/core/config/agent-personas', '.md', 'persona');
  console.log(`📄 Found ${mdFiles.length} persona files`);

  // Scan for client assets
  const clientAssetsRaw = scanForFiles('packages/web/build/client', '', 'asset');
  // Exclude .map files to reduce binary size
  const clientAssets = clientAssetsRaw.filter((file) => !file.originalPath.endsWith('.map'));
  console.log(
    `🎨 Found ${clientAssets.length} client asset files (${clientAssetsRaw.length - clientAssets.length} .map files excluded)`
  );

  const allFiles = [...jsonFiles, ...mdFiles, ...clientAssets];

  // Generate imports with file type for JSON and MD to ensure File objects in Bun.embeddedFiles
  const imports = allFiles
    .map((file) => `import ${file.importName} from './${file.filePath}' with { type: 'file' };`)
    .join('\n');

  const exportMap = allFiles
    .map((file) => `  '${file.originalPath}': ${file.importName},`)
    .join('\n');

  const generatedCode = `// ABOUTME: Auto-generated file imports for Bun embedding
// ABOUTME: Do not edit manually - regenerated on each build

${imports}

// Export map for debugging (optional)
export const embeddedFiles = {
${exportMap}
};

// Start the production server
import '../../packages/web/server-production';
`;

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputFile = join(OUTPUT_DIR, 'embed-all-files.ts');
  writeFileSync(outputFile, generatedCode);

  console.log(`✅ Generated ${outputFile} with ${allFiles.length} imports`);
  console.log(`   📋 ${jsonFiles.length} JSON catalogs`);
  console.log(`   📄 ${mdFiles.length} MD personas`);
  console.log(`   🎨 ${clientAssets.length} client assets`);
}

// CLI usage
const mainModuleHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === mainModuleHref) {
  try {
    generateAllImports();
  } catch (error: unknown) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    console.error('❌ Failed to generate imports:', msg);
    process.exit(1);
  }
}

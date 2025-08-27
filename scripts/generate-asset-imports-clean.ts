// ABOUTME: Generate imports for ALL React Router build assets using Bun's file loader
// ABOUTME: Creates imports that work with --loader flags instead of VFS hacks

import { readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative, posix } from 'path';

interface AssetFile {
  webPath: string; // URL path for serving (e.g., "/assets/main.js")
  filePath: string; // File system path for import
  importName: string; // Variable name for import
}

function generateAssetImports(buildClientDir: string, outputFile: string) {
  console.log('📁 Scanning React Router build for ALL assets...');

  const assets: AssetFile[] = [];
  let importCounter = 0;

  function scanDirectory(dir: string) {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else if (!entry.startsWith('.')) {
        // Skip hidden files
        // Convert file system path to web path
        const relativePath = relative(buildClientDir, fullPath);
        const webPath = '/' + posix.normalize(relativePath).replace(/\\/g, '/');

        assets.push({
          webPath,
          filePath: fullPath,
          importName: `asset${importCounter++}`,
        });
      }
    }
  }

  scanDirectory(buildClientDir);

  console.log(`📦 Found ${assets.length} assets to embed`);

  // Generate imports - these will be resolved by Bun's file loader
  const imports = assets
    .map((asset) => {
      // Use relative path from output file location
      const relativePath = relative(join(process.cwd(), 'scripts'), asset.filePath).replace(
        /\\/g,
        '/'
      );

      return `import ${asset.importName} from './${relativePath}' with { type: 'file' };`;
    })
    .join('\n');

  // Generate asset map for serving
  const assetMapEntries = assets
    .map((asset) => `  '${asset.webPath}': ${asset.importName},`)
    .join('\n');

  const generatedCode = `// ABOUTME: Generated React Router asset imports for embedding
// ABOUTME: Used with --loader flags to embed all client assets in executable

${imports}

export const assetMap: Record<string, string> = {
${assetMapEntries}
};

export const assetPaths = Object.keys(assetMap);

console.log(\`📦 Loaded \${assetPaths.length} embedded assets\`);
`;

  writeFileSync(outputFile, generatedCode);
  console.log(`✅ Generated ${outputFile} with ${assets.length} asset imports`);

  // Show some sample paths
  console.log('\n📋 Sample embedded assets:');
  assets.slice(0, 8).forEach((asset) => {
    console.log(`   ${asset.webPath}`);
  });

  if (assets.length > 8) {
    console.log(`   ... and ${assets.length - 8} more`);
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const buildClientDir = 'packages/web/build/client';
  const outputFile = 'scripts/generated-client-assets.ts';

  try {
    generateAssetImports(buildClientDir, outputFile);
  } catch (error) {
    console.error('❌ Failed to generate client asset imports:', error);
    process.exit(1);
  }
}

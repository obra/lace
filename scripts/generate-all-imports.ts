// ABOUTME: Generate imports for all JSON and MD files that need embedding
// ABOUTME: Creates explicit imports that Bun needs for file embedding

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';

interface EmbeddedFile {
  importName: string;
  filePath: string;
  originalPath: string;
}

function scanForFiles(dirPath: string, extension: string, prefix: string): EmbeddedFile[] {
  const files: EmbeddedFile[] = [];
  let counter = 0;

  function scanDirectory(dir: string) {
    const entries = readdirSync(dir);
    
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
          originalPath: fullPath
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
  
  // Scan for MD prompts  
  const mdFiles = scanForFiles('packages/core/src/config/prompts', '.md', 'prompt');
  console.log(`📄 Found ${mdFiles.length} prompt files`);
  
  const allFiles = [...jsonFiles, ...mdFiles];
  
  // Generate imports
  const imports = allFiles
    .map(file => `import ${file.importName} from './${file.filePath}' with { type: 'file' };`)
    .join('\n');
  
  const exportMap = allFiles
    .map(file => `  '${file.originalPath}': ${file.importName},`)
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
  mkdirSync('build/temp', { recursive: true });
  
  const outputFile = 'build/temp/embed-all-files.ts';
  writeFileSync(outputFile, generatedCode);
  
  console.log(`✅ Generated ${outputFile} with ${allFiles.length} imports`);
  console.log(`   📋 ${jsonFiles.length} JSON catalogs`);
  console.log(`   📄 ${mdFiles.length} MD prompts`);
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateAllImports();
  } catch (error) {
    console.error('❌ Failed to generate imports:', error);
    process.exit(1);
  }
}
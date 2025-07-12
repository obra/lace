#!/usr/bin/env node
// ABOUTME: Script to fix relative imports by adding back .js extensions  
// ABOUTME: Only affects relative imports (./file, ../file), not path aliases (~/file)

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { resolve } from 'path';

function addJsToRelativeImports(content) {
  // Regex to match relative import statements WITHOUT .js extensions
  // Matches: import ... from './file', import ... from '../file'
  // Does NOT match: import ... from '~/file' (path aliases)
  const relativeImportRegex = /(import\s+[^'"]*from\s+['"])(\.[^'"]*?)(['"])/g;
  const relativeExportRegex = /(export\s+[^'"]*from\s+['"])(\.[^'"]*?)(['"])/g;
  
  let result = content;
  
  // Only add .js if the import doesn't already have an extension
  result = result.replace(relativeImportRegex, (match, prefix, path, suffix) => {
    // Skip if path already has an extension or if it's not a relative path
    if (path.includes('.') && path.lastIndexOf('.') > path.lastIndexOf('/')) {
      return match; // Already has extension
    }
    return `${prefix}${path}.js${suffix}`;
  });
  
  result = result.replace(relativeExportRegex, (match, prefix, path, suffix) => {
    // Skip if path already has an extension or if it's not a relative path
    if (path.includes('.') && path.lastIndexOf('.') > path.lastIndexOf('/')) {
      return match; // Already has extension
    }
    return `${prefix}${path}.js${suffix}`;
  });
  
  return result;
}

function transformFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const transformed = addJsToRelativeImports(content);
    
    if (content !== transformed) {
      writeFileSync(filePath, transformed);
      console.log(`✓ Fixed: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Adding .js extensions to relative imports only...\n');
  
  // Find all TypeScript files in src directory
  const files = await glob('src/**/*.ts', { 
    ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'] 
  });
  
  let transformedCount = 0;
  
  for (const file of files) {
    const filePath = resolve(file);
    if (transformFile(filePath)) {
      transformedCount++;
    }
  }
  
  console.log(`\n✅ Fix complete!`);
  console.log(`📊 Files processed: ${files.length}`);
  console.log(`📝 Files fixed: ${transformedCount}`);
  
  if (transformedCount > 0) {
    console.log('\n🔍 Next steps:');
    console.log('   • Run: npm run lint');
    console.log('   • Run: npm test');
    console.log('   • Check that everything still works');
  }
}

main().catch(console.error);
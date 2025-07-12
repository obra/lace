#!/usr/bin/env node
// ABOUTME: Script to remove .js extensions from TypeScript import statements
// ABOUTME: Transforms both relative imports and ~ alias imports by removing .js extensions

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { resolve } from 'path';

function removeJsExtensions(content) {
  // Regex to match import statements with .js extensions
  // Handles: import ... from './file.js', import ... from '~/path/file.js'
  // Also handles: export ... from './file.js'
  const importRegex = /(import\s+[^'"]*from\s+['"])([^'"]*?)\.js(['"])/g;
  const exportRegex = /(export\s+[^'"]*from\s+['"])([^'"]*?)\.js(['"])/g;
  
  let result = content;
  result = result.replace(importRegex, '$1$2$3');
  result = result.replace(exportRegex, '$1$2$3');
  
  return result;
}

function transformFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const transformed = removeJsExtensions(content);
    
    if (content !== transformed) {
      writeFileSync(filePath, transformed);
      console.log(`✓ Transformed: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Removing .js extensions from TypeScript imports...\n');
  
  // Find all TypeScript files in src directory
  const files = await glob('src/**/*.ts*', { 
    ignore: ['**/*.d.ts']
  });
  
  let transformedCount = 0;
  
  for (const file of files) {
    const filePath = resolve(file);
    if (transformFile(filePath)) {
      transformedCount++;
    }
  }
  
  console.log(`\n✅ Transformation complete!`);
  console.log(`📊 Files processed: ${files.length}`);
  console.log(`📝 Files transformed: ${transformedCount}`);
  
  if (transformedCount > 0) {
    console.log('\n🔍 Next steps:');
    console.log('   • Run: npm run lint');
    console.log('   • Run: npm test');
    console.log('   • Check that everything still works');
  }
}

main().catch(console.error);

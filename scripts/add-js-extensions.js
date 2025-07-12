#!/usr/bin/env node
// ABOUTME: Script to add .js extensions to imports in compiled JavaScript files
// ABOUTME: Required for Node.js ES modules when TypeScript bundler resolution omits extensions

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { resolve } from 'path';

function addJsExtensions(content) {
  // Add .js to relative imports that don't already have an extension
  // Matches: import ... from './path', import ... from '../path'
  // Skips: imports with existing extensions, external modules
  const importRegex = /(import\s+[^'"]*from\s+['"])(\.[^'"]*?)(['"])/g;
  const exportRegex = /(export\s+[^'"]*from\s+['"])(\.[^'"]*?)(['"])/g;
  
  let result = content;
  
  result = result.replace(importRegex, (match, prefix, path, suffix) => {
    // Only add .js if the path doesn't already have an extension
    if (!path.includes('.')) {
      return prefix + path + '.js' + suffix;
    }
    return match;
  });
  
  result = result.replace(exportRegex, (match, prefix, path, suffix) => {
    // Only add .js if the path doesn't already have an extension
    if (!path.includes('.')) {
      return prefix + path + '.js' + suffix;
    }
    return match;
  });
  
  return result;
}

function processFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const transformed = addJsExtensions(content);
    
    if (content !== transformed) {
      writeFileSync(filePath, transformed);
      console.log(`✓ Added .js extensions: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🔧 Adding .js extensions to compiled JavaScript imports...\n');
  
  // Find all JavaScript files in dist directory
  const files = await glob('dist/**/*.js');
  
  let transformedCount = 0;
  
  for (const file of files) {
    const filePath = resolve(file);
    if (processFile(filePath)) {
      transformedCount++;
    }
  }
  
  console.log(`\n✅ Extension addition complete!`);
  console.log(`📊 Files processed: ${files.length}`);
  console.log(`📝 Files transformed: ${transformedCount}`);
}

main().catch(console.error);
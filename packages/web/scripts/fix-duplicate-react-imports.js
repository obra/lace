#!/usr/bin/env node

/**
 * Fix duplicate React imports caused by the React import script
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function fixDuplicateImports(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Find all React import lines
  const reactImportIndices = [];
  const reactImports = [];
  
  lines.forEach((line, index) => {
    if (line.trim().startsWith('import React')) {
      reactImportIndices.push(index);
      reactImports.push(line);
    }
  });
  
  // If we have multiple React imports, consolidate them
  if (reactImportIndices.length > 1) {
    console.log(`⚠️  Found ${reactImportIndices.length} React imports in ${path.basename(filePath)}`);
    
    // Keep the most comprehensive import (the one with destructuring if it exists)
    let bestImport = reactImports.find(imp => imp.includes('{')) || reactImports[0];
    
    // Remove all React import lines
    const filteredLines = lines.filter((line, index) => !reactImportIndices.includes(index));
    
    // Add the best import at the original position of the first import
    const firstImportIndex = reactImportIndices[0];
    filteredLines.splice(firstImportIndex, 0, bestImport);
    
    content = filteredLines.join('\n');
    fs.writeFileSync(filePath, content);
    
    console.log(`✅ Fixed duplicate React imports in ${path.basename(filePath)}`);
    return true;
  }
  
  return false;
}

function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  
  const files = fs.readdirSync(dirPath);
  let fixed = 0;
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      fixed += processDirectory(fullPath);
    } else if (file.endsWith('.tsx') && !file.includes('.test.') && !file.includes('.stories.')) {
      if (fixDuplicateImports(fullPath)) {
        fixed++;
      }
    }
  }
  
  return fixed;
}

console.log('🔄 Fixing duplicate React imports...\n');

const componentsDirs = [
  path.join(rootDir, 'components'),
  path.join(rootDir, 'app'),
];

let totalFixed = 0;
for (const dir of componentsDirs) {
  if (fs.existsSync(dir)) {
    const fixed = processDirectory(dir);
    totalFixed += fixed;
  }
}

console.log(`\n🎉 Fixed ${totalFixed} files with duplicate React imports`);
console.log('✅ All duplicate React imports should now be resolved');
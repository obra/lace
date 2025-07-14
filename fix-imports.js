#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function fixImportsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Fix relative imports that don't end with .js
  const fixedContent = content
    .replace(/from ['"](\.[^'"]*?)['"];/g, (match, importPath) => {
      if (importPath.endsWith('.js')) {
        return match; // Already has .js extension
      }
      return `from '${importPath}.js';`;
    })
    .replace(/import ['"](\.[^'"]*?)['"];/g, (match, importPath) => {
      if (importPath.endsWith('.js')) {
        return match; // Already has .js extension
      }
      return `import '${importPath}.js';`;
    });

  if (content !== fixedContent) {
    fs.writeFileSync(filePath, fixedContent, 'utf8');
    console.log(`Fixed imports in: ${filePath}`);
  }
}

function walkDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      walkDirectory(filePath);
    } else if (file.endsWith('.js')) {
      fixImportsInFile(filePath);
    }
  }
}

console.log('Fixing ES module imports in dist directory...');
walkDirectory('./dist');
console.log('Done!');
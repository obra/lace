#!/usr/bin/env node

/**
 * Quick script to add React imports to all UI components that need them
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function addReactImport(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if React is already imported
  if (content.includes("import React from 'react'") || content.includes('import * as React')) {
    return false;
  }
  
  // Check if file uses JSX (contains return statement with <)
  if (!content.includes('return (') && !content.includes('return <')) {
    return false;
  }
  
  // Add React import at the top
  const lines = content.split('\n');
  const firstImportIndex = lines.findIndex(line => line.startsWith('import '));
  
  if (firstImportIndex !== -1) {
    lines.splice(firstImportIndex, 0, "import React from 'react';");
  } else {
    // No imports found, add after 'use client' if it exists
    const clientIndex = lines.findIndex(line => line.includes("'use client'"));
    if (clientIndex !== -1) {
      lines.splice(clientIndex + 2, 0, "import React from 'react';");
    } else {
      lines.unshift("import React from 'react';", '');
    }
  }
  
  content = lines.join('\n');
  fs.writeFileSync(filePath, content);
  return true;
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
      processDirectory(fullPath);
    } else if (file.endsWith('.tsx') && !file.includes('.test.') && !file.includes('.stories.')) {
      if (addReactImport(fullPath)) {
        console.log(`✅ Added React import to ${file}`);
        fixed++;
      }
    }
  }
  
  return fixed;
}

console.log('🔄 Adding React imports to UI components...\n');

const componentsDirs = [
  path.join(rootDir, 'components/ui'),
  path.join(rootDir, 'components/chat'), 
  path.join(rootDir, 'components/layout'),
  path.join(rootDir, 'components/modals'),
  path.join(rootDir, 'components/feedback'),
  path.join(rootDir, 'components/files'),
  path.join(rootDir, 'components/timeline'),
  path.join(rootDir, 'components/pages'),
  path.join(rootDir, 'components/organisms'),
  path.join(rootDir, 'components/settings'),
];

let totalFixed = 0;
for (const dir of componentsDirs) {
  console.log(`Processing ${path.basename(dir)}/...`);
  const fixed = processDirectory(dir);
  if (fixed) {
    totalFixed += fixed;
  }
}

console.log(`\n🎉 Fixed ${totalFixed} components`);
console.log('✅ All UI components should now have React imports');
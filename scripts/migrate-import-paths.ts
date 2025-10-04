#!/usr/bin/env bun
// ABOUTME: Migrates import paths from ~/... and @/... to @lace/core/... and @lace/web/...
// ABOUTME: Preserves same-folder relative imports per ESLint configuration

import { Project, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface MigrationStats {
  filesProcessed: number;
  importsUpdated: number;
  sameFolderKept: number;
  errors: string[];
}

const stats: MigrationStats = {
  filesProcessed: 0,
  importsUpdated: 0,
  sameFolderKept: 0,
  errors: [],
};

function migratePackage(
  packagePath: string,
  oldPrefix: string,
  newPrefix: string,
  packageName: string
): void {
  console.log(`\n📦 Migrating ${packageName}...`);
  console.log(`   ${oldPrefix} → ${newPrefix}`);

  const tsConfigPath = path.join(packagePath, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    console.error(`❌ tsconfig.json not found at ${tsConfigPath}`);
    return;
  }

  const project = new Project({
    tsConfigFilePath: tsConfigPath,
  });

  const sourceFiles = project.getSourceFiles();
  console.log(`   Found ${sourceFiles.length} source files`);

  sourceFiles.forEach((sourceFile) => {
    const filePath = sourceFile.getFilePath();
    const fileDir = path.dirname(filePath);
    let fileModified = false;

    // Process import declarations
    sourceFile.getImportDeclarations().forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();

      // Only process imports with our old prefix
      if (!moduleSpecifier.startsWith(oldPrefix)) {
        return;
      }

      // Extract the path after the prefix
      const importPath = moduleSpecifier.slice(oldPrefix.length);

      // Determine if this is a same-folder import
      const absoluteImportPath = path.join(packagePath, 'src', importPath);
      const absoluteImportDir = path.dirname(absoluteImportPath);
      const isSameFolder = absoluteImportDir === fileDir;

      if (isSameFolder) {
        // Keep as relative import (same folder)
        const fileName = path.basename(importPath);
        importDecl.setModuleSpecifier(`./${fileName}`);
        stats.sameFolderKept++;
        fileModified = true;
      } else {
        // Convert to absolute package import
        const newModuleSpecifier = `${newPrefix}${importPath}`;
        importDecl.setModuleSpecifier(newModuleSpecifier);
        stats.importsUpdated++;
        fileModified = true;
      }
    });

    // Process export declarations
    sourceFile.getExportDeclarations().forEach((exportDecl) => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier || !moduleSpecifier.startsWith(oldPrefix)) {
        return;
      }

      const importPath = moduleSpecifier.slice(oldPrefix.length);
      const absoluteImportPath = path.join(packagePath, 'src', importPath);
      const absoluteImportDir = path.dirname(absoluteImportPath);
      const isSameFolder = absoluteImportDir === fileDir;

      if (isSameFolder) {
        const fileName = path.basename(importPath);
        exportDecl.setModuleSpecifier(`./${fileName}`);
        stats.sameFolderKept++;
        fileModified = true;
      } else {
        const newModuleSpecifier = `${newPrefix}${importPath}`;
        exportDecl.setModuleSpecifier(newModuleSpecifier);
        stats.importsUpdated++;
        fileModified = true;
      }
    });

    // Process inline import() types
    sourceFile.getDescendantsOfKind(SyntaxKind.ImportType).forEach((importType) => {
      const argument = importType.getArgument();
      if (!argument) return;

      // Get the string literal value without quotes
      const fullText = argument.getText().replace(/['"]/g, '');
      if (!fullText.startsWith(oldPrefix)) return;

      const importPath = fullText.slice(oldPrefix.length);
      const absoluteImportPath = path.join(packagePath, 'src', importPath);
      const absoluteImportDir = path.dirname(absoluteImportPath);
      const isSameFolder = absoluteImportDir === fileDir;

      if (isSameFolder) {
        const fileName = path.basename(importPath);
        importType.setArgument(`./${fileName}`);
        stats.sameFolderKept++;
        fileModified = true;
      } else {
        const newModuleSpecifier = `${newPrefix}${importPath}`;
        importType.setArgument(newModuleSpecifier);
        stats.importsUpdated++;
        fileModified = true;
      }
    });

    if (fileModified) {
      stats.filesProcessed++;
    }
  });

  // Save all changes
  console.log(`   Saving changes...`);
  project.saveSync();
}

function updateTsConfig(tsConfigPath: string, oldPrefix: string, newPrefix: string): void {
  console.log(`\n⚙️  Updating ${tsConfigPath}...`);

  const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'));

  if (!tsConfig.compilerOptions) {
    tsConfig.compilerOptions = {};
  }
  if (!tsConfig.compilerOptions.paths) {
    tsConfig.compilerOptions.paths = {};
  }

  // Remove old path mapping
  delete tsConfig.compilerOptions.paths[`${oldPrefix}*`];

  // Add new path mapping
  const srcPath = tsConfigPath.includes('packages/core')
    ? ['src/*']
    : tsConfigPath.includes('packages/web')
      ? ['./*']
      : ['src/*'];

  tsConfig.compilerOptions.paths[`${newPrefix}*`] = srcPath;

  fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2) + '\n');
  console.log(`   ✅ Updated paths configuration`);
}

function main(): void {
  console.log('🚀 Starting import path migration...\n');

  const rootDir = path.resolve(__dirname, '..');

  // Migrate packages/core
  migratePackage(path.join(rootDir, 'packages/core'), '~/', '@lace/core/', 'core');

  // Migrate packages/web
  migratePackage(path.join(rootDir, 'packages/web'), '@/', '@lace/web/', 'web');

  // Update tsconfig files
  updateTsConfig(path.join(rootDir, 'packages/core/tsconfig.json'), '~/', '@lace/core/');

  updateTsConfig(path.join(rootDir, 'packages/web/tsconfig.json'), '@/', '@lace/web/');

  // Print summary
  console.log('\n📊 Migration Summary:');
  console.log(`   Files modified: ${stats.filesProcessed}`);
  console.log(`   Imports updated to absolute: ${stats.importsUpdated}`);
  console.log(`   Same-folder imports kept relative: ${stats.sameFolderKept}`);

  if (stats.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    stats.errors.forEach((error) => console.log(`   ${error}`));
  } else {
    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Run: npm run lint:fix');
    console.log('   2. Run: npm run typecheck');
    console.log('   3. Run: npm test');
    console.log('   4. Review changes and commit');
  }
}

main();

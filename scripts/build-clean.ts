// ABOUTME: Clean Bun build script using asset loaders instead of ZIP/VFS complexity
// ABOUTME: Uses --loader flags to embed JSON/MD files as assets with no temp extraction

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BuildOptions {
  target?: string;
  name?: string;
  outdir?: string;
  sign?: boolean;
}

function parseArgs(): BuildOptions {
  const args = process.argv.slice(2);
  const options: BuildOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--target':
        options.target = args[++i];
        break;
      case '--name':
        options.name = args[++i];
        break;
      case '--outdir':
        options.outdir = args[++i];
        break;
      case '--sign':
        options.sign = true;
        break;
      case '--help':
        console.log(`
Usage: npm run build:clean [options]

Options:
  --target <target>    Bun target (default: bun-darwin-arm64)
  --name <name>        Output executable name (default: lace)
  --outdir <outdir>    Output directory (default: build)
  --sign               Sign and notarize the binary (macOS only)
  --help               Show this help

Examples:
  npm run build:clean
  npm run build:clean -- --target bun-linux-x64 --name lace-linux
  npm run build:clean -- --sign

This creates a fully standalone executable with:
- All React Router client assets embedded
- All JSON catalogs embedded as file assets
- All MD prompt templates embedded as file assets
- Zero runtime file system dependencies
- No ZIP extraction or temporary directories
`);
        process.exit(0);
    }
  }

  return options;
}

async function buildCleanExecutable(options: BuildOptions = {}) {
  const target = options.target || 'bun-darwin-arm64';
  const name = options.name || 'lace';
  const outdir = options.outdir || 'build';
  const sign = options.sign || false;

  console.log('🔨 Building clean standalone Lace executable...');
  console.log(`   🎯 Target: ${target}`);
  console.log(`   📝 Name: ${name}`);
  console.log(`   📁 Output: ${outdir}\n`);

  // Step 1: Always rebuild React Router to ensure fresh code
  console.log('1️⃣ Building fresh React Router...');
  if (existsSync('packages/web/build')) {
    execSync('rm -rf packages/web/build packages/web/.react-router', { stdio: 'pipe' });
  }
  execSync('npm run build --workspace=packages/web', { stdio: 'inherit' });
  console.log('✅ Fresh React Router build ready\n');

  // Step 2: Generate fresh client asset imports
  console.log('2️⃣ Generating client asset imports...');
  if (existsSync('build/temp')) {
    execSync('rm -rf build/temp', { stdio: 'pipe' });
  }
  execSync('bun scripts/generate-asset-imports-clean.ts', { stdio: 'inherit' });

  // Create a minimal server wrapper that just imports client assets
  const serverWrapper = `// ABOUTME: Minimal wrapper for Bun asset embedding
// ABOUTME: Imports client assets and runs existing server-custom.ts

// Import client assets (triggers embedding for web files)
import { assetMap } from './generated-client-assets';

// Run the existing server - catalog/prompt loading happens dynamically via Bun.embeddedFiles
import '../packages/web/server-custom';
`;

  writeFileSync('build/temp/server-with-assets.ts', serverWrapper);
  console.log('✅ Client asset imports and server wrapper generated\n');

  // Step 3: Compile with Bun asset loading
  console.log('3️⃣ Compiling with Bun asset loading...');
  mkdirSync(outdir, { recursive: true });
  const outputPath = join(outdir, name);

  // Build command with glob patterns for JSON/MD embedding + client assets
  const compileCmd = `bun build --compile --outfile=${outputPath} --target=${target} --minify --sourcemap=none --asset-naming="[dir]/[name].[ext]" build/temp/server-with-assets.ts packages/core/src/providers/catalog/data/*.json packages/core/src/config/prompts/**/*.md`;

  console.log(`🔧 Running: ${compileCmd}`);
  console.log('   🖥️  Server: packages/web/server-custom.ts (via wrapper)');
  console.log('   📋 JSON: packages/core/src/providers/catalog/data/*.json');
  console.log('   📄 MD: packages/core/src/config/prompts/**/*.md');
  console.log('   🎨 Client assets: embedded via imports');

  execSync(compileCmd, { stdio: 'inherit' });

  // Step 4: Handle code signing
  if (sign && process.platform === 'darwin') {
    console.log('🔏 Starting signing and notarization...');
    try {
      execSync(`npx tsx scripts/sign-and-notarize.ts --binary "${outputPath}"`, {
        stdio: 'inherit',
      });
    } catch (error) {
      console.error('❌ Signing failed:', error);
      throw error;
    }
  } else if (process.platform === 'darwin') {
    console.log('🔏 Applying basic ad-hoc signing (macOS)...');
    try {
      execSync(`codesign --remove-signature "${outputPath}"`, { stdio: 'pipe' });
      execSync(`codesign -s - --deep --force "${outputPath}"`, { stdio: 'pipe' });
      console.log('✅ Ad-hoc signing completed');
    } catch (error) {
      console.warn('⚠️  Warning: Ad-hoc signing failed, but executable may still work');
    }
  } else {
    console.log('ℹ️  Skipping code signing (non-macOS platform)');
  }

  // Step 5: Check file size and validate
  console.log('4️⃣ Validating executable...');
  if (!existsSync(outputPath)) {
    throw new Error('Executable was not created');
  }

  const execStats = execSync(`wc -c ${outputPath}`, { encoding: 'utf8' });
  const execSize = parseInt(execStats.split(' ')[0]);

  console.log('\n📊 Build Summary:');
  console.log(`   💾 Executable: ${(execSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📁 Location: ${resolve(outputPath)}`);
  console.log(`   🗂️  Assets: Embedded (client files + JSON catalogs + MD prompts)`);
  console.log(`   🚀 Mode: Fully standalone - no file extraction, no temp dirs!`);
  console.log('\n🎉 Clean standalone executable ready!');
  console.log(`\nTo run: ./${outputPath}`);
  console.log(`\n✨ This executable can be copied to any compatible system and run`);
  console.log(`   without any dependencies or file extraction.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  buildCleanExecutable(options).catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
  });
}

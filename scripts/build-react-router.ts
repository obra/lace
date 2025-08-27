// ABOUTME: Simplified build script for React Router v7 executable
// ABOUTME: Uses Bun's bundler directly without ZIP complexity

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
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
Usage: npx tsx build-react-router.ts [options]

Options:
  --target <target>    Bun target (default: bun-darwin-arm64)
  --name <name>        Output executable name (default: lace)
  --outdir <outdir>    Output directory (default: build)
  --sign               Sign the binary (macOS only)
  --help               Show this help

Examples:
  npx tsx build-react-router.ts
  npx tsx build-react-router.ts --target bun-linux-x64 --name lace-linux
  npx tsx build-react-router.ts --sign
`);
        process.exit(0);
    }
  }

  return options;
}

async function buildReactRouterExecutable(options: BuildOptions = {}) {
  const target = options.target || 'bun-darwin-arm64';
  const name = options.name || 'lace';
  const outdir = options.outdir || 'build';
  const sign = options.sign || false;

  console.log('🔨 Building React Router v7 executable...');
  console.log(`   🎯 Target: ${target}`);
  console.log(`   📝 Name: ${name}`);
  console.log(`   📁 Output: ${outdir}\n`);

  // Step 1: Verify React Router v7 build exists
  console.log('1️⃣ Verifying React Router v7 build...');
  if (!existsSync('packages/web/build')) {
    throw new Error('React Router v7 build not found. Run: cd packages/web && npm run build');
  }
  console.log('✅ React Router v7 build verified\n');

  // Step 2: Build executable directly with Bun bundler
  console.log('2️⃣ Building executable with Bun...');
  mkdirSync(outdir, { recursive: true });
  const outputPath = join(outdir, name);

  // Use VFS server as entry point - much simpler than server-custom.ts
  const compileCmd = `bun build scripts/react-router-vfs-server.ts --compile --outfile=${outputPath} --target=${target} --minify`;
  console.log(`🔧 Running: ${compileCmd}`);

  execSync(compileCmd, { stdio: 'inherit' });

  // Step 3: Handle code signing
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
  }

  // Step 4: Check file size
  const execStats = execSync(`wc -c ${outputPath}`, { encoding: 'utf8' });
  const execSize = parseInt(execStats.split(' ')[0]);
  console.log(`✅ Executable created: ${(execSize / 1024 / 1024).toFixed(1)}MB`);

  // Summary
  console.log('\n📊 Build Summary:');
  console.log(`   💾 Executable: ${(execSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📁 Location: ${resolve(outputPath)}`);
  console.log('\n🎉 React Router v7 executable ready!');
  console.log(`\nTo run: ./${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  void buildReactRouterExecutable(options).catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
  });
}

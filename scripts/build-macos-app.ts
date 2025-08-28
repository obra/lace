// ABOUTME: Clean Bun build script using asset loaders instead of ZIP/VFS complexity
// ABOUTME: Uses --loader flags to embed JSON/MD files as assets with no temp extraction

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

function runPackageTarget(workspace: string, target: string, description: string) {
  console.log(`🔨 ${description}...`);
  execSync(`bun run ${target}`, { cwd: workspace, stdio: 'inherit' });
  console.log(`✅ ${description} completed\n`);
}

async function createAppBundle(
  executablePath: string,
  baseName: string,
  outdir: string
): Promise<string> {
  const appName = 'Lace';
  const appBundlePath = join(outdir, `${appName}.app`);
  const contentsPath = join(appBundlePath, 'Contents');
  const macosPath = join(contentsPath, 'MacOS');
  const resourcesPath = join(contentsPath, 'Resources');

  // Create app bundle structure
  mkdirSync(appBundlePath, { recursive: true });
  mkdirSync(contentsPath, { recursive: true });
  mkdirSync(macosPath, { recursive: true });
  mkdirSync(resourcesPath, { recursive: true });

  // Build the Swift menu bar app
  console.log('📱 Building Swift menu bar app...');
  execSync('make clean && make build', {
    cwd: 'platforms/macos',
    stdio: 'inherit',
  });

  // Copy the Swift app executable
  const swiftAppPath = 'platforms/macos/build/Lace.app/Contents/MacOS/Lace';
  if (!existsSync(swiftAppPath)) {
    throw new Error(
      `Swift app not found at ${swiftAppPath}. Make sure Swift compilation succeeded.`
    );
  }
  execSync(`cp "${swiftAppPath}" "${join(macosPath, appName)}"`);

  // Copy the lace server as 'lace-server'
  execSync(`cp "${executablePath}" "${join(macosPath, 'lace-server')}"`);

  // Copy Info.plist
  execSync(`cp platforms/macos/Info.plist "${contentsPath}/"`);

  // Copy app icon
  if (existsSync('platforms/macos/AppIcon.icns')) {
    execSync(`cp platforms/macos/AppIcon.icns "${resourcesPath}/"`);
    console.log(`   🎨 App icon copied`);
  }

  console.log(`   📱 Swift menu bar app: ${appName}`);
  console.log(`   🖥️  Server binary: lace-server`);
  console.log(`   📄 Info.plist copied`);

  return resolve(appBundlePath);
}

interface BuildOptions {
  target?: string;
  name?: string;
  outdir?: string;
  sign?: boolean;
  bundle?: boolean;
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
      case '--bundle':
        options.bundle = true;
        break;
      case '--help':
        console.log(`
Usage:
  bun scripts/build-macos-app.ts [options]
  npm run build:macos [-- --sign] [-- --bundle]

Options:
  --target <target>    Bun target (default: bun-darwin-arm64)
  --name <name>        Output executable name (default: lace)
  --outdir <outdir>    Output directory (default: build)
  --sign               Sign and notarize the binary (macOS only)
  --bundle             Create macOS .app bundle (macOS only)
  --help               Show this help

Examples:
  npm run build:macos
  npm run build:macos:signed
  npm run build:macos:app
  bun scripts/build-macos-app.ts --target bun-linux-x64 --name lace-linux

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
  const bundle = options.bundle || false;

  console.log('🔨 Building clean standalone Lace executable...');
  console.log(`   🎯 Target: ${target}`);
  console.log(`   📝 Name: ${name}`);
  console.log(`   📁 Output: ${outdir}\n`);

  // Install dependencies
  console.log('🔨 Installing dependencies...');
  execSync('bun install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');

  // Clean previous builds using proper tooling
  runPackageTarget('packages/core', 'build:clean', 'Cleaning core package');
  console.log('🔨 Cleaning web and build directories...');
  execSync('bun run prebuild:standalone:clean', { stdio: 'inherit' });
  console.log('✅ Web and build directories cleaned\n');

  console.log('🔨 Cleaning macOS platform...');
  execSync('make clean', { cwd: 'platforms/macos', stdio: 'inherit' });
  console.log('✅ macOS platform cleaned\n');

  // Build fresh React Router
  runPackageTarget('packages/web', 'build', 'Building React Router');

  // Generate all imports for embedding (AFTER React Router build)
  console.log('🔨 Generating file imports...');
  execSync('bun scripts/generate-all-imports.ts', { stdio: 'inherit' });
  console.log('✅ File imports generated\n');

  // Compile with Bun asset loading
  console.log('🔨 Compiling with Bun asset loading...');
  mkdirSync(outdir, { recursive: true });
  const outputPath = join(outdir, name);

  // Build command with explicit imports + production server
  const compileCmd = `bun build --compile --outfile=${outputPath} --target=${target} --sourcemap=none --asset-naming="[dir]/[name].[ext]" build/temp/embed-all-files.ts`;

  console.log(`🔧 Running: ${compileCmd}`);
  console.log('   📦 Imports: build/temp/embed-all-files.ts (dynamic)');
  console.log('   🖥️  Server: packages/web/server-production.ts');

  // Set NODE_ENV=production for the build to avoid dev dependencies
  const env = { ...process.env, NODE_ENV: 'production' };
  execSync(compileCmd, { stdio: 'inherit', env });

  // Handle code signing
  if (sign && process.platform === 'darwin') {
    console.log('🔏 Starting signing and notarization...');
    try {
      execFileSync('bunx', ['tsx', 'scripts/sign-and-notarize.ts', '--binary', outputPath], {
        stdio: 'inherit',
      });
    } catch (error) {
      console.error('❌ Signing failed:', error);
      throw error;
    }
  } else if (process.platform === 'darwin') {
    console.log('🔏 Applying basic ad-hoc signing (macOS)...');
    try {
      execFileSync('codesign', ['--remove-signature', outputPath], { stdio: 'pipe' });
      execFileSync('codesign', ['-s', '-', '--deep', '--force', outputPath], { stdio: 'pipe' });
      console.log('✅ Ad-hoc signing completed');
    } catch (error) {
      console.warn('⚠️  Warning: Ad-hoc signing failed, but executable may still work');
    }
  } else {
    console.log('ℹ️  Skipping code signing (non-macOS platform)');
  }

  // Validate executable
  console.log('🔨 Validating executable...');
  if (!existsSync(outputPath)) {
    throw new Error('Executable was not created');
  }

  const execStats = execSync(`wc -c ${outputPath}`, { encoding: 'utf8' });
  const execSize = parseInt(execStats.split(' ')[0]);

  // Create app bundle if requested
  let appBundlePath = '';
  if (bundle && process.platform === 'darwin') {
    console.log('🔨 Creating macOS app bundle...');
    appBundlePath = await createAppBundle(outputPath, name, outdir);
    console.log(`✅ App bundle created: ${appBundlePath}`);
  }

  console.log('\n📊 Build Summary:');
  console.log(`   💾 Executable: ${(execSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📁 Location: ${resolve(outputPath)}`);
  if (appBundlePath) {
    console.log(`   📱 App Bundle: ${resolve(appBundlePath)}`);
  }
  console.log(`   🗂️  Assets: Embedded (client files + JSON catalogs + MD prompts)`);
  console.log(`   🚀 Mode: Fully standalone - no file extraction, no temp dirs!`);
  console.log('\n🎉 Clean standalone executable ready!');
  console.log(`\nTo run: ./${outputPath}`);
  if (appBundlePath) {
    console.log(`App bundle: open ${appBundlePath}`);
  }
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

// ABOUTME: Build script that creates simple single-file Lace executable
// ABOUTME: Embeds Next.js standalone build as ZIP and creates Bun executable

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

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
Usage: npx tsx build-simple.ts [options]

Options:
  --target <target>    Bun target (default: bun-darwin-arm64)
  --name <name>        Output executable name (default: lace-standalone)  
  --outdir <outdir>    Output directory (default: build)
  --sign               Sign and notarize the binary (macOS only)
  --bundle             Create macOS .app bundle (macOS only)
  --help               Show this help


Examples:
  npx tsx build-simple.ts
  npx tsx build-simple.ts --target bun-linux-x64 --name lace-linux
  npx tsx build-simple.ts --sign
  npx tsx build-simple.ts --bundle --sign
`);
        process.exit(0);
    }
  }

  return options;
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

async function buildSimpleExecutable(options: BuildOptions = {}) {
  const target = options.target || 'bun-darwin-arm64';
  const name = options.name || 'lace-standalone';
  const outdir = options.outdir || 'build';
  const sign = options.sign || false;
  const bundle = options.bundle || false;

  console.log('🔨 Building simple single-file executable...');
  console.log(`   🎯 Target: ${target}`);
  console.log(`   📝 Name: ${name}`);
  console.log(`   📁 Output: ${outdir}\n`);

  // Step 1: Check React Router v7 build exists
  console.log('1️⃣ Checking React Router v7 build...');

  if (!existsSync('packages/web/build')) {
    throw new Error('React Router v7 build not found. Run: cd packages/web && npm run build');
  }
  console.log('✅ React Router v7 build ready\n');

  // Step 2: Create ZIP of React Router v7 build + core backend
  console.log('2️⃣ Creating ZIP of React Router v7 build...');
  const zipPath = 'build/lace-react-router.zip';
  mkdirSync('build', { recursive: true });

  // Create temp directory to organize files for ZIP
  const tempBuildDir = 'build/temp-react-router';
  rmSync(tempBuildDir, { recursive: true, force: true });
  mkdirSync(tempBuildDir, { recursive: true });

  // Copy React Router v7 build output
  cpSync('packages/web/build', `${tempBuildDir}/build`, { recursive: true });
  console.log('📁 React Router v7 build copied');

  // Copy core backend source
  cpSync('src', `${tempBuildDir}/src`, { recursive: true });
  console.log('📁 Core backend copied to src/');

  // Copy package.json and dependencies
  cpSync('package.json', `${tempBuildDir}/package.json`);
  if (existsSync('node_modules')) {
    cpSync('node_modules', `${tempBuildDir}/node_modules`, { recursive: true });
    console.log('📦 Dependencies copied');
  }

  // Copy server startup file
  cpSync('packages/web/server-custom.ts', `${tempBuildDir}/server.ts`);
  console.log('🖥️ Server file copied');

  // Create ZIP with React Router build + backend + server
  execSync(`cd ${tempBuildDir} && zip -r ../lace-react-router.zip . -q`, {
    stdio: 'pipe',
  });

  // Clean up temp directory
  rmSync(tempBuildDir, { recursive: true, force: true });

  // The standalone directory already contains its own .next with build files,
  // but we need to ensure static assets are properly linked
  console.log('📦 Verifying ZIP contents...');
  execSync(`unzip -l ${zipPath} | head -20`, { stdio: 'inherit' });

  const zipStats = execSync(`wc -c ${zipPath}`, { encoding: 'utf8' });
  const zipSize = parseInt(zipStats.split(' ')[0]);
  console.log(`✅ Standalone ZIP created: ${(zipSize / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 3: Create executable that imports ZIP directly
  console.log('3️⃣ Creating executable with bundled ZIP...');

  // Use the simple-bundle.ts directly - Bun will bundle the ZIP file
  const execSourcePath = 'scripts/simple-bundle.ts';
  console.log('✅ Executable source ready\n');

  // Step 4: Compile with Bun
  console.log('4️⃣ Compiling with Bun...');
  mkdirSync(outdir, { recursive: true });
  const outputPath = join(outdir, name);

  const compileCmd = `bun build ${execSourcePath} --compile --outfile=${outputPath} --target=${target} --minify --sourcemap=none --no-summary`;
  console.log(`🔧 Running: ${compileCmd}`);

  execSync(compileCmd, { stdio: 'inherit' });

  // Handle code signing
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

  // Check file size
  const execStats = execSync(`wc -c ${outputPath}`, { encoding: 'utf8' });
  const execSize = parseInt(execStats.split(' ')[0]);
  console.log(`✅ Executable created: ${(execSize / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 5: Validate executable exists
  console.log('5️⃣ Validating executable...');
  if (existsSync(outputPath)) {
    console.log('✅ Executable created successfully');
    console.log('ℹ️  Note: Cross-platform testing skipped (may not be compatible with build host)');
  } else {
    throw new Error('Executable was not created');
  }

  // Step 6: Create app bundle if requested
  let appBundlePath = '';
  if (bundle && process.platform === 'darwin') {
    console.log('6️⃣ Creating macOS app bundle...');
    appBundlePath = await createAppBundle(outputPath, name, outdir);
    console.log(`✅ App bundle created: ${appBundlePath}`);
  }

  // Summary
  console.log('📊 Build Summary:');
  console.log(`   📦 ZIP Size: ${(zipSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   💾 Executable: ${(execSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📁 Location: ${resolve(outputPath)}`);
  console.log('\n🎉 Simple single-file executable ready!');
  console.log(`\nTo run: ./${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  buildSimpleExecutable(options).catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
  });
}

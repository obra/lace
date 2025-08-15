// ABOUTME: Build script that creates simple single-file Lace executable
// ABOUTME: Embeds Next.js standalone build as ZIP and creates Bun executable

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

async function buildSimpleExecutable() {
  console.log('🔨 Building simple single-file executable...\n');

  // Step 1: Check Next.js build exists
  console.log('1️⃣ Checking Next.js build...');
  const nextBuildPath = 'packages/web/.next';
  if (!existsSync(nextBuildPath)) {
    throw new Error(
      `Next.js build not found at ${nextBuildPath}. Run: cd packages/web && bun run build`
    );
  }

  // Check that standalone build exists
  const standalonePath = 'packages/web/.next/standalone';
  if (!existsSync(standalonePath)) {
    throw new Error(
      `Standalone build not found at ${standalonePath}. Ensure next.config.ts has output: 'standalone'`
    );
  }
  console.log('✅ Next.js standalone build found\n');

  // Step 1.5: Copy custom server (no compilation - let Bun run the TypeScript directly)
  console.log('1️⃣.5️⃣ Using custom server TypeScript file...');

  if (!existsSync('packages/web/server-custom.ts')) {
    throw new Error('Custom server-custom.ts not found');
  }
  console.log('✅ Custom server ready\n');

  // Step 2: Create ZIP of standalone build + custom server
  console.log('2️⃣ Creating ZIP of standalone build...');
  const zipPath = 'build/lace-standalone.zip';
  mkdirSync('build', { recursive: true });

  // Create temp directory to organize files for ZIP
  const tempBuildDir = 'build/temp-standalone';
  execSync(`rm -rf ${tempBuildDir}`, { stdio: 'pipe' });
  mkdirSync(tempBuildDir, { recursive: true });

  // Copy standalone build
  execSync(`cp -r packages/web/.next/standalone ${tempBuildDir}/standalone`, {
    stdio: 'pipe',
  });

  // Copy src directory (needed for provider catalog data and other runtime files)
  execSync(`cp -r src ${tempBuildDir}/standalone/src`, {
    stdio: 'pipe',
  });
  console.log('📁 Source directory copied to standalone/src/');

  // Copy static files to the correct location where Next.js server expects them
  // The server runs from packages/web, so static files must be at packages/web/.next/static
  if (existsSync('packages/web/.next/static')) {
    mkdirSync(`${tempBuildDir}/standalone/packages/web/.next`, { recursive: true });
    execSync(
      `cp -r packages/web/.next/static ${tempBuildDir}/standalone/packages/web/.next/static`,
      {
        stdio: 'pipe',
      }
    );
    console.log('📁 Static assets copied to packages/web/.next/static/');
  } else {
    console.warn('⚠️  Warning: No .next/static directory found - static assets may be missing');
  }

  // Replace the standalone server with our custom enhanced server (TypeScript)
  // First remove the original server.js from packages/web
  execSync(`rm -f ${tempBuildDir}/standalone/packages/web/server.js`, {
    stdio: 'pipe',
  });
  // Then copy our TypeScript server to the packages/web directory where Next.js dependencies are
  execSync(`cp packages/web/server-custom.ts ${tempBuildDir}/standalone/packages/web/server.ts`, {
    stdio: 'pipe',
  });

  // Create ZIP with just the standalone build + our server
  execSync(`cd ${tempBuildDir} && zip -r ../lace-standalone.zip . -q`, {
    stdio: 'pipe',
  });

  // Clean up temp directory
  execSync(`rm -rf ${tempBuildDir}`, { stdio: 'pipe' });

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
  const outputPath = 'build/lace-standalone';

  const compileCmd = `bun build ${execSourcePath} --compile --outfile=${outputPath} --target=bun-darwin-arm64 --minify --sourcemap=none`;
  console.log(`🔧 Running: ${compileCmd}`);

  execSync(compileCmd, { stdio: 'inherit' });

  // Re-sign the executable to ensure proper code signing
  console.log('🔏 Re-signing executable...');
  try {
    execSync(`codesign --remove-signature ${outputPath}`, { stdio: 'pipe' });
    execSync(`codesign -s - --deep --force ${outputPath}`, { stdio: 'pipe' });
    console.log('✅ Executable signed successfully');
  } catch (error) {
    console.warn('⚠️  Warning: Code signing failed, but executable may still work');
  }

  // Check file size
  const execStats = execSync(`wc -c ${outputPath}`, { encoding: 'utf8' });
  const execSize = parseInt(execStats.split(' ')[0]);
  console.log(`✅ Executable created: ${(execSize / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 5: Test executable
  console.log('5️⃣ Testing executable...');
  try {
    const helpOutput = execSync(`${outputPath} --help`, { encoding: 'utf8', timeout: 5000 });
    if (helpOutput.includes('Lace - Single-File AI Coding Assistant')) {
      console.log('✅ Executable test passed\n');
    } else {
      console.warn('⚠️ Help output unexpected\n');
    }
  } catch (error) {
    console.warn('⚠️ Executable test failed:', error);
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
  buildSimpleExecutable().catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
  });
}

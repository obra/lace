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
      `Next.js build not found at ${nextBuildPath}. Run: cd packages/web && npm run build`
    );
  }
  console.log('✅ Next.js build found\n');

  // Step 2: Create ZIP of full Lace project
  console.log('2️⃣ Creating ZIP of Lace project...');
  const zipPath = 'build/lace-project.zip';
  mkdirSync('build', { recursive: true });

  // Create ZIP with ALL necessary files - no artificial trimming
  execSync(`zip -r ${zipPath} packages/web -q`, {
    stdio: 'pipe',
  });

  // The standalone directory already contains its own .next with build files,
  // but we need to ensure static assets are properly linked
  console.log('📦 Verifying ZIP contents...');
  execSync(`unzip -l ${zipPath} | head -20`, { stdio: 'inherit' });

  const zipStats = execSync(`wc -c ${zipPath}`, { encoding: 'utf8' });
  const zipSize = parseInt(zipStats.split(' ')[0]);
  console.log(`✅ ZIP created: ${(zipSize / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 3: Create executable that imports ZIP directly
  console.log('3️⃣ Creating executable with bundled ZIP...');

  // Use the simple-bundle.ts directly - Bun will bundle the ZIP file
  const execSourcePath = 'scripts/simple-bundle.ts';
  console.log('✅ Executable source ready\n');

  // Step 4: Compile with Bun
  console.log('4️⃣ Compiling with Bun...');
  const outputPath = 'build/lace-standalone';

  const compileCmd = `bun build ${execSourcePath} --compile --outfile=${outputPath} --target=bun-darwin-arm64 --minify`;
  console.log(`🔧 Running: ${compileCmd}`);

  execSync(compileCmd, { stdio: 'inherit' });

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

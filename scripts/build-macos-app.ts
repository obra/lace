// ABOUTME: Clean Bun build script using asset loaders instead of ZIP/VFS complexity
// ABOUTME: Uses --loader flags to embed JSON/MD files as assets with no temp extraction

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDMG, getVersionInfo, updateAppVersion } from './create-dmg.js';
import { writeFileSync, unlinkSync, readFileSync, chmodSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const ALLOWED_CHANNELS = ['release', 'nightly'] as const;
type Channel = (typeof ALLOWED_CHANNELS)[number];

async function replaceAppcastPlaceholders(
  appcastDir: string,
  channel: string,
  dmgFilename: string
) {
  const appcastPath = join(appcastDir, 'appcast.xml');
  if (!existsSync(appcastPath)) {
    console.warn(`⚠️  Appcast not found at ${appcastPath}`);
    return;
  }

  let appcastContent = readFileSync(appcastPath, 'utf8');

  // Replace placeholder URL with actual fsck.com URL for the DMG
  const dmgUrl = `https://fsck.com/lace/dist/${channel}/${dmgFilename}`;
  appcastContent = appcastContent.replace(/PLACEHOLDER_URL_TO_BE_REPLACED/g, dmgUrl);

  console.log(`🔧 Replaced placeholder URL with: ${dmgUrl}`);
  console.log('✅ Using fsck.com hosting for reliable distribution');

  writeFileSync(appcastPath, appcastContent);
  console.log(`✅ Updated appcast placeholders at ${appcastPath}`);
}

function runPackageTarget(workspace: string, target: string, description: string) {
  console.log(`🔨 ${description}...`);
  execSync(`bun run ${target}`, { cwd: workspace, stdio: 'inherit' });
  console.log(`✅ ${description} completed\n`);
}

async function createAppBundle(executablePath: string, outdir: string): Promise<string> {
  const appName = 'Lace';
  const finalAppBundlePath = join(outdir, `${appName}.app`);

  // Build the complete Swift menu bar app with Sparkle first
  console.log('📱 Building complete Swift app with Sparkle...');
  execSync('make clean && make build', {
    cwd: 'platforms/macos',
    stdio: 'inherit',
  });

  // Simply copy the ENTIRE working Swift app bundle
  const swiftAppBundlePath = 'platforms/macos/build/Lace.app';
  if (!existsSync(swiftAppBundlePath)) {
    throw new Error(
      `Swift app bundle not found at ${swiftAppBundlePath}. Make sure Swift compilation succeeded.`
    );
  }

  // Copy the ENTIRE working Swift app bundle (includes all frameworks)
  console.log('📝 Copying complete Swift app bundle...');
  execSync(`ditto "${swiftAppBundlePath}" "${finalAppBundlePath}"`);

  // Verify Sparkle framework is included
  const sparkleFramework = join(finalAppBundlePath, 'Contents/Frameworks/Sparkle.framework');
  if (existsSync(sparkleFramework)) {
    console.log('   ✅ Sparkle framework verified in final bundle');
  } else {
    console.error('   ❌ Sparkle framework missing!');
  }

  // Add lace-server to the complete bundle
  const macosPath = join(finalAppBundlePath, 'Contents/MacOS');
  execSync(`cp "${executablePath}" "${join(macosPath, 'lace-server')}"`);

  // Copy Frameworks directory from the Swift build (critical for Sparkle)
  const frameworksSourcePath = 'platforms/macos/build/Lace.app/Contents/Frameworks';
  const frameworksDestPath = join(contentsPath, 'Frameworks');

  if (existsSync(frameworksSourcePath)) {
    console.log(`   ⚡ Copying Sparkle framework from ${frameworksSourcePath}...`);
    mkdirSync(frameworksDestPath, { recursive: true });
    execSync(`ditto "${frameworksSourcePath}" "${frameworksDestPath}"`);

    // Verify the framework was copied
    const sparkleFramework = join(frameworksDestPath, 'Sparkle.framework');
    if (existsSync(sparkleFramework)) {
      console.log(`   ✅ Sparkle framework copied successfully`);
    } else {
      console.error(`   ❌ Sparkle framework copy failed!`);
    }
  } else {
    console.error(
      `   ❌ No Frameworks directory at ${frameworksSourcePath} - Sparkle not embedded!`
    );
    console.log(`   🔍 Swift build contents:`);
    execSync(
      `find platforms/macos/build/Lace.app -type d -name "*ramework*" || echo "No framework directories found"`
    );
  }

  // Copy the lace server as 'lace-server'
  execSync(`cp "${executablePath}" "${join(macosPath, 'lace-server')}"`);

  // Update Info.plist with real feed URL
  const channel = process.env.BUILD_CHANNEL || 'nightly';
  const feedUrl = `https://fsck.com/lace/dist/${channel}/appcast.xml`;

  const infoPlistPath = join(finalAppBundlePath, 'Contents/Info.plist');
  let infoPlistContent = readFileSync(infoPlistPath, 'utf8');
  infoPlistContent = infoPlistContent.replace('SPARKLE_FEED_URL_PLACEHOLDER', feedUrl);
  writeFileSync(infoPlistPath, infoPlistContent);

  console.log(`   📡 Feed URL set to: ${feedUrl}`);
  console.log(`   📱 Complete app bundle ready with Sparkle framework`);

  console.log(`   📱 Swift menu bar app: ${appName}`);
  console.log(`   🖥️  Server binary: lace-server`);
  console.log(`   📄 Info.plist copied`);

  return resolve(appBundlePath);
}

async function generateAppcast(options: {
  dmgPath: string;
  channel: string;
  outdir: string;
  versionInfo: ReturnType<typeof getVersionInfo>;
}) {
  const { dmgPath, channel, outdir, versionInfo } = options;

  console.log(`📝 Generating appcast for ${channel} channel...`);

  // Get file size
  const stats = await stat(dmgPath);
  const fileSize = stats.size;

  // Generate appcast using Sparkle's generate_appcast tool
  const appcastDir = join(outdir, 'appcast', channel);
  mkdirSync(appcastDir, { recursive: true });

  // Copy DMG to appcast directory
  const appcastDmgPath = join(appcastDir, `Lace-${versionInfo.fullVersion}.dmg`);
  execSync(`cp "${dmgPath}" "${appcastDmgPath}"`);

  // Run generate_appcast from Sparkle tools
  const sparkleToolsPath = resolve('platforms/macos/bin/generate_appcast');
  if (existsSync(sparkleToolsPath)) {
    console.log('🔧 Using Sparkle generate_appcast tool...');

    // Check for EdDSA private key for signing
    const privateKeyPath = 'platforms/macos/sparkle_private_key';
    let tempKeyPath: string | null = null;

    try {
      const args = [resolve(appcastDir)];

      // Add private key if available
      if (existsSync(privateKeyPath)) {
        console.log('   🔑 Using EdDSA private key for signing...');
        // Create temporary key file with secure permissions
        tempKeyPath = join(tmpdir(), `sparkle-key-${Date.now()}.pem`);
        const keyContent = readFileSync(privateKeyPath, 'utf8');
        writeFileSync(tempKeyPath, keyContent, { mode: 0o600 });
        args.push('--ed-key-file', tempKeyPath);
      } else {
        console.log('⚠️  No EdDSA private key found at', privateKeyPath);
        console.log('   Will generate basic unsigned appcast');
      }

      execFileSync(sparkleToolsPath, args, {
        stdio: 'inherit',
      });
      console.log(`✅ Appcast generated at ${appcastDir}/appcast.xml`);

      // Replace placeholder URLs with actual Dropbox URLs
      await replaceAppcastPlaceholders(appcastDir, channel, `Lace-${versionInfo.fullVersion}.dmg`);
    } catch (error) {
      console.warn('⚠️  Sparkle generate_appcast failed, creating basic appcast...');
      await createBasicAppcast({ dmgPath: appcastDmgPath, channel, outdir, versionInfo, fileSize });
      // Replace placeholder URLs in basic appcast too
      await replaceAppcastPlaceholders(appcastDir, channel, `Lace-${versionInfo.fullVersion}.dmg`);
    } finally {
      // Clean up temporary key file
      if (tempKeyPath && existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
    }
  } else {
    console.log('📝 Creating basic appcast (Sparkle tools not found)...');
    await createBasicAppcast({ dmgPath: appcastDmgPath, channel, outdir, versionInfo, fileSize });
  }
}

async function createBasicAppcast(options: {
  dmgPath: string;
  channel: string;
  outdir: string;
  versionInfo: ReturnType<typeof getVersionInfo>;
  fileSize: number;
}) {
  const { dmgPath, channel, outdir, versionInfo, fileSize } = options;
  const appcastPath = join(outdir, 'appcast', channel, 'appcast.xml');

  const appcastContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Lace ${channel === 'nightly' ? 'Nightly' : 'Release'} Updates</title>
    <description>Updates for Lace AI Coding Assistant</description>
    <language>en</language>
    <item>
      <title>Lace ${versionInfo.fullVersion}</title>
      <description><![CDATA[
        <h3>Lace ${versionInfo.fullVersion}</h3>
        <p>Latest ${channel} build of Lace AI Coding Assistant.</p>
        <p><strong>Version:</strong> ${versionInfo.npmVersion}</p>
        <p><strong>Build:</strong> ${versionInfo.gitShortSha}</p>
      ]]></description>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <sparkle:version>${versionInfo.fullVersion}</sparkle:version>
      <sparkle:shortVersionString>${versionInfo.npmVersion}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion>
      <enclosure
        url="PLACEHOLDER_URL_TO_BE_REPLACED"
        length="${fileSize}"
        type="application/x-apple-diskimage"
        sparkle:edSignature="PLACEHOLDER_SIGNATURE"/>
    </item>
  </channel>
</rss>`;

  writeFileSync(appcastPath, appcastContent);
  console.log(`📝 Basic appcast created at ${appcastPath}`);
  console.log(`⚠️  Remember to replace PLACEHOLDER_URL and PLACEHOLDER_SIGNATURE!`);

  // Note: Placeholders will be replaced by replaceAppcastPlaceholders function
}

interface BuildOptions {
  target?: string;
  name?: string;
  outdir?: string;
  sign?: boolean;
  bundle?: boolean;
  dmg?: boolean;
  channel?: string;
  generateAppcast?: boolean;
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
      case '--dmg':
        options.dmg = true;
        options.bundle = true; // DMG requires bundle
        break;
      case '--channel':
        const channelValue = args[++i];
        if (!ALLOWED_CHANNELS.includes(channelValue as Channel)) {
          console.error(`❌ Invalid channel: ${channelValue}`);
          console.error(`   Valid channels: ${ALLOWED_CHANNELS.join(', ')}`);
          process.exit(1);
        }
        options.channel = channelValue;
        break;
      case '--generate-appcast':
        options.generateAppcast = true;
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
  --dmg                Create DMG distribution (implies --bundle)
  --channel <channel>  Update channel: release or nightly (default: release)
  --generate-appcast   Generate appcast.xml for Sparkle updates
  --help               Show this help

Examples:
  npm run build:macos
  npm run build:macos:signed
  npm run build:macos:app
  npm run build:macos:dmg
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
  const dmg = options.dmg || false;
  const channel = options.channel || 'release';
  const shouldGenerateAppcast = options.generateAppcast || false;

  // Get version info for consistent naming
  const versionInfo = getVersionInfo();

  console.log('🔨 Building clean standalone Lace executable...');
  console.log(`   🎯 Target: ${target}`);
  console.log(`   📝 Name: ${name}`);
  console.log(`   📁 Output: ${outdir}`);
  console.log(`   📄 Version: ${versionInfo.fullVersion}`);
  console.log(`   🎯 Channel: ${channel}`);
  if (shouldGenerateAppcast) console.log(`   📡 Appcast: Will generate`);
  console.log();

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

  // Handle code signing for standalone binaries (not app bundles)
  if (process.platform === 'darwin') {
    if (bundle) {
      console.log('🔏 Deferring signing to app bundle stage...');
    } else if (sign) {
      console.log('🔏 Signing and notarizing standalone binary...');
      execFileSync('bunx', ['tsx', 'scripts/sign-and-notarize.ts', '--binary', outputPath], {
        stdio: 'inherit',
      });
    } else {
      console.log('🔏 Applying ad-hoc signing (macOS)...');
      try {
        execFileSync('codesign', ['--remove-signature', outputPath], { stdio: 'pipe' });
        execFileSync('codesign', ['-s', '-', '--deep', '--force', outputPath], { stdio: 'pipe' });
        console.log('✅ Ad-hoc signing completed');
      } catch {
        console.warn('⚠️  Ad-hoc signing failed; continuing');
      }
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
  let dmgPath = '';
  if (bundle && process.platform === 'darwin') {
    console.log('🔨 Creating macOS app bundle...');
    appBundlePath = await createAppBundle(outputPath, outdir);
    console.log(`✅ App bundle created: ${appBundlePath}`);

    // Update app version in Info.plist BEFORE signing
    console.log('📝 Updating app bundle version...');
    updateAppVersion(appBundlePath, versionInfo.fullVersion);
    console.log(`✅ App version updated to ${versionInfo.fullVersion}`);

    // Sign the app bundle if requested
    if (sign) {
      console.log('🔏 Signing and notarizing app bundle...');
      try {
        const result = execFileSync(
          'bunx',
          ['tsx', 'scripts/sign-and-notarize.ts', '--binary', appBundlePath],
          {
            stdio: ['inherit', 'pipe', 'pipe'],
            encoding: 'utf8',
            env: {
              ...process.env,
              // Ensure signing environment variables are passed through
              GITHUB_ACTIONS_KEYCHAIN_READY: process.env.GITHUB_ACTIONS_KEYCHAIN_READY,
              APPLE_ID_EMAIL: process.env.APPLE_ID_EMAIL,
              APPLE_ID_PASSWORD: process.env.APPLE_ID_PASSWORD,
              APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
            },
          }
        );
        console.log('✅ App bundle signed and notarized');
        if (result) console.log('Signing output:', result);
      } catch (error: any) {
        console.error('❌ App bundle signing failed:');
        if (error.stdout) console.error('STDOUT:', error.stdout);
        if (error.stderr) console.error('STDERR:', error.stderr);
        console.error('Error details:', error.message || error);
        throw error;
      }
    } else {
      console.log('🔏 Applying ad-hoc signing to app bundle...');
      try {
        execFileSync('codesign', ['--remove-signature', appBundlePath], { stdio: 'pipe' });
        execFileSync('codesign', ['-s', '-', '--deep', '--force', appBundlePath], {
          stdio: 'pipe',
        });
        console.log('✅ App bundle ad-hoc signing completed');
      } catch {
        console.warn('⚠️  App bundle ad-hoc signing failed; continuing');
      }
    }

    // Create DMG if requested (AFTER signing)
    if (dmg) {
      console.log('\n🔨 Creating DMG distribution...');
      dmgPath = await createDMG({
        appBundlePath,
        outputDir: outdir,
      });
      console.log(`✅ DMG created: ${dmgPath}`);

      // Generate appcast if requested
      if (shouldGenerateAppcast) {
        await generateAppcast({
          dmgPath,
          channel,
          outdir,
          versionInfo,
        });
      }
    }
  }

  console.log('\n📊 Build Summary:');
  console.log(`   📄 Version: ${versionInfo.fullVersion}`);
  console.log(`   🎯 Channel: ${channel}`);
  console.log(`   💾 Executable: ${(execSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📁 Location: ${resolve(outputPath)}`);
  if (appBundlePath) {
    console.log(`   📱 App Bundle: ${resolve(appBundlePath)}`);
  }
  if (dmgPath) {
    console.log(`   📦 DMG: ${resolve(dmgPath)}`);
  }
  if (shouldGenerateAppcast && dmgPath) {
    console.log(`   📡 Appcast: ${resolve(outdir)}/appcast/${channel}/appcast.xml`);
  }
  console.log(`   🗂️  Assets: Embedded (client files + JSON catalogs + MD prompts)`);
  console.log(`   🚀 Mode: Fully standalone - no file extraction, no temp dirs!`);
  console.log('\n🎉 Clean standalone executable ready!');
  console.log(`\nTo run: ./${outputPath}`);
  if (appBundlePath) {
    console.log(`App bundle: open ${appBundlePath}`);
  }
  if (dmgPath) {
    console.log(`DMG ready for distribution: ${dmgPath}`);
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

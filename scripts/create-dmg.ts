// ABOUTME: Script to create a properly formatted DMG for macOS distribution
// ABOUTME: Handles DMG creation with version naming and proper setup

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, basename } from 'path';

interface DMGOptions {
  appBundlePath: string;
  outputDir?: string;
  dmgName?: string;
  volumeName?: string;
  backgroundImage?: string;
  iconSize?: number;
}

interface VersionInfo {
  npmVersion: string;
  gitShortSha: string;
  fullVersion: string;
}

function getVersionInfo(): VersionInfo {
  // Get npm version from package.json
  const packageJsonPath = resolve('package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const npmVersion = packageJson.version;

  // Get git short SHA
  let gitShortSha: string;
  try {
    gitShortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.warn('Warning: Could not get git SHA, using fallback');
    gitShortSha = 'dev';
  }

  const fullVersion = `${npmVersion}-${gitShortSha}`;

  return {
    npmVersion,
    gitShortSha,
    fullVersion,
  };
}

function updateAppVersion(appBundlePath: string, version: string) {
  const infoPlistPath = join(appBundlePath, 'Contents', 'Info.plist');

  if (!existsSync(infoPlistPath)) {
    console.warn(`Warning: Info.plist not found at ${infoPlistPath}, skipping version update`);
    return;
  }

  console.log(`📝 Updating app version to ${version}...`);

  // Read the current plist
  let plistContent = readFileSync(infoPlistPath, 'utf8');

  // Update CFBundleShortVersionString (version displayed to users)
  plistContent = plistContent.replace(
    /<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>`
  );

  // Update CFBundleVersion (build number)
  plistContent = plistContent.replace(
    /<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleVersion</key>\n\t<string>${version}</string>`
  );

  // If those keys don't exist, add them before the closing </dict>
  if (!plistContent.includes('<key>CFBundleShortVersionString</key>')) {
    plistContent = plistContent.replace(
      '</dict>',
      `\t<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>\n</dict>`
    );
  }

  if (!plistContent.includes('<key>CFBundleVersion</key>')) {
    plistContent = plistContent.replace(
      '</dict>',
      `\t<key>CFBundleVersion</key>\n\t<string>${version}</string>\n</dict>`
    );
  }

  writeFileSync(infoPlistPath, plistContent);
  console.log(`✅ App version updated to ${version}`);
}

async function createDMG(options: DMGOptions): Promise<string> {
  const {
    appBundlePath,
    outputDir = 'build',
    dmgName,
    volumeName = 'Lace',
    iconSize = 128,
  } = options;

  if (!existsSync(appBundlePath)) {
    throw new Error(`App bundle not found: ${appBundlePath}`);
  }

  const versionInfo = getVersionInfo();
  const finalDmgName = dmgName || `Lace-${versionInfo.fullVersion}.dmg`;
  const dmgPath = join(outputDir, finalDmgName);

  console.log(`📦 Creating DMG: ${finalDmgName}`);
  console.log(`   📱 App Bundle: ${basename(appBundlePath)}`);
  console.log(`   📄 Version: ${versionInfo.fullVersion}`);

  // Update app version before packaging
  updateAppVersion(appBundlePath, versionInfo.fullVersion);

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Remove existing DMG if it exists
  if (existsSync(dmgPath)) {
    console.log(`🗑️  Removing existing DMG: ${basename(dmgPath)}`);
    execSync(`rm -f "${dmgPath}"`);
  }

  // Create temporary directory for DMG contents
  const tempDmgDir = join(outputDir, 'dmg-temp');
  execSync(`rm -rf "${tempDmgDir}"`);
  mkdirSync(tempDmgDir, { recursive: true });

  try {
    // Copy app bundle to temp directory
    console.log('📁 Preparing DMG contents...');
    execSync(`cp -R "${appBundlePath}" "${tempDmgDir}/"`);

    // Create Applications symlink
    execSync(`ln -sf /Applications "${tempDmgDir}/Applications"`);

    // Create a simple README if it doesn't exist
    const readmePath = join(tempDmgDir, 'README.txt');
    writeFileSync(
      readmePath,
      `Lace AI Coding Assistant v${versionInfo.fullVersion}

Installation:
1. Drag Lace.app to the Applications folder
2. Open Lace from Applications or Launchpad
3. Enjoy your AI coding assistant!

For more information, visit: https://github.com/laceai/lace
`
    );

    // Calculate DMG size (app bundle size + some padding)
    const sizeOutput = execSync(`du -sm "${tempDmgDir}"`, { encoding: 'utf8' });
    const sizeMatch = sizeOutput.match(/^(\d+)/);
    const tempDirSizeMB = sizeMatch ? parseInt(sizeMatch[1]) : 100;
    const dmgSizeMB = Math.max(tempDirSizeMB + 50, 200); // Add padding, minimum 200MB

    console.log(`💾 Creating DMG (${dmgSizeMB}MB)...`);

    // Create a temporary read-write DMG first
    const tempDmgPath = dmgPath.replace('.dmg', '-temp.dmg');
    execSync(
      `hdiutil create -megabytes ${dmgSizeMB} -srcfolder "${tempDmgDir}" -volname "${volumeName}" -format UDRW "${tempDmgPath}"`,
      {
        stdio: 'inherit',
      }
    );

    console.log('🎨 Customizing DMG appearance...');

    try {
      // Mount the temporary DMG for customization
      console.log('   📱 Mounting DMG for customization...');
      const mountOutput = execSync(
        `hdiutil attach "${tempDmgPath}" -readwrite -noverify -noautoopen`,
        {
          encoding: 'utf8',
        }
      );

      const volumePath = `/Volumes/${volumeName}`;
      if (!existsSync(volumePath)) {
        throw new Error(`Failed to mount DMG at ${volumePath}`);
      }

      try {
        // Wait a moment for the mount to complete
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log('   🎨 Applying custom layout...');

        // Set up the DMG appearance using AppleScript
        const appleScript = `
tell application "Finder"
  tell disk "${volumeName}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, 600, 400}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to ${iconSize}
    
    -- Position icons
    set position of item "Lace.app" of container window to {150, 200}
    set position of item "Applications" of container window to {350, 200}
    if exists item "README.txt" of container window then
      set position of item "README.txt" of container window to {250, 300}
    end if
    
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
`;

        // Apply the AppleScript (with error handling)
        try {
          execSync(`osascript -e '${appleScript}'`, { stdio: 'pipe', timeout: 30000 });
          console.log('   ✅ Layout applied successfully');
        } catch (error) {
          console.log('   ⚠️  Layout customization failed, but continuing with basic DMG');
        }
      } finally {
        // Unmount the DMG
        console.log('   📤 Unmounting DMG...');
        try {
          execSync(`hdiutil detach "${volumePath}"`, { stdio: 'pipe', timeout: 10000 });
        } catch (error) {
          console.log('   ⚠️  Force unmounting...');
          execSync(`hdiutil detach "${volumePath}" -force`, { stdio: 'pipe' });
        }
      }

      // Convert to final compressed format
      console.log('🗜️  Converting to final compressed format...');
      execSync(
        `hdiutil convert "${tempDmgPath}" -format UDZO -imagekey zlib-level=9 -o "${dmgPath}"`,
        {
          stdio: 'inherit',
        }
      );

      // Clean up temporary DMG
      execSync(`rm -f "${tempDmgPath}"`);
    } catch (error) {
      console.log('⚠️  DMG customization failed, creating basic DMG instead...');

      // Clean up any partial files
      if (existsSync(tempDmgPath)) {
        try {
          execSync(`hdiutil detach "/Volumes/${volumeName}" -force`, { stdio: 'pipe' });
        } catch {}
        execSync(`rm -f "${tempDmgPath}"`);
      }

      // Create a basic DMG without customization
      execSync(
        `hdiutil create -megabytes ${dmgSizeMB} -srcfolder "${tempDmgDir}" -volname "${volumeName}" -format UDZO -imagekey zlib-level=9 "${dmgPath}"`,
        {
          stdio: 'inherit',
        }
      );

      console.log('✅ Basic DMG created successfully');
    }
  } finally {
    // Clean up temp directory
    execSync(`rm -rf "${tempDmgDir}"`);
  }

  // Get final size
  const finalSizeOutput = execSync(`wc -c "${dmgPath}"`, { encoding: 'utf8' });
  const finalSize = parseInt(finalSizeOutput.split(' ')[0]);

  console.log('\n📊 DMG Creation Summary:');
  console.log(`   📦 DMG: ${basename(dmgPath)}`);
  console.log(`   💾 Size: ${(finalSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   📄 Version: ${versionInfo.fullVersion}`);
  console.log(`   📁 Location: ${resolve(dmgPath)}`);
  console.log('\n✅ DMG created successfully!');

  return resolve(dmgPath);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: DMGOptions & { help?: boolean } = {
    appBundlePath: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--app':
        options.appBundlePath = args[++i];
        break;
      case '--output':
        options.outputDir = args[++i];
        break;
      case '--name':
        options.dmgName = args[++i];
        break;
      case '--volume-name':
        options.volumeName = args[++i];
        break;
      case '--icon-size':
        options.iconSize = parseInt(args[++i]);
        break;
      case '--help':
        options.help = true;
        break;
    }
  }

  if (options.help) {
    console.log(`
Usage: npx tsx scripts/create-dmg.ts --app <path> [options]

Required:
  --app <path>              Path to the .app bundle

Options:
  --output <dir>            Output directory (default: build)
  --name <name>             DMG filename (default: Lace-<version>-<sha>.dmg)
  --volume-name <name>      DMG volume name (default: Lace)
  --icon-size <size>        Icon size in DMG (default: 128)
  --help                    Show this help

Examples:
  npx tsx scripts/create-dmg.ts --app build/Lace.app
  npx tsx scripts/create-dmg.ts --app build/Lace.app --name MyCustomName.dmg
`);
    process.exit(0);
  }

  if (!options.appBundlePath) {
    throw new Error('App bundle path is required. Use --app <path>');
  }

  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  createDMG(options).catch((error) => {
    console.error('❌ DMG creation failed:', error.message);
    process.exit(1);
  });
}

export { createDMG, getVersionInfo };

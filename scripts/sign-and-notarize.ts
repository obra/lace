// ABOUTME: Script to sign and notarize macOS binaries for distribution
// ABOUTME: Can be used locally or in CI with proper Apple Developer credentials

import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';

// Signing-only function for when keychain is already set up
async function performSigningOnly(
  resolvedBinaryPath: string,
  signingIdentity: string,
  appleId?: string,
  applePassword?: string,
  teamId?: string,
  skipNotarization = false
) {
  const entitlementsPath = `${process.cwd()}/scripts/entitlements.plist`;

  // Handle app bundle vs standalone binary signing
  if (resolvedBinaryPath.endsWith('.app')) {
    console.log('✍️  Signing app bundle with hardened runtime and entitlements...');

    // Sign Sparkle framework components first (if present)
    const sparkleFrameworkPath = `${resolvedBinaryPath}/Contents/Frameworks/Sparkle.framework`;
    if (existsSync(sparkleFrameworkPath)) {
      console.log('   ⚡ Signing Sparkle framework components...');

      // Sign XPC Services (correct path: Versions/Current/XPCServices)
      const xpcServicesPath = `${sparkleFrameworkPath}/Versions/Current/XPCServices`;
      if (existsSync(xpcServicesPath)) {
        console.log('   🔧 Signing Sparkle XPC services...');
        execSync(
          `find "${xpcServicesPath}" -name "*.xpc" -exec codesign --force --options runtime --sign "${signingIdentity}" {} \;`,
          { stdio: 'inherit' }
        );
      }

      // Sign Updater.app (critical for updates)
      const updaterAppPath = `${sparkleFrameworkPath}/Versions/Current/Updater.app`;
      if (existsSync(updaterAppPath)) {
        console.log('   🔄 Signing Sparkle Updater.app...');
        execSync(
          `codesign --force --options runtime --sign "${signingIdentity}" "${updaterAppPath}" --verbose`,
          { stdio: 'inherit' }
        );
      }

      // Sign the main Sparkle framework
      console.log('   ⚡ Signing Sparkle framework...');
      execSync(
        `codesign --force --options runtime --sign "${signingIdentity}" "${sparkleFrameworkPath}" --verbose`,
        { stdio: 'inherit' }
      );
    }

    // Sign the inner lace-server binary
    const laceServerPath = `${resolvedBinaryPath}/Contents/MacOS/lace-server`;
    if (existsSync(laceServerPath)) {
      console.log('   🔧 Signing lace-server binary...');
      execSync(
        `codesign --force --options runtime --entitlements "${entitlementsPath}" --sign "${signingIdentity}" "${laceServerPath}" --verbose`,
        { stdio: 'inherit' }
      );
    }

    // Finally sign the outer app bundle
    console.log('   📦 Signing app bundle...');
    execSync(
      `codesign --force --options runtime --sign "${signingIdentity}" "${resolvedBinaryPath}" --verbose`,
      { stdio: 'inherit' }
    );
  } else {
    console.log('✍️  Signing binary with hardened runtime and entitlements...');
    execSync(
      `codesign --force --options runtime --entitlements "${entitlementsPath}" --deep --sign "${signingIdentity}" "${resolvedBinaryPath}" --verbose`,
      { stdio: 'inherit' }
    );
  }

  // Verify signature
  console.log('🔍 Verifying signature...');
  execSync(`codesign --verify --deep --strict --verbose=2 "${resolvedBinaryPath}"`, {
    stdio: 'inherit',
  });

  console.log('✅ Binary signed successfully!');

  // Note: Skipping notarization in GitHub Actions for now as it's complex
  if (!skipNotarization && appleId && applePassword && teamId) {
    console.log('⚠️  Notarization available but skipping for now in GitHub Actions');
  }
}

interface SigningOptions {
  binaryPath: string;
  appleId?: string;
  applePassword?: string;
  teamId?: string;
  certificateP12?: string;
  certificatePassword?: string;
  keychainPassword?: string;
  skipNotarization?: boolean;
}

function parseArgs(): SigningOptions {
  const args = process.argv.slice(2);
  const options: SigningOptions = {
    binaryPath: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--binary':
        options.binaryPath = args[++i];
        break;
      case '--apple-id':
        options.appleId = args[++i];
        break;
      case '--apple-password':
        options.applePassword = args[++i];
        break;
      case '--team-id':
        options.teamId = args[++i];
        break;
      case '--certificate-p12':
        options.certificateP12 = args[++i];
        break;
      case '--certificate-password':
        options.certificatePassword = args[++i];
        break;
      case '--keychain-password':
        options.keychainPassword = args[++i];
        break;
      case '--skip-notarization':
        options.skipNotarization = true;
        break;
      case '--help':
        console.log(`
Usage: npx tsx sign-and-notarize.ts --binary <path> [options]

Required:
  --binary <path>              Path to the binary to sign

Apple Developer credentials (required for proper signing):
  --apple-id <email>           Apple ID email
  --apple-password <password>  App-specific password
  --team-id <id>               Apple Team ID
  --certificate-p12 <path>     Path to .p12 certificate file
  --certificate-password <pw>  Certificate password
  --keychain-password <pw>     Temporary keychain password

Options:
  --skip-notarization          Sign only, skip notarization
  --help                       Show this help

Environment variables (alternative to CLI args):
  APPLE_ID_EMAIL, APPLE_ID_PASSWORD, APPLE_TEAM_ID
  APPLE_DEVELOPER_CERTIFICATE_P12 (base64 encoded)
  APPLE_DEVELOPER_CERTIFICATE_PASSWORD, KEYCHAIN_PASSWORD

Examples:
  # Sign and notarize with CLI args
  npx tsx sign-and-notarize.ts --binary build/lace-macos-arm64 \\
    --apple-id you@example.com --apple-password xxxx-xxxx-xxxx-xxxx \\
    --team-id XXXXXXXXXX --certificate-p12 cert.p12 --certificate-password password123

  # Sign only (skip notarization)
  npx tsx sign-and-notarize.ts --binary build/lace-macos-arm64 --skip-notarization

  # Use environment variables (for CI)
  export APPLE_ID_EMAIL=you@example.com
  export APPLE_ID_PASSWORD=xxxx-xxxx-xxxx-xxxx
  npx tsx sign-and-notarize.ts --binary build/lace-macos-arm64
`);
        process.exit(0);
    }
  }

  return options;
}

async function signAndNotarize(options: SigningOptions) {
  const {
    binaryPath,
    appleId = process.env.APPLE_ID_EMAIL,
    applePassword = process.env.APPLE_ID_PASSWORD,
    teamId = process.env.APPLE_TEAM_ID,
    certificateP12 = process.env.APPLE_DEVELOPER_CERTIFICATE_P12,
    certificatePassword = process.env.APPLE_DEVELOPER_CERTIFICATE_PASSWORD,
    keychainPassword = process.env.KEYCHAIN_PASSWORD || 'temp-keychain-password',
    skipNotarization = false,
  } = options;

  if (!binaryPath) {
    throw new Error('Binary path is required. Use --binary <path>');
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`);
  }

  const resolvedBinaryPath = resolve(binaryPath);
  console.log(`🔐 Signing binary: ${resolvedBinaryPath}`);

  // Debug: Check environment
  console.log('🔍 Environment check:');
  console.log(`  GITHUB_ACTIONS_KEYCHAIN_READY: ${process.env.GITHUB_ACTIONS_KEYCHAIN_READY}`);
  console.log(`  certificateP12 provided: ${!!certificateP12}`);
  console.log(`  certificatePassword provided: ${!!certificatePassword}`);
  console.log(`  appleId provided: ${!!appleId}`);

  // Check if we're on macOS
  if (process.platform !== 'darwin') {
    console.log('ℹ️  Not on macOS, skipping signing');
    return;
  }

  // If no credentials provided, try ad-hoc signing
  if (!certificateP12 && !appleId) {
    console.log('⚠️  No Apple Developer credentials provided, using ad-hoc signing');
    console.log('   This binary will only work on this machine');
    try {
      execSync(`codesign --remove-signature "${resolvedBinaryPath}"`, { stdio: 'pipe' });
      execSync(`codesign -s - --deep --force "${resolvedBinaryPath}"`, { stdio: 'pipe' });
      console.log('✅ Ad-hoc signing completed');
      return;
    } catch (error) {
      console.warn('⚠️  Ad-hoc signing failed:', error);
      return;
    }
  }

  // Check if GitHub Actions already set up keychain
  if (process.env.GITHUB_ACTIONS_KEYCHAIN_READY === 'true') {
    console.log('📝 Using GitHub Actions keychain setup...');

    // Find signing identity from current default keychain
    try {
      const identityOutput = execSync(`security find-identity -v -p codesigning`, {
        encoding: 'utf8',
      });
      console.log('🔍 Available identities:', identityOutput);

      // Look for either Developer ID Application or Apple Development certificates
      let identityMatch = identityOutput.match(/"([^"]*Developer ID Application[^"]*)"/);
      if (!identityMatch) {
        identityMatch = identityOutput.match(/"([^"]*Apple Development[^"]*)"/);
        console.log('📝 Using Apple Development certificate for signing');
      }

      if (!identityMatch) {
        throw new Error('No Developer ID Application certificate found in current keychain');
      }

      const signingIdentity = identityMatch[1];
      console.log(`🔑 Using signing identity: ${signingIdentity}`);

      // Proceed with signing using existing keychain
      await performSigningOnly(
        resolvedBinaryPath,
        signingIdentity,
        appleId,
        applePassword,
        teamId,
        skipNotarization
      );
      return;
    } catch (error) {
      console.warn(
        '⚠️  Failed to use GitHub Actions keychain, falling back to manual setup:',
        error
      );
    }
  }

  // Validate required credentials for proper signing (unless using GitHub Actions keychain)
  if (!certificateP12 || !certificatePassword) {
    if (!process.env.GITHUB_ACTIONS_KEYCHAIN_READY) {
      throw new Error('Certificate .p12 file and password are required for proper signing');
    }
    console.log('⚠️  No P12 credentials provided, but GitHub Actions keychain is available');
  }

  let tempCertPath = '';
  let tempKeychainName = '';

  try {
    // Set up certificate
    console.log('🔐 Setting up certificate and keychain...');

    if (certificateP12.startsWith('/') || certificateP12.includes('.p12')) {
      // Handle file path
      tempCertPath = certificateP12;
      if (!existsSync(tempCertPath)) {
        throw new Error(`Certificate file not found: ${tempCertPath}`);
      }
    } else {
      // Handle base64 encoded certificate (from environment)
      tempCertPath = 'temp-certificate.p12';
      execSync(`echo "${certificateP12}" | base64 --decode > ${tempCertPath}`);
    }

    // Create temporary keychain
    tempKeychainName = 'temp-signing.keychain';
    try {
      execSync(`security delete-keychain ${tempKeychainName}`, { stdio: 'pipe' });
    } catch {
      // Keychain doesn't exist, that's fine
    }

    execSync(`security create-keychain -p "${keychainPassword}" ${tempKeychainName}`);
    execSync(`security default-keychain -s ${tempKeychainName}`);
    execSync(`security unlock-keychain -p "${keychainPassword}" ${tempKeychainName}`);

    // Import certificate
    execSync(
      `security import "${tempCertPath}" -k ${tempKeychainName} -P "${certificatePassword}" -T /usr/bin/codesign`
    );
    execSync(
      `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${keychainPassword}" ${tempKeychainName}`
    );

    // Find signing identity
    const identityOutput = execSync(
      `security find-identity -v -p codesigning ${tempKeychainName}`,
      { encoding: 'utf8' }
    );
    console.log('🔍 Available identities in temp keychain:', identityOutput);

    // Look for either Developer ID Application or Apple Development certificates
    let identityMatch = identityOutput.match(/"([^"]*Developer ID Application[^"]*)"/);
    if (!identityMatch) {
      identityMatch = identityOutput.match(/"([^"]*Apple Development[^"]*)"/);
      console.log('📝 Using Apple Development certificate for signing');
    }

    if (!identityMatch) {
      throw new Error(
        'No Developer ID Application or Apple Development certificate found in keychain'
      );
    }

    const signingIdentity = identityMatch[1];
    console.log(`🔑 Using signing identity: ${signingIdentity}`);

    // Handle app bundle vs standalone binary signing
    if (resolvedBinaryPath.endsWith('.app')) {
      console.log('✍️  Signing app bundle with hardened runtime and entitlements...');
      const entitlementsPath = `${process.cwd()}/scripts/entitlements.plist`;

      // Sign Sparkle framework components first (if present)
      const sparkleFrameworkPath = `${resolvedBinaryPath}/Contents/Frameworks/Sparkle.framework`;
      if (existsSync(sparkleFrameworkPath)) {
        console.log('   ⚡ Signing Sparkle framework components...');

        // Sign XPC Services (correct path: Versions/Current/XPCServices)
        const xpcServicesPath = `${sparkleFrameworkPath}/Versions/Current/XPCServices`;
        if (existsSync(xpcServicesPath)) {
          console.log('   🔧 Signing Sparkle XPC services...');
          execSync(
            `find "${xpcServicesPath}" -name "*.xpc" -exec codesign --force --options runtime --sign "${signingIdentity}" {} \;`,
            { stdio: 'inherit' }
          );
        }

        // Sign Updater.app (critical for updates)
        const updaterAppPath = `${sparkleFrameworkPath}/Versions/Current/Updater.app`;
        if (existsSync(updaterAppPath)) {
          console.log('   🔄 Signing Sparkle Updater.app...');
          execSync(
            `codesign --force --options runtime --sign "${signingIdentity}" "${updaterAppPath}" --verbose`,
            { stdio: 'inherit' }
          );
        }

        // Sign the main Sparkle framework
        console.log('   ⚡ Signing Sparkle framework...');
        execSync(
          `codesign --force --options runtime --sign "${signingIdentity}" "${sparkleFrameworkPath}" --verbose`,
          { stdio: 'inherit' }
        );
      }

      // Sign the inner lace-server binary
      const laceServerPath = `${resolvedBinaryPath}/Contents/MacOS/lace-server`;
      if (existsSync(laceServerPath)) {
        console.log('   🔧 Signing lace-server binary...');
        execSync(
          `codesign --force --options runtime --entitlements "${entitlementsPath}" --sign "${signingIdentity}" "${laceServerPath}" --verbose`,
          { stdio: 'inherit' }
        );
      }

      // Finally sign the outer app bundle
      console.log('   📦 Signing app bundle...');
      execSync(
        `codesign --force --options runtime --sign "${signingIdentity}" "${resolvedBinaryPath}" --verbose`,
        { stdio: 'inherit' }
      );
    } else {
      console.log('✍️  Signing binary with hardened runtime and entitlements...');
      const entitlementsPath = `${process.cwd()}/scripts/entitlements.plist`;
      execSync(
        `codesign --force --options runtime --entitlements "${entitlementsPath}" --deep --sign "${signingIdentity}" "${resolvedBinaryPath}" --verbose`,
        { stdio: 'inherit' }
      );
    }

    // Verify signature
    console.log('🔍 Verifying signature...');
    execSync(`codesign --verify --deep --strict --verbose=2 "${resolvedBinaryPath}"`, {
      stdio: 'inherit',
    });

    try {
      execSync(`spctl --assess --type execute --verbose "${resolvedBinaryPath}"`, {
        stdio: 'inherit',
      });
    } catch {
      console.log('ℹ️  spctl assessment failed (expected for non-notarized binaries)');
    }

    console.log('✅ Binary signed successfully!');

    // Notarization
    if (!skipNotarization) {
      if (!appleId || !applePassword || !teamId) {
        console.log('⚠️  Skipping notarization: Apple ID, password, or team ID not provided');
        console.log('   Use --apple-id, --apple-password, --team-id or set environment variables');
        return;
      }

      console.log('📤 Starting notarization process...');

      // Create ZIP for notarization
      const zipName = `${resolvedBinaryPath.split('/').pop()}-signed.zip`;
      execSync(`zip -r "${zipName}" "${resolvedBinaryPath}"`);

      try {
        // Submit for notarization
        console.log('📤 Submitting for notarization (this may take several minutes)...');
        execSync(
          `xcrun notarytool submit "${zipName}" --apple-id "${appleId}" --password "${applePassword}" --team-id "${teamId}" --wait --timeout 20m --verbose`,
          { stdio: 'inherit' }
        );

        // Staple notarization ticket with retry
        console.log('📎 Stapling notarization ticket...');
        let staplingSucceeded = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (attempt > 1) {
              console.log(`📎 Stapling attempt ${attempt}/3...`);
              // Wait a bit for the notarization to be fully processed
              await new Promise((resolve) => setTimeout(resolve, 10000));
            }
            execSync(`xcrun stapler staple "${resolvedBinaryPath}"`, { stdio: 'inherit' });
            staplingSucceeded = true;
            break;
          } catch (error) {
            console.log(`⚠️  Stapling attempt ${attempt} failed: ${error}`);
            if (attempt === 3) {
              console.log('⚠️  Stapling failed after 3 attempts, but binary is still notarized');
              console.log('   Users may see a brief verification delay on first run');
            }
          }
        }

        // Verify stapling if it succeeded
        if (staplingSucceeded) {
          console.log('🔍 Verifying stapling...');
          try {
            execSync(`xcrun stapler validate "${resolvedBinaryPath}"`, { stdio: 'inherit' });
            console.log('✅ Stapling verified successfully!');
          } catch (error) {
            console.log('⚠️  Stapling validation failed, but binary should still work');
          }
        }

        // Final spctl check
        console.log('🔍 Final Gatekeeper assessment...');
        try {
          execSync(`spctl --assess --type execute --verbose "${resolvedBinaryPath}"`, {
            stdio: 'inherit',
          });
          console.log('✅ Binary passes Gatekeeper assessment!');
        } catch (error) {
          console.log(
            '⚠️  Gatekeeper assessment failed - this may resolve after stapling propagates'
          );
        }

        console.log('✅ Binary successfully signed and notarized!');
      } catch (error) {
        // If notarization fails, check if it was just a stapling issue
        if (error.toString().includes('staple') || error.toString().includes('Error 73')) {
          console.log('⚠️  Stapling failed, but notarization may have succeeded');
          console.log('   Binary should still work, users may see brief verification delay');
          console.log('✅ Continuing with signed binary...');
        } else {
          console.error('❌ Notarization failed:', error);
          throw error;
        }
      } finally {
        // Clean up ZIP file
        if (existsSync(zipName)) {
          unlinkSync(zipName);
        }
      }
    }
  } finally {
    // Clean up
    if (tempCertPath && tempCertPath.includes('temp-certificate.p12') && existsSync(tempCertPath)) {
      unlinkSync(tempCertPath);
    }

    if (tempKeychainName) {
      try {
        execSync(`security delete-keychain ${tempKeychainName}`, { stdio: 'pipe' });
      } catch {
        // Keychain cleanup failed, not critical
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  signAndNotarize(options).catch((error) => {
    console.error('❌ Signing failed:', error.message);
    process.exit(1);
  });
}

export { signAndNotarize };

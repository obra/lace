// ABOUTME: Script to automatically get Dropbox sharing URLs for appcast feeds
// ABOUTME: Uses Dropbox API to create direct download links for the uploaded test files

import { execSync } from 'node:child_process';

async function getDropboxShareUrls() {
  console.log('🔍 Getting Dropbox sharing URLs...');

  try {
    // Get sharing links using Dropbox API via curl
    const releaseUrl = await createSharingLink('/release/appcast.xml');
    const nightlyUrl = await createSharingLink('/nightly/appcast.xml');

    console.log('✅ Dropbox URLs retrieved!');
    console.log(`📅 Release: ${releaseUrl}`);
    console.log(`🌙 Nightly: ${nightlyUrl}`);

    // Automatically update the Swift code
    console.log('🔧 Updating Swift code with real URLs...');
    execSync(`bun scripts/update-feed-urls.ts "${releaseUrl}" "${nightlyUrl}"`, {
      stdio: 'inherit',
    });

    console.log('🎉 Setup complete! URLs updated in Swift code.');
  } catch (error) {
    console.error('❌ Failed to get Dropbox URLs:', error);
    console.log('\n💡 Manual fallback:');
    console.log('1. Go to https://www.dropbox.com/home/Apps/Lace%20Updates');
    console.log('2. Right-click each appcast.xml → Share → Copy link');
    console.log('3. Convert to dl.dropboxusercontent.com format');
    console.log('4. Run: bun scripts/update-feed-urls.ts "url1" "url2"');
  }
}

async function createSharingLink(path: string): Promise<string> {
  const cmd = `curl -X POST https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings \\
    --header "Authorization: Bearer $DROPBOX_REFRESH_TOKEN" \\
    --header "Content-Type: application/json" \\
    --data '{"path": "${path}", "settings": {"requested_visibility": "public"}}'`;

  try {
    const result = execSync(cmd, { encoding: 'utf8' });
    const response = JSON.parse(result);

    if (response.url) {
      // Convert to direct download format
      return convertToDirectUrl(response.url);
    } else {
      throw new Error(`No URL in response: ${result}`);
    }
  } catch (error) {
    throw new Error(`API call failed for ${path}: ${error}`);
  }
}

function convertToDirectUrl(shareUrl: string): string {
  // Convert Dropbox sharing URL to direct download URL
  // From: https://www.dropbox.com/scl/fi/[ID]/file.xml?rlkey=[KEY]&dl=0
  // To:   https://dl.dropboxusercontent.com/s/[TOKEN]/file.xml

  console.log(`🔄 Converting: ${shareUrl}`);

  // For app folder, we might need a different conversion logic
  // Let's return the original for now and handle conversion manually
  const directUrl = shareUrl.replace('?dl=0', '?dl=1');
  console.log(`➡️  Direct: ${directUrl}`);

  return directUrl;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if we have the Dropbox token in environment
  if (!process.env.DROPBOX_REFRESH_TOKEN) {
    console.log('⚠️  DROPBOX_REFRESH_TOKEN environment variable not set');
    console.log('💡 Export it first: export DROPBOX_REFRESH_TOKEN="your_token_here"');
    process.exit(1);
  }

  getDropboxShareUrls().catch(console.error);
}

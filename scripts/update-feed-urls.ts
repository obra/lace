// ABOUTME: Script to update Sparkle feed URLs with actual Dropbox tokens
// ABOUTME: Run this after setting up your Dropbox app to replace placeholder URLs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface FeedConfig {
  releaseUrl: string;
  nightlyUrl: string;
}

function updateFeedUrls(config: FeedConfig) {
  const mainSwiftPath = join('platforms', 'macos', 'main.swift');

  try {
    let content = readFileSync(mainSwiftPath, 'utf8');

    // Replace placeholder URLs
    content = content.replace(
      /https:\/\/dl\.dropboxusercontent\.com\/s\/\[TOKEN\]\/release\/appcast\.xml/g,
      config.releaseUrl
    );

    content = content.replace(
      /https:\/\/dl\.dropboxusercontent\.com\/s\/\[TOKEN\]\/nightly\/appcast\.xml/g,
      config.nightlyUrl
    );

    writeFileSync(mainSwiftPath, content);

    console.log('✅ Feed URLs updated successfully!');
    console.log(`   🚀 Release: ${config.releaseUrl}`);
    console.log(`   🌙 Nightly: ${config.nightlyUrl}`);
  } catch (error) {
    console.error('❌ Failed to update feed URLs:', error);
    process.exit(1);
  }
}

// Example usage
if (process.argv.length < 4) {
  console.log(`
Usage: bun scripts/update-feed-urls.ts <release-url> <nightly-url>

Example:
bun scripts/update-feed-urls.ts \\
  "https://dl.dropboxusercontent.com/s/abc123/release/appcast.xml" \\
  "https://dl.dropboxusercontent.com/s/def456/nightly/appcast.xml"
`);
  process.exit(1);
}

const [, , releaseUrl, nightlyUrl] = process.argv;

updateFeedUrls({
  releaseUrl,
  nightlyUrl,
});

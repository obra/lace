// ABOUTME: Script to fetch and update provider catalogs from Catwalk repository
// ABOUTME: Syncs provider configuration files from charmbracelet/catwalk to local data directory

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface CatwalkFile {
  name: string;
  download_url: string;
  size: number;
}

const CATWALK_API_URL =
  'https://api.github.com/repos/charmbracelet/catwalk/contents/internal/providers/configs';

// Compute absolute path to data directory from script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCAL_DATA_DIR =
  process.env.LOCAL_DATA_DIR ?? resolve(__dirname, '../packages/core/src/providers/catalog/data');

// Providers to exclude from syncing (if any)
const EXCLUDED_PROVIDERS: string[] = [
  // Add any providers you don't want to sync here
];

async function fetchCatwalkDirectory(): Promise<CatwalkFile[]> {
  console.log('Fetching Catwalk provider configs directory...');

  const response = await fetch(CATWALK_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Catwalk directory: ${response.status} ${response.statusText}`);
  }

  const files = (await response.json()) as CatwalkFile[];
  return files.filter((file) => file.name.endsWith('.json'));
}

async function downloadProviderConfig(file: CatwalkFile): Promise<string> {
  console.log(`Downloading ${file.name}...`);

  const response = await fetch(file.download_url);
  if (!response.ok) {
    throw new Error(`Failed to download ${file.name}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function getLocalFiles(): Promise<string[]> {
  try {
    return await readdir(LOCAL_DATA_DIR);
  } catch (error) {
    console.error('Failed to read local data directory:', error);
    return [];
  }
}

async function compareFiles(localPath: string, remoteContent: string): Promise<boolean> {
  try {
    const localContent = await readFile(localPath, 'utf-8');
    return localContent.trim() === remoteContent.trim();
  } catch (error) {
    // File doesn't exist locally
    return false;
  }
}

async function updateProviderCatalogs(): Promise<void> {
  try {
    console.log('Starting provider catalog update...');

    // Fetch remote file list
    const remoteFiles = await fetchCatwalkDirectory();
    const localFiles = await getLocalFiles();

    // Filter out excluded providers
    const providersToSync = remoteFiles.filter((f) => !EXCLUDED_PROVIDERS.includes(f.name));

    let updatedCount = 0;
    let skippedCount = 0;
    let newCount = 0;

    // Process each provider
    for (const remoteFile of providersToSync) {
      const localPath = join(LOCAL_DATA_DIR, remoteFile.name);
      const remoteContent = await downloadProviderConfig(remoteFile);

      // Check if file needs updating
      const isIdentical = await compareFiles(localPath, remoteContent);
      const isNewFile = !localFiles.includes(remoteFile.name);

      if (isIdentical && !isNewFile) {
        console.log(`✓ ${remoteFile.name} is up to date`);
        skippedCount++;
        continue;
      }

      // Update the file
      await writeFile(localPath, remoteContent, 'utf-8');

      if (isNewFile) {
        console.log(`✨ ${remoteFile.name} added`);
        newCount++;
      } else {
        console.log(`📝 ${remoteFile.name} updated`);
        updatedCount++;
      }
    }

    // Report on excluded providers if any
    if (EXCLUDED_PROVIDERS.length > 0) {
      console.log('\n🚫 Excluded providers:');
      EXCLUDED_PROVIDERS.forEach((name) => console.log(`   - ${name}`));
    }

    console.log('\n🎉 Provider catalog update complete!');
    console.log(`   New: ${newCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}`);
  } catch (error) {
    console.error('❌ Failed to update provider catalogs:', error);
    process.exit(1);
  }
}

// Run the update if this script is executed directly
if (import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href) {
  await updateProviderCatalogs();
}

export { updateProviderCatalogs };

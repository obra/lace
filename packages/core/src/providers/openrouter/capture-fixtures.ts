// ABOUTME: Script to capture real OpenRouter API responses for testing
// ABOUTME: Fetches live data from OpenRouter /api/v1/models endpoint and saves as fixtures

import * as fs from 'fs';
import * as path from 'path';

async function captureOpenRouterResponse() {
  console.log('Fetching OpenRouter models (no API key needed)...');

  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) {
    throw new Error(`Failed: ${response.status}`);
  }

  const data = await response.json();

  // Save to fixtures
  const fixturesDir = './fixtures';
  await fs.promises.mkdir(fixturesDir, { recursive: true });

  await fs.promises.writeFile(
    path.join(fixturesDir, 'models-response.json'),
    JSON.stringify(data, null, 2)
  );

  console.log(`Captured ${data.data.length} models`);

  // Also save a smaller test fixture with just a few models
  const testFixture = {
    data: data.data.slice(0, 10), // First 10 models for tests
  };

  await fs.promises.writeFile(
    path.join(fixturesDir, 'models-response-test.json'),
    JSON.stringify(testFixture, null, 2)
  );
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  captureOpenRouterResponse().catch(console.error);
}

import { test, expect } from './mocks/setup';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment
} from './helpers/test-utils';

test('test environment provides isolated LACE_DIR', async ({ page }) => {
  let testEnv: TestEnvironment;
  
  testEnv = await setupTestEnvironment();
  
  try {
    // Verify we have a temp directory
    expect(testEnv.tempDir).toMatch(/lace-test-/);
    expect(testEnv.projectName).toContain('E2E Test Project');
    
    // Verify LACE_DIR is set
    expect(process.env.LACE_DIR).toBe(testEnv.tempDir);
  } finally {
    await cleanupTestEnvironment(testEnv);
  }
});
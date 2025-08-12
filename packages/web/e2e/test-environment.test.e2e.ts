import { test, expect } from './fixtures/test-environment';

test('test environment fixture provides isolated LACE_DIR', async ({ testEnv }) => {
  // Verify we have a temp directory
  expect(testEnv.tempDir).toMatch(/lace-e2e-worker-\d+-/);
  expect(testEnv.projectName).toContain('E2E Test Project Worker');
  
  // Verify LACE_DIR is set
  expect(process.env.LACE_DIR).toBe(testEnv.tempDir);
});
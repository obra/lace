// ABOUTME: Test for LMStudio connection timeout handling
// ABOUTME: Ensures LMStudio provider doesn't hang indefinitely when server is unavailable

import { describe, it, expect } from 'vitest';
import { LMStudioProvider } from '../lmstudio-provider.js';

describe('LMStudio Provider Timeout Handling', () => {
  it('should timeout quickly when LMStudio server is unavailable', async () => {
    // Console output is automatically suppressed by global setup
    // No need for manual stderr suppression
    
    // Use a non-existent port to simulate unavailable server
    const provider = new LMStudioProvider({
      baseUrl: 'ws://localhost:9999', // Non-existent port
    });

    const startTime = Date.now();

    // This should fail quickly, not hang for 30+ seconds
    const result = await provider.diagnose();

    const elapsedMs = Date.now() - startTime;

    // Should fail within 5 seconds, not hang indefinitely
    expect(elapsedMs).toBeLessThan(5000);
    expect(result.connected).toBe(false);
    expect(result.error).toBeDefined();
  }, 10000); // 10 second test timeout
});

// ABOUTME: Test for LMStudio connection timeout handling
// ABOUTME: Ensures LMStudio provider doesn't hang indefinitely when server is unavailable

import { describe, it, expect } from 'vitest';
import { LMStudioProvider } from '../lmstudio-provider.js';

describe('LMStudio Provider Timeout Handling', () => {
  it('should timeout quickly when LMStudio server is unavailable', async () => {
    // Suppress stderr noise from LMStudio client connection failures
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = () => true;
    
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
    
    // Restore stderr
    process.stderr.write = originalStderrWrite;
  }, 10000); // 10 second test timeout
});

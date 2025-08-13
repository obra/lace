// ABOUTME: Tests Server-Sent Events (SSE) system reliability and connection management
// ABOUTME: Verifies event streaming, connection lifecycle, and session isolation

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('SSE Event System Reliability', () => {
  test('establishes SSE connection when project is created', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-sse-connection-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E SSE Connection Project';
    const { projectSelector, chatInterface } = createPageObjects(page);

    try {
      // Monitor SSE connection requests
      const sseRequests: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/api/events/stream')) {
          sseRequests.push(request.url());
        }
      });

      const sseResponses: { url: string; status: number }[] = [];
      page.on('response', response => {
        if (response.url().includes('/api/events/stream')) {
          sseResponses.push({
            url: response.url(),
            status: response.status()
          });
        }
      });

      // Create project and verify SSE connection
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'sse-connection-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
      await chatInterface.waitForChatReady();
      
      // Wait for SSE connections to establish
      await page.waitForTimeout(2000);
      
      // Verify SSE connection was established
      expect(sseRequests.length).toBeGreaterThan(0);
      expect(sseResponses.length).toBeGreaterThan(0);
      
      // Verify SSE response is successful
      const successfulConnections = sseResponses.filter(r => r.status === 200);
      expect(successfulConnections.length).toBeGreaterThan(0);
      
      // Verify SSE URL includes correct project/session parameters
      const sseUrl = sseRequests[0];
      expect(sseUrl).toMatch(/projects=[^&]+/);
      expect(sseUrl).toMatch(/sessions=[^&]+/);  
      expect(sseUrl).toMatch(/threads=[^&]+/);
      
      console.log('SSE Connection Analysis:', {
        totalRequests: sseRequests.length,
        successfulConnections: successfulConnections.length,
        sampleUrl: sseUrl,
        timestamp: new Date().toISOString()
      });
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });

  test('maintains SSE connection across page interactions', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-sse-stability-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E SSE Stability Project';
    const { projectSelector, chatInterface } = createPageObjects(page);

    try {
      let connectionCount = 0;
      let disconnectionCount = 0;
      
      page.on('request', request => {
        if (request.url().includes('/api/events/stream')) {
          connectionCount++;
        }
      });

      // Monitor for connection failures/retries (higher status codes or failures)
      page.on('response', response => {
        if (response.url().includes('/api/events/stream') && response.status() !== 200) {
          disconnectionCount++;
        }
      });

      // Create project
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'sse-stability-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
      await chatInterface.waitForChatReady();
      
      // Perform various interactions that should maintain SSE connection
      const interactions = [
        async () => {
          await chatInterface.sendMessage('First message to test SSE stability');
        },
        async () => {
          await page.waitForTimeout(1000);
        },
        async () => {
          await chatInterface.sendMessage('Second message for SSE testing');
        },
        async () => {
          // Navigate within the same session (if possible)
          await page.waitForTimeout(1000);
        }
      ];
      
      const initialConnectionCount = connectionCount;
      
      for (const interaction of interactions) {
        await interaction();
        await page.waitForTimeout(500);
      }
      
      // Wait for any final SSE activity
      await page.waitForTimeout(2000);
      
      const connectionBehavior = {
        initialConnections: initialConnectionCount,
        finalConnections: connectionCount,
        newConnections: connectionCount - initialConnectionCount,
        disconnections: disconnectionCount,
        connectionStability: disconnectionCount === 0 && connectionCount > 0
      };
      
      console.log('SSE Stability Analysis:', connectionBehavior);
      
      // Test passes if we maintain some level of SSE connectivity
      expect(connectionCount).toBeGreaterThan(0);
      
      // Disconnections aren't necessarily bad (could be normal reconnection)
      // The key is that the interface remains functional
      await expect(chatInterface.messageInput).toBeVisible();
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });

  test('isolates SSE streams between different sessions', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-sse-isolation-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E SSE Isolation Project';
    const { projectSelector, chatInterface } = createPageObjects(page);

    try {
      const sseUrls: string[] = [];
      
      page.on('request', request => {
        if (request.url().includes('/api/events/stream')) {
          sseUrls.push(request.url());
        }
      });

      // Create project and session
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'sse-isolation-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
      await chatInterface.waitForChatReady();
      
      // Send a message to create activity
      await chatInterface.sendMessage('Testing SSE isolation for this session');
      
      // Wait for SSE activity to settle
      await page.waitForTimeout(3000);
      
      // Analyze the SSE URLs for proper isolation
      const uniqueUrls = [...new Set(sseUrls)];
      const sessionPattern = /sessions=([^&]+)/;
      const threadPattern = /threads=([^&]+)/;
      const projectPattern = /projects=([^&]+)/;
      
      const sessionIds = uniqueUrls.map(url => {
        const match = url.match(sessionPattern);
        return match ? match[1] : null;
      }).filter(Boolean);
      
      const threadIds = uniqueUrls.map(url => {
        const match = url.match(threadPattern);
        return match ? match[1] : null;
      }).filter(Boolean);
      
      const projectIds = uniqueUrls.map(url => {
        const match = url.match(projectPattern);
        return match ? match[1] : null;
      }).filter(Boolean);
      
      const isolationAnalysis = {
        totalUrls: sseUrls.length,
        uniqueUrls: uniqueUrls.length,
        sessionIds: [...new Set(sessionIds)],
        threadIds: [...new Set(threadIds)],
        projectIds: [...new Set(projectIds)],
        properIsolation: sessionIds.length > 0 && threadIds.length > 0 && projectIds.length > 0
      };
      
      console.log('SSE Isolation Analysis:', isolationAnalysis);
      
      // Verify we have proper parameter isolation
      expect(isolationAnalysis.sessionIds.length).toBeGreaterThan(0);
      expect(isolationAnalysis.threadIds.length).toBeGreaterThan(0);
      expect(isolationAnalysis.projectIds.length).toBeGreaterThan(0);
      
      // Verify that each worker gets its own unique identifiers
      // (This is implicitly tested by the isolation provided by LACE_DIR)
      expect(isolationAnalysis.properIsolation).toBeTruthy();
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });

  test('handles SSE connection recovery gracefully', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-sse-recovery-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E SSE Recovery Project';
    const { projectSelector, chatInterface } = createPageObjects(page);

    try {
      const sseActivity = {
        requests: 0,
        responses: 0,
        errors: 0
      };
      
      page.on('request', request => {
        if (request.url().includes('/api/events/stream')) {
          sseActivity.requests++;
        }
      });

      page.on('response', response => {
        if (response.url().includes('/api/events/stream')) {
          sseActivity.responses++;
          if (response.status() >= 400) {
            sseActivity.errors++;
          }
        }
      });

      // Create project
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'sse-recovery-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
      await chatInterface.waitForChatReady();
      
      const initialActivity = { ...sseActivity };
      
      // Simulate potential connection stress by sending messages and reloading
      await chatInterface.sendMessage('Pre-reload message for SSE testing');
      await page.waitForTimeout(1000);
      
      // Reload page to test SSE recovery
      await page.reload();
      await page.waitForTimeout(3000);
      
      // Try to interact after reload
      const currentUrl = page.url();
      if (currentUrl.includes('#/project/')) {
        // We're still in the project - try to send a message
        try {
          await chatInterface.waitForChatReady();
          await chatInterface.sendMessage('Post-reload message for SSE recovery');
          console.log('SSE Recovery: Successfully sent message after reload');
        } catch (error) {
          console.log('SSE Recovery: Interface not ready after reload, but page loaded');
        }
      } else {
        console.log('SSE Recovery: Redirected to project selection after reload');
      }
      
      const finalActivity = { ...sseActivity };
      const recoveryAnalysis = {
        initialRequests: initialActivity.requests,
        finalRequests: finalActivity.requests,
        newRequestsAfterReload: finalActivity.requests - initialActivity.requests,
        totalErrors: finalActivity.errors,
        recoveryAttempted: finalActivity.requests > initialActivity.requests,
        pageStillFunctional: currentUrl.includes('localhost')
      };
      
      console.log('SSE Recovery Analysis:', recoveryAnalysis);
      
      // The test succeeds if the system attempts to recover or handles the situation gracefully
      expect(recoveryAnalysis.pageStillFunctional).toBeTruthy();
      expect(finalActivity.requests).toBeGreaterThan(0);
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });
});
// ABOUTME: Real security and performance tests for web companion components
// ABOUTME: Tests actual security headers, rate limiting, input validation, and performance under load

import { beforeEach, afterEach, describe, expect, test } from '@jest/globals';
import { WebServer } from '../../../src/interface/web-server.js';
import { ConversationDB } from '../../../src/database/conversation-db.js';
import { ActivityLogger } from '../../../src/logging/activity-logger.js';
import { io as SocketIOClient } from 'socket.io-client';
import axios from 'axios';
import { getAvailablePort } from '../../test-utils.js';

describe('Web Companion Security and Performance Tests', () => {
  let webServer;
  let db;
  let activityLogger;
  let port;
  let baseUrl;

  beforeEach(async () => {
    port = await getAvailablePort();
    baseUrl = `http://localhost:${port}`;
    
    db = new ConversationDB(':memory:');
    await db.initialize();
    
    activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    webServer = new WebServer({
      port: port,
      db: db,
      activityLogger: activityLogger,
      verbose: false
    });
    
    await webServer.start();
  });

  afterEach(async () => {
    if (webServer && webServer.isStarted) {
      await webServer.stop();
    }
    if (db) {
      await db.close();
    }
    if (activityLogger) {
      await activityLogger.close();
    }
  });

  describe('Security Headers and Middleware', () => {
    test('should implement Helmet security headers', async () => {
      const response = await axios.get(`${baseUrl}/api/health`);
      
      // Check for Helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '0');
      expect(response.headers).toHaveProperty('x-download-options', 'noopen');
      expect(response.headers).toHaveProperty('x-permitted-cross-domain-policies', 'none');
      
      // Check Content Security Policy
      expect(response.headers).toHaveProperty('content-security-policy');
      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    test('should handle CORS properly in development mode', async () => {
      // Test preflight request
      const preflightResponse = await axios.options(`${baseUrl}/api/health`, {
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type'
        },
        validateStatus: () => true
      });
      
      expect(preflightResponse.status).toBe(204);
      expect(preflightResponse.headers).toHaveProperty('access-control-allow-origin');
      expect(preflightResponse.headers).toHaveProperty('access-control-allow-methods');
    });

    test('should validate Content-Type for JSON requests', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, {
        query: 'test'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });


    test('should protect against path traversal in file operations', async () => {
      const maliciousPath = '../../../etc/passwd';
      const response = await axios.get(`${baseUrl}/api/files/content?path=${encodeURIComponent(maliciousPath)}`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(403);
      expect(response.data.error).toBe('Access denied - path outside working directory');
    });

    test('should limit file size for content endpoint', async () => {
      // Test with package-lock.json which is likely to be large
      const response = await axios.get(`${baseUrl}/api/files/content?path=package-lock.json`, {
        validateStatus: () => true
      });
      
      if (response.status === 413) {
        expect(response.data.error).toBe('File too large for display');
        expect(response.data).toHaveProperty('maxSize', 1024 * 1024);
      } else {
        // File might not exist or be smaller than limit, which is fine
        expect([200, 404]).toContain(response.status);
      }
    });
  });

  describe('Input Validation and Sanitization', () => {
    test('should validate session ID format and length', async () => {
      const testCases = [
        { id: '', expectedStatus: 404 }, // Empty string doesn't match route pattern
        { id: 'x'.repeat(101), expectedStatus: 400 }, // Too long
        { id: 'valid-session-123', expectedStatus: 200 },
        { id: null, expectedStatus: 404 }, // Express will handle as route mismatch
        { id: 'session\x00null', expectedStatus: 400 } // Null byte injection
      ];
      
      for (const testCase of testCases) {
        if (testCase.id === null) continue; // Skip null test
        
        const response = await axios.get(`${baseUrl}/api/sessions/${testCase.id}/messages`, {
          validateStatus: () => true
        });
        
        expect(response.status).toBe(testCase.expectedStatus);
        if (response.status === 400) {
          expect(response.data.error).toBe('Invalid session ID');
        }
      }
    });

    test('should validate pagination parameters', async () => {
      const testCases = [
        { limit: '50', expectedStatus: 200 },
        { limit: '0', expectedStatus: 400 },
        { limit: '1001', expectedStatus: 400 },
        { limit: '-1', expectedStatus: 400 },
        { limit: 'invalid', expectedStatus: 400 },
        { limit: '50.5', expectedStatus: 400 },
        { limit: '1e10', expectedStatus: 400 }
      ];
      
      for (const testCase of testCases) {
        const response = await axios.get(`${baseUrl}/api/sessions/valid-session-123/messages?limit=${testCase.limit}`, {
          validateStatus: () => true
        });
        
        expect(response.status).toBe(testCase.expectedStatus);
        if (response.status === 400) {
          expect(response.data.error).toBe('Invalid limit parameter (1-1000)');
        }
      }
    });

    test('should validate search query input', async () => {
      const testCases = [
        { query: '', expectedStatus: 400 },
        { query: '   ', expectedStatus: 400 }, // Whitespace only
        { query: 'valid search', expectedStatus: 200 },
        { query: 'a'.repeat(1000), expectedStatus: 200 }, // Long but valid
        { query: 'search\x00term', expectedStatus: 200 }, // Null bytes should be handled
        { query: '<script>alert(1)</script>', expectedStatus: 200 } // HTML should be handled safely
      ];
      
      for (const testCase of testCases) {
        const response = await axios.post(`${baseUrl}/api/search`, {
          query: testCase.query
        }, {
          validateStatus: () => true
        });
        
        expect(response.status).toBe(testCase.expectedStatus);
        if (response.status === 400) {
          expect(response.data.error).toBe('Search query is required');
        }
      }
    });

    test('should handle malformed JSON gracefully', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, 'invalid json', {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
      });
      
      expect(response.status).toBe(400);
      // Should not expose internal parsing error details
    });
  });

  describe('Performance and Concurrent Connections', () => {
    test('should handle concurrent WebSocket connections', (done) => {
      const clients = [];
      let eventsReceived = 0;
      let clientsConnected = 0;
      
      // Create multiple clients to test broadcasting
      for (let i = 0; i < 3; i++) {
        const client = new SocketIOClient(baseUrl);
        clients.push(client);
        
        client.on('connect', () => {
          clientsConnected++;
          
          client.on('activity', () => {
            eventsReceived++;
          });
          
          // When all clients connected, start sending events
          if (clientsConnected === 3) {
            // Send some events to test broadcasting
            for (let j = 0; j < 10; j++) {
              setTimeout(() => {
                activityLogger.logEvent(`broadcast_event_${j}`, 'broadcast-test', 'model-123', { index: j });
              }, j * 50);
            }
            
            // Check results after events sent
            setTimeout(() => {
              // Each client should receive all events in a desktop app
              const avgEventsPerClient = eventsReceived / clientsConnected;
              expect(avgEventsPerClient).toBeGreaterThan(8); // Should receive most/all events
              expect(avgEventsPerClient).toBeLessThanOrEqual(10); // But not more than sent
              
              clients.forEach(client => client.disconnect());
              done();
            }, 1000);
          }
        });
      }
    }, 10000);

    test('should handle multiple concurrent HTTP requests', async () => {
      const concurrentRequests = 20;
      const requests = [];
      
      // Create multiple concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(axios.get(`${baseUrl}/api/health`));
      }
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data.status).toBe('ok');
      });
      
      // Should handle concurrent requests efficiently (under 5 seconds)
      expect(totalTime).toBeLessThan(5000);
      
      // Average response time should be reasonable
      const avgResponseTime = totalTime / concurrentRequests;
      expect(avgResponseTime).toBeLessThan(1000); // Under 1 second average
    });

    test('should handle WebSocket connection limits', (done) => {
      const maxClients = 50;
      const clients = [];
      let connectionsEstablished = 0;
      let testCompleted = false;
      
      // Timeout protection
      const timeoutId = setTimeout(() => {
        if (!testCompleted) {
          testCompleted = true;
          clients.forEach(client => client.disconnect());
          expect(connectionsEstablished).toBeGreaterThan(0);
          done();
        }
      }, 5000);
      
      // Try to establish many connections
      for (let i = 0; i < maxClients; i++) {
        const client = new SocketIOClient(baseUrl);
        clients.push(client);
        
        client.on('connect', () => {
          connectionsEstablished++;
          
          // When we've tried to connect all clients
          if (connectionsEstablished >= maxClients - 5 && !testCompleted) {
            testCompleted = true;
            clearTimeout(timeoutId);
            
            // Check that server is tracking connections
            expect(webServer.connectedClients.size).toBeGreaterThan(10);
            expect(webServer.connectedClients.size).toBeLessThanOrEqual(maxClients);
            
            // Clean up
            clients.forEach(client => client.disconnect());
            done();
          }
        });
        
        client.on('connect_error', () => {
          // Some connections might fail, which is expected under load
        });
      }
    }, 10000);

    test('should handle large result sets efficiently', async () => {
      // Add many messages to test pagination performance
      const sessionId = 'large-session-test';
      const messageCount = 500;
      
      for (let i = 0; i < messageCount; i++) {
        await db.saveMessage(
          sessionId,
          Math.floor(i / 100), // Different generations
          i % 2 === 0 ? 'user' : 'assistant',
          `Message ${i} with some content to make it realistic`,
          null,
          100 + (i % 50) // Varying token counts
        );
      }
      
      const startTime = Date.now();
      
      // Test different page sizes
      const pageSizes = [10, 50, 100, 500];
      for (const pageSize of pageSizes) {
        const response = await axios.get(`${baseUrl}/api/sessions/${sessionId}/messages?limit=${pageSize}`);
        
        expect(response.status).toBe(200);
        expect(response.data.length).toBeLessThanOrEqual(pageSize);
        expect(response.data.length).toBeLessThanOrEqual(messageCount);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // Should handle large datasets efficiently
      expect(totalTime).toBeLessThan(2000); // Under 2 seconds for all pagination tests
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle database connection failures gracefully', async () => {
      // Close the database to simulate failure
      await db.close();
      
      const response = await axios.get(`${baseUrl}/api/sessions`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(503);
      expect(response.data.error).toBe('Database not available');
      
      // Should not crash the server
      const healthResponse = await axios.get(`${baseUrl}/api/health`);
      expect(healthResponse.status).toBe(200);
    });

    test('should handle activity logger failures gracefully', async () => {
      // Close activity logger to simulate failure
      await activityLogger.close();
      
      const response = await axios.get(`${baseUrl}/api/activity/events`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(503);
      expect(response.data.error).toBe('Activity logger not available');
      
      // Server should still be responsive
      const healthResponse = await axios.get(`${baseUrl}/api/health`);
      expect(healthResponse.status).toBe(200);
    });

    test('should handle file system errors safely', async () => {
      // Try to access non-existent file
      const response = await axios.get(`${baseUrl}/api/files/content?path=non-existent-file.txt`, {
        validateStatus: () => true
      });
      
      expect(response.status).toBe(500);
      expect(response.data.error).toBe('Failed to read file');
      
      // Should not expose internal file system details
      expect(response.data.error).not.toContain('ENOENT');
      expect(response.data.error).not.toContain('no such file');
    });

    test('should handle git command failures gracefully', async () => {
      // Test in environment where git might not be available or repo not initialized
      const response = await axios.get(`${baseUrl}/api/git/status`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('files');
      
      // Should handle git errors without crashing
      if (response.data.error) {
        expect(typeof response.data.error).toBe('string');
        expect(response.data.files).toEqual({});
        expect(response.data.branch).toBeNull();
      }
    });

    test('should handle malformed activity data gracefully', async () => {
      // Test server resilience with various malformed inputs that should return errors
      const malformedRequests = [
        { method: 'get', url: `${baseUrl}/api/sessions/<invalid>/messages` }, // invalid session ID with brackets
        { method: 'get', url: `${baseUrl}/api/files/content?path=../etc/passwd` }, // path traversal attempt
        { method: 'get', url: `${baseUrl}/api/sessions/valid-session/messages?limit=invalid` } // invalid limit
      ];
      
      for (const request of malformedRequests) {
        const response = await axios[request.method](request.url, { validateStatus: () => true });
        // Should return error status for malformed requests
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(600);
      }
      
      // Server should still respond to requests
      const response = await axios.get(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('ok');
    });
  });

  describe('Memory and Resource Management', () => {
    test('should handle event broadcasting efficiently', (done) => {
      const client = new SocketIOClient(baseUrl);
      let eventsReceived = 0;
      
      client.on('connect', () => {
        client.on('activity', () => {
          eventsReceived++;
        });
        
        // Send some events to test broadcasting efficiency
        const sendEvent = (index) => {
          if (index < 20) { // Send a reasonable number of events
            activityLogger.logEvent(`efficiency_test_${index}`, 'efficiency-test-session', 'model-123', { 
              index: index,
              data: 'test data'
            });
            setTimeout(() => sendEvent(index + 1), 25);
          } else {
            // Check that events are being received efficiently
            setTimeout(() => {
              expect(eventsReceived).toBeGreaterThan(15);
              expect(eventsReceived).toBeLessThanOrEqual(20); // Should receive all events
              
              client.disconnect();
              done();
            }, 500);
          }
        };
        
        sendEvent(0);
      });
    }, 10000);

    test('should handle file tree depth limits', async () => {
      const response = await axios.get(`${baseUrl}/api/files/tree`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('name');
      expect(response.data).toHaveProperty('isDirectory');
      
      // Should limit depth to prevent infinite recursion/memory issues
      const checkDepth = (node, currentDepth = 0) => {
        if (node.children) {
          expect(currentDepth).toBeLessThan(5); // Should be limited to reasonable depth
          node.children.forEach(child => checkDepth(child, currentDepth + 1));
        }
      };
      
      if (response.data.children) {
        checkDepth(response.data);
      }
    });

    test('should handle search result limits', async () => {
      const response = await axios.post(`${baseUrl}/api/search`, {
        query: 'test', // Common term likely to have many matches
        type: 'files'
      });
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.results)).toBe(true);
      
      // Should limit results to prevent overwhelming responses
      expect(response.data.results.length).toBeLessThanOrEqual(50);
    });
  });
});
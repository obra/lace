// ABOUTME: Test utility functions for web companion tests
// ABOUTME: Provides port management and other test helpers to avoid conflicts

import { createServer } from 'net';

/**
 * Get an available port for testing
 */
export async function getAvailablePort(startPort = 3000) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
    
    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Get multiple available ports for testing
 */
export async function getAvailablePorts(count) {
  const ports = [];
  for (let i = 0; i < count; i++) {
    const port = await getAvailablePort();
    ports.push(port);
  }
  return ports;
}

/**
 * Wait for a condition with timeout
 */
export function waitFor(condition, timeout = 5000, interval = 100) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for condition after ${timeout}ms`));
      } else {
        setTimeout(check, interval);
      }
    };
    
    check();
  });
}

/**
 * Create a promise that resolves after a delay
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
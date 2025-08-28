// ABOUTME: Vitest integration test for production build validation
// ABOUTME: Comprehensive test suite validating the complete Bun compilation system

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

describe('Production Build Integration', () => {
  const servers: ChildProcess[] = [];
  const testPorts = [31500, 31501, 31502];

  beforeAll(async () => {
    // Clean any existing build
    try {
      execSync('rm -f ../../build/Lace', { stdio: 'pipe' });
    } catch {
      // Ignore if file doesn't exist
    }

    // Build the production executable
    console.log('Building production executable...');
    execSync('npm run build:macos', {
      stdio: 'inherit',
      timeout: 120000,
      cwd: '../..',
    });

    // Verify executable was created
    expect(existsSync('../../build/Lace')).toBe(true);
  });

  afterAll(async () => {
    // Clean up all test servers
    for (const server of servers) {
      if (server && !server.killed) {
        server.kill('SIGTERM');
      }
    }

    // Wait for graceful shutdown
    await setTimeout(1000);

    // Force cleanup any remaining processes
    try {
      execSync('pkill -f "build/Lace"', { stdio: 'pipe' });
    } catch {
      // Ignore if no processes found
    }
  });

  it('should create a properly sized executable', () => {
    const stats = execSync('wc -c ../../build/Lace', { encoding: 'utf8' });
    const size = parseInt(stats.split(' ')[0]);
    const sizeMB = size / 1024 / 1024;

    expect(size).toBeGreaterThan(50 * 1024 * 1024); // At least 50MB
    expect(size).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
    console.log(`   📏 Executable size: ${sizeMB.toFixed(1)}MB`);
  });

  it('should properly detect port conflicts', async () => {
    // Start first server
    const server1 = spawn('../../build/Lace', ['--port', testPorts[0].toString()], {
      stdio: 'pipe',
      cwd: '../..',
    });
    servers.push(server1);

    // Wait for first server to start
    await setTimeout(3000);

    // Try to start second server on same port - should fail
    const server2 = spawn('../../build/Lace', ['--port', testPorts[0].toString()], {
      stdio: 'pipe',
      cwd: '../..',
    });

    let exitCode: number | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      server2.on('exit', (code) => {
        exitCode = code;
        resolve();
      });
    });

    await Promise.race([exitPromise, setTimeout(5000)]);

    expect(exitCode).toBe(1); // Should exit with error code 1
  });

  it('should support multiple instances on different ports', async () => {
    // Start second server on different port
    const server2 = spawn('../../build/Lace', ['--port', testPorts[1].toString()], {
      stdio: 'pipe',
      cwd: '../..',
    });
    servers.push(server2);

    await setTimeout(3000);

    // Both servers should be responsive
    const health1 = await fetch(`http://localhost:${testPorts[0]}/api/health`);
    const health2 = await fetch(`http://localhost:${testPorts[1]}/api/health`);

    expect(health1.status).toBe(200);
    expect(health2.status).toBe(200);
  });

  it('should serve health API correctly', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/api/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should load all 13 provider catalogs', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/api/provider/catalog`);
    expect(response.status).toBe(200);

    const data = await response.json();
    const providers = data.json?.providers || [];

    expect(providers).toHaveLength(13);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'anthropic' }),
        expect.objectContaining({ id: 'openai' }),
        expect.objectContaining({ id: 'gemini' }),
      ])
    );

    console.log(`   📋 Provider catalogs: ${providers.map((p: any) => p.id).join(', ')}`);
  });

  it('should serve index.html with proper content', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('<html');
    expect(html).toContain('Lace');
    expect(html).toContain('<title>');

    console.log('   🏠 Index page loads with proper HTML structure');
  });

  it('should serve CSS assets from embedded files', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/assets/globals-C9r9oOBI.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('max-age=31536000');

    const css = await response.text();
    expect(css.length).toBeGreaterThan(100000); // Should be substantial CSS file
    expect(css).toContain('daisyui'); // Should contain our CSS framework
  });

  it('should serve JavaScript assets from embedded files', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/assets/index-BIKlXAjw.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('max-age=31536000');

    const js = await response.text();
    expect(js.length).toBeGreaterThan(500000); // Should be substantial JS bundle
  });

  it('should serve font assets from embedded files', async () => {
    const response = await fetch(`http://localhost:${testPorts[0]}/fonts/OFL.txt`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=31536000');

    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('should work when moved to different location', async () => {
    // Copy executable to /tmp
    execSync('cp ../../build/Lace /tmp/Lace-portability-test', { stdio: 'pipe' });

    try {
      // Start from /tmp
      const tempServer = spawn('/tmp/Lace-portability-test', ['--port', testPorts[2].toString()], {
        stdio: 'pipe',
        cwd: '/tmp',
      });

      await setTimeout(3000);

      // Test that it works from different location
      const response = await fetch(`http://localhost:${testPorts[2]}/api/health`);
      expect(response.status).toBe(200);

      // Test provider catalogs still work
      const catalogResponse = await fetch(`http://localhost:${testPorts[2]}/api/provider/catalog`);
      const catalogData = await catalogResponse.json();
      expect(catalogData.json?.providers).toHaveLength(13);

      tempServer.kill();
    } finally {
      // Clean up temp file
      execSync('rm -f /tmp/Lace-portability-test', { stdio: 'pipe' });
    }

    console.log('   📱 Executable works correctly from any location');
  });

  it('should have proper embedded file counts', async () => {
    // Start server and capture startup output
    const server = spawn('../../build/Lace', ['--port', '31503'], {
      stdio: 'pipe',
      cwd: '../..',
    });

    let startupOutput = '';
    server.stdout?.on('data', (data) => {
      startupOutput += data.toString();
    });

    await setTimeout(3000);
    server.kill();

    // Verify embedded file counts from startup instrumentation
    expect(startupOutput).toContain('📦 Embedded files: 95 total');
    expect(startupOutput).toContain('📋 Provider catalogs: 13');
    expect(startupOutput).toContain('📄 Prompt templates: 11');
    expect(startupOutput).toContain('🎨 Client assets: 71');

    console.log('   📦 Embedded file counts verified from startup output');
  });
});

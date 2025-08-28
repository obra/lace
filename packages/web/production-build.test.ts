// ABOUTME: Vitest integration test for production build validation
// ABOUTME: Comprehensive test suite validating the complete Bun compilation system

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
      cwd: '../..'
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
    await setTimeout(2000);
    
    // Force cleanup any remaining processes
    try {
      execSync('pkill -f "build/Lace"', { stdio: 'pipe' });
    } catch {
      // Ignore if no processes found
    }
  });

  it('should create a properly sized executable', () => {
    const stats = statSync('../../build/Lace');
    const sizeMB = stats.size / 1024 / 1024;
    
    expect(stats.size).toBeGreaterThan(50 * 1024 * 1024); // At least 50MB
    expect(stats.size).toBeLessThan(100 * 1024 * 1024);   // Less than 100MB
    console.log(`   📏 Executable size: ${sizeMB.toFixed(1)}MB`);
  });

  it('should properly detect port conflicts', async () => {
    // Start first server
    const server1 = spawn('../../build/Lace', ['--port', testPorts[0].toString()], {
      stdio: 'pipe',
      cwd: '../..'
    });
    servers.push(server1);
    
    // Wait for first server to start
    await setTimeout(4000);

    // Try to start second server on same port - should fail quickly
    const server2 = spawn('../../build/Lace', ['--port', testPorts[0].toString()], {
      stdio: 'pipe', 
      cwd: '../..'
    });

    let exitCode: number | null = null;
    let stderr = '';
    
    server2.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    const exitPromise = new Promise<void>((resolve) => {
      server2.on('exit', (code) => {
        exitCode = code;
        resolve();
      });
    });

    await Promise.race([exitPromise, setTimeout(8000)]);
    
    expect(exitCode).toBe(1); // Should exit with error code 1
    expect(stderr).toContain('already in use'); // Should show port conflict message
  });

  it('should support multiple instances on different ports', async () => {
    // Start second server on different port
    const server2 = spawn('../../build/Lace', ['--port', testPorts[1].toString()], {
      stdio: 'pipe',
      cwd: '../..'
    });
    servers.push(server2);
    
    await setTimeout(4000);
    
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
        expect.objectContaining({ id: 'gemini' })
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

  it('should serve all assets referenced in index.html from embedded files', async () => {
    // Get index.html and discover all asset references
    const indexResponse = await fetch(`http://localhost:${testPorts[0]}/`);
    expect(indexResponse.status).toBe(200);
    
    const html = await indexResponse.text();
    
    // Extract all asset URLs from the HTML
    const cssMatches = [...html.matchAll(/href="([^"]+\.css)"/g)];
    const jsMatches = [...html.matchAll(/src="([^"]+\.js)"/g)];
    
    const assetUrls = [
      ...cssMatches.map(m => m[1]),
      ...jsMatches.map(m => m[1])
    ].filter(url => url.startsWith('/assets') || url.startsWith('/fonts'));
    
    expect(assetUrls.length).toBeGreaterThan(0);
    console.log(`   🔍 Found ${assetUrls.length} asset references in HTML`);
    
    // Test each discovered asset
    let servedCount = 0;
    for (const assetUrl of assetUrls) {
      const response = await fetch(`http://localhost:${testPorts[0]}${assetUrl}`);
      
      expect(response.status, `Asset ${assetUrl} should be served`).toBe(200);
      expect(response.headers.get('cache-control')).toContain('max-age=31536000');
      
      const content = await response.text();
      expect(content.length, `Asset ${assetUrl} should have content`).toBeGreaterThan(0);
      
      servedCount++;
    }
    
    console.log(`   ✅ All ${servedCount} referenced assets served correctly from embedded files`);
  });

  it('should work when moved to different location', async () => {
    // Copy executable to /tmp
    execSync('cp ../../build/Lace /tmp/Lace-portability-test', { stdio: 'pipe' });
    
    try {
      // Start from /tmp
      const tempServer = spawn('/tmp/Lace-portability-test', ['--port', testPorts[2].toString()], {
        stdio: 'pipe',
        cwd: '/tmp'
      });
      
      await setTimeout(4000);
      
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

  it('should have proper embedded file counts in startup output', async () => {
    // Start server and capture startup output
    const server = spawn('../../build/Lace', ['--port', '31503'], {
      stdio: 'pipe',
      cwd: '../..'
    });
    
    let startupOutput = '';
    server.stdout?.on('data', (data) => {
      startupOutput += data.toString();
    });
    
    await setTimeout(4000);
    server.kill();
    
    // Verify embedded file counts from startup instrumentation
    expect(startupOutput).toContain('📦 Embedded files:');
    expect(startupOutput).toContain('📋 Provider catalogs: 13');
    expect(startupOutput).toContain('📄 Prompt templates: 11');
    expect(startupOutput).toContain('🎨 Client assets:');
    
    console.log('   📦 Embedded file counts verified from startup output');
  });
});
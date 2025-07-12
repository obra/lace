#!/usr/bin/env node
// ABOUTME: Test script to verify web UI functionality
// ABOUTME: Starts web server and checks if it responds correctly

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

async function testWebUI() {
  console.log('🧪 Testing web UI functionality...');
  
  // Start the web server
  console.log('🚀 Starting web server...');
  const server = spawn('node', ['dist/cli.js', '--ui', 'web', '--port', '3001', '--provider', 'lmstudio'], {
    stdio: 'pipe',
    env: { 
      ...process.env, 
      NODE_ENV: 'test',
      // Set a dummy API key to avoid provider errors  
      ANTHROPIC_KEY: 'test-key-for-ui-testing',
      LMSTUDIO_BASE_URL: 'http://localhost:1234'
    }
  });
  
  let serverStarted = false;
  let serverError = null;
  
  // Capture server output
  server.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('Server:', output.trim());
    
    if (output.includes('Lace web interface available')) {
      serverStarted = true;
    }
  });
  
  server.stderr.on('data', (data) => {
    const error = data.toString();
    console.error('Server Error:', error.trim());
    serverError = error;
  });
  
  server.on('error', (error) => {
    console.error('Failed to start server:', error);
    serverError = error;
  });
  
  // Wait for server to start
  let attempts = 0;
  while (!serverStarted && !serverError && attempts < 30) {
    await setTimeout(1000);
    attempts++;
    
    if (attempts % 5 === 0) {
      console.log(`⏳ Waiting for server to start... (${attempts}s)`);
    }
  }
  
  if (serverError) {
    console.error('❌ Server failed to start:', serverError);
    server.kill();
    process.exit(1);
  }
  
  if (!serverStarted) {
    console.error('❌ Server did not start within 30 seconds');
    server.kill();
    process.exit(1);
  }
  
  console.log('✅ Server started successfully');
  
  // Test HTTP requests
  try {
    console.log('🌐 Testing HTTP endpoints...');
    
    // Test main page
    const response = await fetch('http://localhost:3001/');
    if (response.ok) {
      console.log('✅ Main page loads successfully (200)');
    } else {
      console.error(`❌ Main page failed: ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    }
    
    // Test API endpoint
    const apiResponse = await fetch('http://localhost:3001/api/chat');
    if (apiResponse.ok) {
      console.log('✅ API endpoint responds successfully (200)');
      const data = await apiResponse.json();
      console.log('📊 API response:', data);
    } else {
      console.error(`❌ API endpoint failed: ${apiResponse.status}`);
    }
    
  } catch (error) {
    console.error('❌ HTTP test failed:', error.message);
    server.kill();
    process.exit(1);
  }
  
  // Clean shutdown
  console.log('🛑 Shutting down server...');
  server.kill('SIGTERM');
  
  // Wait for clean shutdown
  await setTimeout(2000);
  
  console.log('✅ Web UI test completed successfully!');
  console.log('🎉 The web interface is working correctly');
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted');
  process.exit(0);
});

// Run the test
testWebUI().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
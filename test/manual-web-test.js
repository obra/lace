// ABOUTME: Manual test script to verify web companion functionality end-to-end
// ABOUTME: Run this to test that the web server starts and basic endpoints work

import fetch from 'node-fetch';
import { io as Client } from 'socket.io-client';

const TEST_PORT = 3005;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Manual test runner
async function runManualTests() {
  console.log('🧪 Starting manual web companion tests...\n');

  // Test 1: Health check
  try {
    console.log('1. Testing health check endpoint...');
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthResponse.json();
    console.log('   ✅ Health check passed:', healthData);
  } catch (error) {
    console.log('   ❌ Health check failed:', error.message);
    console.log('   💡 Make sure to start Lace with: npm start -- --web-port 3005');
    return;
  }

  // Test 2: Sessions endpoint
  try {
    console.log('\n2. Testing sessions endpoint...');
    const sessionsResponse = await fetch(`${BASE_URL}/api/sessions`);
    const sessionsData = await sessionsResponse.json();
    console.log('   ✅ Sessions endpoint passed, found', sessionsData.length, 'sessions');
  } catch (error) {
    console.log('   ❌ Sessions endpoint failed:', error.message);
  }

  // Test 3: WebSocket connection
  try {
    console.log('\n3. Testing WebSocket connection...');
    const client = Client(BASE_URL);
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 5000);

      client.on('connect', () => {
        clearTimeout(timeout);
        console.log('   ✅ WebSocket connection successful');
        
        // Test event filtering
        client.emit('filter-activity', { eventType: 'user_input' });
        console.log('   ✅ Event filtering message sent');
        
        // Test session subscription
        client.emit('subscribe-session', 'test-session');
        console.log('   ✅ Session subscription message sent');
        
        client.disconnect();
        resolve();
      });

      client.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } catch (error) {
    console.log('   ❌ WebSocket test failed:', error.message);
  }

  // Test 4: Static file serving
  try {
    console.log('\n4. Testing static file serving...');
    const indexResponse = await fetch(BASE_URL);
    const indexContent = await indexResponse.text();
    
    if (indexContent.includes('Lace Web Companion')) {
      console.log('   ✅ Static file serving works');
    } else {
      console.log('   ❌ Static file content not as expected');
    }
  } catch (error) {
    console.log('   ❌ Static file serving failed:', error.message);
  }

  console.log('\n🎉 Manual tests completed!');
  console.log('💡 Open your browser to', BASE_URL, 'to test the UI');
}

runManualTests().catch(console.error);
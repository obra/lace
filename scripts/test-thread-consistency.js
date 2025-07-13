#!/usr/bin/env node

// ABOUTME: Automated test script to verify thread ID consistency between Agent and web UI
// ABOUTME: Tests agent status API, conversation flow, and tool execution with real API

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const TEST_PORT = 3001;
const BASE_URL = `http://localhost:${TEST_PORT}`;

class ThreadConsistencyTester {
  constructor() {
    this.serverProcess = null;
    this.results = {
      agentThreadId: null,
      statusApiThreadId: null,
      firstConversationThreadId: null,
      secondConversationThreadId: null,
      toolExecutionThreadId: null,
      errors: [],
    };
  }

  async startServer() {
    console.log('🚀 Starting Lace web server...');
    
    this.serverProcess = spawn('node', ['dist/cli.js', '--ui', 'web', '--log-level=debug', `--port=${TEST_PORT}`], {
      stdio: 'pipe',
      env: process.env,
    });

    let serverStarted = false;
    let agentThreadId = null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within 30 seconds'));
      }, 30000);

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('SERVER:', output.trim());

        // Capture the Agent thread ID from server output
        const threadMatch = output.match(/Thread ID: (lace_\d{8}_[a-z0-9]+)/);
        if (threadMatch) {
          agentThreadId = threadMatch[1];
          this.results.agentThreadId = agentThreadId;
          console.log(`✅ Captured Agent thread ID: ${agentThreadId}`);
        }

        // Check if web interface is ready
        if (output.includes('Lace web interface available')) {
          serverStarted = true;
          clearTimeout(timeout);
          // Wait a bit more for full startup
          setTimeout(2000).then(() => resolve(agentThreadId));
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error('SERVER ERROR:', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async testAgentStatusAPI() {
    console.log('\n📡 Testing Agent Status API...');
    
    try {
      const response = await fetch(`${BASE_URL}/api/agent/status`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const status = await response.json();
      console.log('Agent Status Response:', JSON.stringify(status, null, 2));
      
      this.results.statusApiThreadId = status.latestThreadId;
      
      if (this.results.agentThreadId && status.latestThreadId !== this.results.agentThreadId) {
        this.results.errors.push(
          `Thread ID mismatch: Agent=${this.results.agentThreadId}, API=${status.latestThreadId}`
        );
      }
      
      return status;
    } catch (error) {
      this.results.errors.push(`Agent Status API failed: ${error.message}`);
      console.error('❌ Agent Status API failed:', error.message);
      return null;
    }
  }

  async testConversationFlow() {
    console.log('\n💬 Testing conversation flow...');
    
    // Test 1: First conversation
    const firstThreadId = await this.sendMessage('hello, what is 2+2?');
    this.results.firstConversationThreadId = firstThreadId;
    
    if (firstThreadId) {
      console.log(`✅ First conversation thread ID: ${firstThreadId}`);
      
      if (this.results.agentThreadId && firstThreadId !== this.results.agentThreadId) {
        this.results.errors.push(
          `First conversation thread mismatch: Agent=${this.results.agentThreadId}, Conversation=${firstThreadId}`
        );
      }
    }
    
    // Test 2: Second conversation using same thread
    const secondThreadId = await this.sendMessage('what did I just ask you?', firstThreadId);
    this.results.secondConversationThreadId = secondThreadId;
    
    if (secondThreadId) {
      console.log(`✅ Second conversation thread ID: ${secondThreadId}`);
      
      if (firstThreadId && secondThreadId !== firstThreadId) {
        this.results.errors.push(
          `Thread continuity broken: First=${firstThreadId}, Second=${secondThreadId}`
        );
      }
    }
  }

  async testToolExecution() {
    console.log('\n🔧 Testing tool execution...');
    
    const threadId = await this.sendMessage('what time is it right now?', this.results.firstConversationThreadId);
    this.results.toolExecutionThreadId = threadId;
    
    if (threadId) {
      console.log(`✅ Tool execution thread ID: ${threadId}`);
      
      if (this.results.firstConversationThreadId && threadId !== this.results.firstConversationThreadId) {
        this.results.errors.push(
          `Tool execution thread mismatch: Expected=${this.results.firstConversationThreadId}, Got=${threadId}`
        );
      }
    }
  }

  async sendMessage(message, threadId = null) {
    try {
      const body = {
        message,
        provider: 'anthropic',
      };
      
      if (threadId) {
        body.threadId = threadId;
      }
      
      console.log(`Sending message: "${message}"${threadId ? ` (thread: ${threadId})` : ''}`);
      
      const response = await fetch(`${BASE_URL}/api/conversations/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let connectionThreadId = null;
      let toolCallSeen = false;
      let toolResultSeen = false;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              
              if (event.type === 'connection') {
                connectionThreadId = event.threadId;
                console.log(`  📍 Connection event thread ID: ${connectionThreadId}`);
              }
              
              if (event.type === 'tool_call_start') {
                toolCallSeen = true;
                console.log(`  🔧 Tool call started: ${event.toolCall?.name}`);
              }
              
              if (event.type === 'tool_call_complete') {
                toolResultSeen = true;
                console.log(`  ✅ Tool call completed: ${event.result?.isError ? 'ERROR' : 'SUCCESS'}`);
              }
              
              if (event.type === 'error') {
                console.error(`  ❌ Stream error: ${event.error}`);
                throw new Error(`Stream error: ${event.error}`);
              }
              
              // Stop after getting the response (for efficiency)
              if (event.type === 'agent_message_complete') {
                await reader.cancel();
                break;
              }
            } catch (parseError) {
              // Ignore JSON parse errors for partial data
            }
          }
        }
      }
      
      reader.releaseLock();
      return connectionThreadId;
      
    } catch (error) {
      console.error(`❌ Message failed: ${error.message}`);
      this.results.errors.push(`Message "${message}" failed: ${error.message}`);
      return null;
    }
  }

  async stopServer() {
    if (this.serverProcess) {
      console.log('\n🛑 Stopping server...');
      this.serverProcess.kill();
      await setTimeout(2000);
    }
  }

  printResults() {
    console.log('\n📊 TEST RESULTS');
    console.log('================');
    console.log(`Agent Thread ID:              ${this.results.agentThreadId || 'NOT CAPTURED'}`);
    console.log(`Status API Thread ID:         ${this.results.statusApiThreadId || 'NOT AVAILABLE'}`);
    console.log(`First Conversation Thread ID: ${this.results.firstConversationThreadId || 'FAILED'}`);
    console.log(`Second Conversation Thread ID:${this.results.secondConversationThreadId || 'FAILED'}`);
    console.log(`Tool Execution Thread ID:     ${this.results.toolExecutionThreadId || 'FAILED'}`);
    
    console.log('\n🔍 CONSISTENCY CHECK');
    console.log('====================');
    
    if (this.results.errors.length === 0) {
      console.log('✅ All thread IDs are consistent!');
    } else {
      console.log('❌ Thread ID inconsistencies found:');
      this.results.errors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error}`);
      });
    }
    
    return this.results.errors.length === 0;
  }
}

async function main() {
  const tester = new ThreadConsistencyTester();
  
  try {
    // Check if ANTHROPIC_KEY is set
    if (!process.env.ANTHROPIC_KEY) {
      console.error('❌ ANTHROPIC_KEY environment variable is required');
      process.exit(1);
    }
    
    await tester.startServer();
    await setTimeout(3000); // Wait for server to fully initialize
    
    await tester.testAgentStatusAPI();
    await tester.testConversationFlow();
    await tester.testToolExecution();
    
    const success = tester.printResults();
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await tester.stopServer();
  }
}

main().catch(console.error);
#!/usr/bin/env node

// ABOUTME: Live test script with real Anthropic API integration
// ABOUTME: Tests actual LLM reasoning and tool calling

import { Lace } from './src/lace.js';

async function testLiveIntegration() {
  console.log('🚀 Testing Lace Live LLM Integration...\n');
  
  try {
    const lace = new Lace({ verbose: true });
    
    // Full initialization including model provider
    await lace.db.initialize();
    await lace.tools.initialize();
    await lace.modelProvider.initialize();
    
    // Create orchestrator agent
    lace.primaryAgent = new (await import('./src/agents/agent.js')).Agent({
      generation: 0,
      tools: lace.tools,
      db: lace.db,
      modelProvider: lace.modelProvider,
      verbose: true,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });
    
    console.log('✅ Lace initialized with live LLM connection');
    
    // Test 1: Simple execution task
    console.log('\n🧪 Test 1: Simple execution task');
    const response1 = await lace.primaryAgent.processInput('test-session', 'list files in current directory');
    console.log('Response:', response1.content?.substring(0, 200) + '...');
    
    // Test 2: Calculation task  
    console.log('\n🧪 Test 2: JavaScript calculation');
    const response2 = await lace.primaryAgent.processInput('test-session', 'calculate the square root of 144');
    console.log('Response:', response2.content?.substring(0, 200) + '...');
    
    // Test 3: Complex reasoning task
    console.log('\n🧪 Test 3: Planning task');
    const response3 = await lace.primaryAgent.processInput('test-session', 'plan how to implement user authentication in a web app');
    console.log('Response:', response3.content?.substring(0, 300) + '...');
    
    console.log('\n✅ All live tests completed!');
    
    // Show tool usage
    if (response1.toolCalls?.length > 0) {
      console.log('\n🔧 Tool calls made:', response1.toolCalls.map(tc => tc.name));
    }
    
  } catch (error) {
    console.error('❌ Live test failed:', error.message);
    console.error(error.stack);
  }
}

testLiveIntegration();
#!/usr/bin/env node

// ABOUTME: Quick test for multiplication functionality
// ABOUTME: Tests the calculation tool and result display

import { Lace } from './src/lace.js';

async function testMultiplication() {
  console.log('🧮 Testing multiplication...');
  
  try {
    const lace = new Lace({ verbose: false });
    
    await lace.db.initialize();
    await lace.tools.initialize();
    await lace.modelProvider.initialize();
    
    lace.primaryAgent = new (await import('./src/agents/agent.js')).Agent({
      generation: 0,
      tools: lace.tools,
      db: lace.db,
      modelProvider: lace.modelProvider,
      verbose: false,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });
    
    const response = await lace.primaryAgent.processInput('test-session', 'multiply 6 by 12');
    console.log(response.content);
    
    if (response.toolCalls?.length > 0) {
      console.log('\nTool calls executed:');
      for (const call of response.toolCalls) {
        console.log(`  ${call.name}(${JSON.stringify(call.input)})`);
      }
    }
    
    if (response.toolResults?.length > 0) {
      console.log('\nTool results:');
      for (const result of response.toolResults) {
        if (result.error) {
          console.log(`  ❌ ${result.toolCall.name}: ${result.error}`);
        } else {
          console.log(`  ✅ ${result.toolCall.name}: Success`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testMultiplication();
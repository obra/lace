#!/usr/bin/env node

// ABOUTME: Simple test script to verify LLM integration and tool calling
// ABOUTME: Tests the orchestrator-driven agent system without full CLI

import { Lace } from './src/lace.js';

async function testIntegration() {
  console.log('🧪 Testing Lace LLM Integration...\n');
  
  try {
    const lace = new Lace({ verbose: true });
    
    // Initialize without starting the interactive console
    await lace.db.initialize();
    await lace.tools.initialize();
    
    // Create primary agent manually without model provider
    lace.primaryAgent = new (await import('./src/agents/agent.js')).Agent({
      generation: 0,
      tools: lace.tools,
      db: lace.db,
      modelProvider: null, // Skip for testing
      verbose: true,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });
    
    console.log('✅ Core systems initialized');
    
    // Test tool schema conversion
    const testAgent = lace.primaryAgent;
    const toolsForLLM = testAgent.buildToolsForLLM();
    
    console.log('🔧 Available tools for LLM:', toolsForLLM.length);
    console.log('First tool example:', JSON.stringify(toolsForLLM[0], null, 2));
    
    // Test agent spawning without LLM
    const executionAgent = await testAgent.spawnSubagent({
      role: 'execution',
      assignedModel: 'claude-3-5-haiku-20241022',
      assignedProvider: 'anthropic',
      task: 'List files in current directory'
    });
    
    console.log('✅ Agent spawning works');
    console.log('Execution agent role:', executionAgent.role);
    console.log('Execution agent model:', executionAgent.assignedModel);
    
    // Test task analysis
    const planningConfig = testAgent.chooseAgentForTask('plan authentication system');
    const executionConfig = testAgent.chooseAgentForTask('list files');
    const reasoningConfig = testAgent.chooseAgentForTask('debug this error');
    
    console.log('\n🧠 Task Analysis Results:');
    console.log('Planning task:', planningConfig);
    console.log('Execution task:', executionConfig);
    console.log('Reasoning task:', reasoningConfig);
    
    console.log('\n✅ All tests passed! Ready for API key integration.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testIntegration();
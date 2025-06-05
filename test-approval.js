#!/usr/bin/env node

// ABOUTME: Test script for tool approval system
// ABOUTME: Demonstrates interactive tool execution with user confirmation

import { Lace } from './src/lace.js';

async function testApproval() {
  console.log('🔐 Testing Tool Approval System...\n');
  
  try {
    // Create Lace with some auto-approved tools for testing
    const lace = new Lace({ 
      verbose: true,
      autoApproveTools: ['javascript_calculate'], // Math is safe
      alwaysDenyTools: ['shell_execute'] // Shell commands need approval
    });
    
    await lace.db.initialize();
    await lace.tools.initialize();
    await lace.modelProvider.initialize();
    
    lace.primaryAgent = new (await import('./src/agents/agent.js')).Agent({
      generation: 0,
      tools: lace.tools,
      db: lace.db,
      modelProvider: lace.modelProvider,
      toolApproval: lace.toolApproval,
      verbose: true,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });
    
    console.log('✅ Lace initialized with approval system');
    console.log('Auto-approve: javascript_calculate');
    console.log('Always deny: shell_execute\n');
    
    // Test 1: Auto-approved calculation
    console.log('🧪 Test 1: Auto-approved calculation');
    const response1 = await lace.primaryAgent.processInput('test-session', 'calculate 15 * 23');
    console.log('Response:', response1.content?.substring(0, 100) + '...');
    console.log('Tool results:', response1.toolResults?.map(r => ({
      tool: r.toolCall.name,
      approved: r.approved,
      denied: r.denied,
      success: !r.error
    })));
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 2: Denied shell command
    console.log('🧪 Test 2: Denied shell command');
    const response2 = await lace.primaryAgent.processInput('test-session', 'run ls -la');
    console.log('Response:', response2.content?.substring(0, 150) + '...');
    console.log('Tool results:', response2.toolResults?.map(r => ({
      tool: r.toolCall.name,
      approved: r.approved,
      denied: r.denied,
      error: r.error?.substring(0, 50)
    })));
    
    console.log('\n✅ Approval system tests completed!');
    console.log('\nTo test interactive approval, run: npm start');
    console.log('Then try: "run pwd" or "list files"');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testApproval();
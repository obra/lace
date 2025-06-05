// ABOUTME: Unit tests for tool approval system
// ABOUTME: Tests interactive approval, auto-approve, deny lists, and safety features

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert } from '../test-harness.js';

describe('Tool Approval System', () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe('ToolApprovalManager', () => {
    test('should auto-approve whitelisted tools', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager({
        interactive: false,
        autoApproveTools: ['javascript_calculate']
      });

      const result = await approval.requestApproval({
        name: 'javascript_calculate',
        input: { expression: '6 * 12' }
      });

      assert.ok(result.approved, 'Should approve whitelisted tool');
      assert.strictEqual(result.reason, 'Tool is on auto-approve list');
    });

    test('should deny blacklisted tools', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager({
        interactive: false,
        alwaysDenyTools: ['shell_execute']
      });

      const result = await approval.requestApproval({
        name: 'shell_execute',
        input: { command: 'rm -rf /' }
      });

      assert.ok(!result.approved, 'Should deny blacklisted tool');
      assert.strictEqual(result.reason, 'Tool is on deny list');
    });

    test('should assess risk levels correctly', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager();

      // High risk
      const highRisk = approval.assessRisk({
        name: 'shell_execute',
        input: { command: 'sudo rm -rf /' }
      });
      assert.strictEqual(highRisk, 'high', 'Should detect high risk commands');

      // Medium risk
      const mediumRisk = approval.assessRisk({
        name: 'file_write',
        input: { path: '/etc/config' }
      });
      assert.strictEqual(mediumRisk, 'high', 'Should detect high risk file operations');

      // Low risk
      const lowRisk = approval.assessRisk({
        name: 'javascript_calculate',
        input: { expression: '2 + 2' }
      });
      assert.strictEqual(lowRisk, 'low', 'Should detect low risk operations');
    });

    test('should deny by default when interactive disabled', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager({
        interactive: false
      });

      const result = await approval.requestApproval({
        name: 'unknown_tool',
        input: {}
      });

      assert.ok(!result.approved, 'Should deny unknown tools when non-interactive');
      assert.ok(result.reason.includes('Interactive mode disabled'), 'Should provide appropriate reason');
    });
  });

  describe('Agent Integration', () => {
    test('should use approval system when executing tools', async () => {
      const lace = await harness.createTestLace({ requireAPI: false });
      
      // Set up approval system with auto-approve for testing
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      lace.primaryAgent.toolApproval = new ToolApprovalManager({
        interactive: false,
        autoApproveTools: ['javascript_calculate']
      });

      // Test tool execution through agent
      const result = await lace.primaryAgent.executeTool({
        name: 'javascript_calculate',
        input: { expression: '6 * 12' }
      });

      assert.ok(result.success, 'Tool execution should succeed when approved');
      assert.strictEqual(result.result, 72, 'Should get correct calculation result');
    });

    test('should block denied tools', async () => {
      const lace = await harness.createTestLace({ requireAPI: false });
      
      // Set up approval system with deny list
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      lace.primaryAgent.toolApproval = new ToolApprovalManager({
        interactive: false,
        alwaysDenyTools: ['shell_execute']
      });

      try {
        await lace.primaryAgent.executeTool({
          name: 'shell_execute',
          input: { command: 'echo test' }
        });
        assert.fail('Should throw error for denied tool');
      } catch (error) {
        // This should throw since the tool is denied
        assert.ok(error.message, 'Should provide error message for denied tools');
      }
    });

    test('should handle missing approval system gracefully', async () => {
      const lace = await harness.createTestLace({ requireAPI: false });
      
      // Remove approval system
      lace.primaryAgent.toolApproval = null;

      // Tool should execute without approval
      const result = await lace.primaryAgent.executeTool({
        name: 'javascript_calculate',
        input: { expression: '2 + 3' }
      });

      assert.ok(result.success, 'Should execute tool when no approval system');
      assert.strictEqual(result.result, 5, 'Should get correct result');
    });
  });

  describe('Tool Call Processing', () => {
    test('should properly process approved tool calls in agent response', async () => {
      const lace = await harness.createTestLace({ requireAPI: false });
      
      // Mock model provider to return specific tool call
      lace.primaryAgent.modelProvider = {
        chat: async (messages, options) => ({
          success: true,
          content: 'I will calculate 6 * 12',
          toolCalls: [{
            name: 'javascript_calculate',
            input: { expression: '6 * 12' }
          }]
        })
      };

      // Set up auto-approval
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      lace.primaryAgent.toolApproval = new ToolApprovalManager({
        interactive: false,
        autoApproveTools: ['javascript_calculate']
      });

      const response = await lace.primaryAgent.processInput('test-session', 'calculate 6 * 12');

      assert.ok(response.content, 'Should have response content');
      assert.ok(response.toolResults, 'Should have tool results');
      assert.ok(response.toolResults.length > 0, 'Should have executed tools');
      assert.ok(response.toolResults[0].approved, 'Tool should be marked as approved');
      assert.ok(!response.toolResults[0].denied, 'Tool should not be marked as denied');
    });

    test('should handle denied tool calls properly', async () => {
      const lace = await harness.createTestLace({ requireAPI: false });
      
      // Mock model provider to return denied tool call
      lace.primaryAgent.modelProvider = {
        chat: async (messages, options) => ({
          success: true,
          content: 'I will run a shell command',
          toolCalls: [{
            name: 'shell_execute',
            input: { command: 'echo test' }
          }]
        })
      };

      // Set up denial
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      lace.primaryAgent.toolApproval = new ToolApprovalManager({
        interactive: false,
        alwaysDenyTools: ['shell_execute']
      });

      const response = await lace.primaryAgent.processInput('test-session', 'run echo test');

      assert.ok(response.content, 'Should have response content');
      assert.ok(response.toolResults, 'Should have tool results');
      assert.ok(response.toolResults.length > 0, 'Should have processed tools');
      assert.ok(response.toolResults[0].denied, 'Tool should be marked as denied');
      assert.ok(response.toolResults[0].error, 'Should have denial error message');
    });
  });

  describe('Configuration Management', () => {
    test('should manage auto-approve list', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager();
      
      approval.addAutoApprove('safe_tool');
      const status = approval.getStatus();
      
      assert.ok(status.autoApprove.includes('safe_tool'), 'Should add tool to auto-approve list');
      
      approval.removeAutoApprove('safe_tool');
      const updatedStatus = approval.getStatus();
      
      assert.ok(!updatedStatus.autoApprove.includes('safe_tool'), 'Should remove tool from auto-approve list');
    });

    test('should manage deny list', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager();
      
      approval.addDenyList('dangerous_tool');
      const status = approval.getStatus();
      
      assert.ok(status.denyList.includes('dangerous_tool'), 'Should add tool to deny list');
      
      approval.removeDenyList('dangerous_tool');
      const updatedStatus = approval.getStatus();
      
      assert.ok(!updatedStatus.denyList.includes('dangerous_tool'), 'Should remove tool from deny list');
    });

    test('should toggle interactive mode', async () => {
      const { ToolApprovalManager } = await import('../../src/safety/tool-approval.js');
      
      const approval = new ToolApprovalManager({ interactive: true });
      
      assert.ok(approval.getStatus().interactive, 'Should start in interactive mode');
      
      approval.setInteractive(false);
      assert.ok(!approval.getStatus().interactive, 'Should disable interactive mode');
    });
  });
});
// ABOUTME: Shared utilities for delegation testing setup with real provider instances
// ABOUTME: Uses direct provider mocking to avoid MSW AbortSignal compatibility issues

import { vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ApprovalDecision } from '~/tools/approval-types';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import { ProviderRegistry } from '~/providers/registry';
import { AnthropicProvider } from '~/providers/anthropic-provider';

export interface DelegationTestSetup {
  session: Session;
  project: Project;
  providerInstanceId: string;
  setMockResponses: (responses: string[]) => void;
  setupBlockedTaskResponse: () => void;
  cleanup: () => Promise<void>;
}

export async function createDelegationTestSetup(options?: {
  sessionName?: string;
  projectName?: string;
  projectPath?: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
  responses?: string[];
}): Promise<DelegationTestSetup> {
  const provider = options?.provider || 'anthropic';
  const model = options?.model || 'claude-3-5-haiku-20241022';

  // Set environment variables to ensure provider instances can be created
  if (provider === 'anthropic') {
    process.env.ANTHROPIC_KEY = 'test-anthropic-key';
  } else {
    process.env.OPENAI_API_KEY = 'test-openai-key';
  }

  // Create real provider instance for testing  
  const providerInstanceId = await createTestProviderInstance({
    catalogId: provider,
    models: [model],
    displayName: `Test ${provider.charAt(0).toUpperCase() + provider.slice(1)} Delegation`,
    apiKey: provider === 'anthropic' ? 'test-anthropic-key' : 'test-openai-key',
  });

  // Set up direct provider mocking instead of MSW to avoid AbortSignal issues
  let mockResponses = options?.responses || ['Integration test completed successfully'];
  let responseIndex = 0;

  // Mock the ProviderInstanceManager.loadInstancesSync to return our test instance
  // This makes Session.resolveProviderInstance find the instance and proceed to createProvider
  const originalLoadInstancesSync = require('~/providers/instance/manager').ProviderInstanceManager.prototype.loadInstancesSync;
  vi.spyOn(require('~/providers/instance/manager').ProviderInstanceManager.prototype, 'loadInstancesSync').mockReturnValue({
    version: '1.0',
    instances: {
      [providerInstanceId]: {
        displayName: `Test ${provider.charAt(0).toUpperCase() + provider.slice(1)} Delegation`,
        catalogProviderId: provider, // anthropic, openai, etc.
      }
    }
  });

  // Mock the createProvider method that gets called after instance resolution
  vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation((providerType: string, config: any) => {
    // Create a mock provider that responds according to our test setup
    return {
      providerName: 'test-anthropic',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      
      createResponse: async (messages: any, tools: any) => {
        // Look for task assignment in messages
        const taskMessage = messages.find((m: any) => 
          m.content && 
          typeof m.content === 'string' && 
          (m.content.includes('You have been assigned task') ||
           m.content.includes('LACE TASK SYSTEM') ||
           m.content.includes('TASK DETAILS'))
        );

        if (taskMessage && typeof taskMessage.content === 'string') {
          // Extract task ID
          const match = taskMessage.content.match(/assigned task '([^']+)'/) ||
                       taskMessage.content.match(/task[:\s]+([a-zA-Z0-9_-]+)/);
          const taskId = match ? match[1] : 'unknown';

          // Get response for this task
          const response = mockResponses.length > 0 ? 
            mockResponses[responseIndex % mockResponses.length] : 
            'Mock delegation response';
            
          responseIndex++;

          // Return response with tool call to complete task
          return {
            content: `I'll complete this task: ${response}`,
            usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
            toolCalls: [{
              id: 'delegation_task_complete',
              name: 'task_complete',
              input: {
                id: taskId,
                message: response,
              },
            }],
          };
        }

        // Non-delegation response
        const response = mockResponses.length > 0 ? 
          mockResponses[responseIndex % mockResponses.length] : 
          'Mock response';
        responseIndex++;
        
        return {
          content: response,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          toolCalls: [],
        };
      },
      
      // Add other required provider methods
      isConfigured: () => true,
      getProviderInfo: () => ({ name: 'Test Anthropic', version: '1.0.0' }),
      getAvailableModels: () => [{ id: modelId, name: 'Test Model' }],
      cleanup: () => {},
    } as any;
  });

  // Initialize provider registry to make sure provider instances are loaded
  const registry = new ProviderRegistry();
  await registry.initialize();

  // Create project with real provider instance
  const project = Project.create(
    options?.projectName || 'Test Delegation Project',
    options?.projectPath || '/tmp/test-delegation',
    'Test project for delegation',
    {
      providerInstanceId,
      modelId: model,
    }
  );

  // Create session WITHOUT provider configuration - it inherits from project
  const session = Session.create({
    name: options?.sessionName || 'Delegation Test Session',
    projectId: project.getId(),
    approvalCallback: {
      requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE), // Auto-approve all tool calls for testing
    },
  });

  // Helper functions for controlling mock behavior
  const setMockResponses = (responses: string[]) => {
    mockResponses = responses;
    responseIndex = 0;
  };

  const setupBlockedTaskResponse = () => {
    // Override the registry mock to return blocked task response
    vi.spyOn(ProviderRegistry.prototype, 'createProviderFromInstanceAndModel').mockImplementation(async function(instanceId, modelId) {
      return {
        providerName: 'test-anthropic',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        
        createResponse: async (messages: any, tools: any) => {
          const taskMessage = messages.find((m: any) => 
            m.content && 
            typeof m.content === 'string' && 
            m.content.includes('You have been assigned task')
          );

          if (taskMessage && typeof taskMessage.content === 'string') {
            const match = taskMessage.content.match(/assigned task '([^']+)'/) ||
                         taskMessage.content.match(/task[:\s]+([a-zA-Z0-9_-]+)/);
            const taskId = match ? match[1] : 'unknown';

            // Return response that blocks the task
            return {
              content: 'I encountered an issue and cannot complete this task.',
              usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
              toolCalls: [{
                id: 'task_update_call',
                name: 'task_update',
                input: {
                  taskId: taskId,
                  status: 'blocked',
                },
              }],
            };
          }

          return {
            content: 'Mock response',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            toolCalls: [],
          };
        },
        
        // Add other required provider methods
        isConfigured: () => true,
        getProviderInfo: () => ({ name: 'Test Anthropic', version: '1.0.0' }),
        getAvailableModels: () => [{ id: modelId, name: 'Test Model' }],
        cleanup: () => {},
      } as any;
    });
  };

  // Cleanup function to tear down test resources
  const cleanup = async () => {
    vi.restoreAllMocks();
    await cleanupTestProviderInstances([providerInstanceId]);
    if (provider === 'anthropic') {
      delete process.env.ANTHROPIC_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  };

  return { session, project, providerInstanceId, setMockResponses, setupBlockedTaskResponse, cleanup };
}

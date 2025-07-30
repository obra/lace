// ABOUTME: Shared utilities for delegation testing setup
// ABOUTME: Provides consistent session creation and provider mocking for delegation tests

import { vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ProviderRegistry } from '~/providers/registry';
import { ApprovalDecision } from '~/tools/approval-types';
import { DelegationMockProvider } from '~/test-utils/delegation-mock-provider';

export interface DelegationTestSetup {
  session: Session;
  project: Project;
  mockProvider: DelegationMockProvider;
}

export function createDelegationTestSetup(options?: {
  sessionName?: string;
  projectName?: string;
  projectPath?: string;
  provider?: string;
  model?: string;
}): DelegationTestSetup {
  const mockProvider = new DelegationMockProvider(
    options?.provider || 'anthropic',
    options?.model || 'claude-3-5-haiku-20241022'
  );

  // Mock the ProviderRegistry to return our mock provider
  vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(() => mockProvider);
  vi.spyOn(ProviderRegistry, 'createWithAutoDiscovery').mockImplementation(
    () =>
      ({
        createProvider: () => mockProvider,
        getProvider: () => mockProvider,
        getProviderNames: () => ['anthropic', 'openai'],
      }) as unknown as ProviderRegistry
  );

  // Create project and session
  const project = Project.create(
    options?.projectName || 'Test Delegation Project',
    options?.projectPath || '/tmp/test-delegation'
  );

  const session = Session.create({
    name: options?.sessionName || 'Delegation Test Session',
    provider: options?.provider || 'anthropic',
    model: options?.model || 'claude-3-5-haiku-20241022',
    projectId: project.getId(),
    approvalCallback: {
      requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE), // Auto-approve all tool calls for testing
    },
  });

  return { session, project, mockProvider };
}

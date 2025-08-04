// ABOUTME: Comprehensive tests for Session class provider instance integration
// ABOUTME: Verifies Session.create() accepts providerInstanceId and modelId, inheritance, and edge cases

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderInstances,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

describe('Session with Provider Instances', () => {
  let testProject: Project;
  let testProviderInstances: {
    anthropicInstanceId: string;
    openaiInstanceId: string;
  };

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment for providers
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';

    // Set up real provider instances for tests
    testProviderInstances = await setupTestProviderInstances();

    // Create a test project for all tests
    testProject = Project.create(
      'Test Project',
      '/test/path',
      'Test project for provider instance tests',
      {}
    );
  });

  afterEach(async () => {
    // Clean up provider instances
    await cleanupTestProviderInstances([
      testProviderInstances.anthropicInstanceId,
      testProviderInstances.openaiInstanceId,
    ]);
    teardownTestPersistence();
  });

  describe('Session creation with provider instances', () => {
    it('should create session using providerInstanceId and modelId', () => {
      const session = Session.create({
        name: 'Test Session',
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        projectId: testProject.getId(),
      });

      expect(session).toBeDefined();
      expect(session.getId()).toBeDefined();

      // Verify that the session was created with the correct provider instance configuration
      const sessionData = session.getSessionData();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.anthropicInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('claude-3-5-haiku-20241022');
    });

    it('should create session with OpenAI provider instance', () => {
      const session = Session.create({
        name: 'OpenAI Session',
        providerInstanceId: testProviderInstances.openaiInstanceId,
        modelId: 'gpt-4o',
        projectId: testProject.getId(),
      });

      expect(session).toBeDefined();

      // Verify session configuration
      const sessionData = session.getSessionData();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.openaiInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('gpt-4o');
    });

    it('should accept providerInstanceId and modelId in create parameters', () => {
      // Note: Currently the system falls back to 'anthropic' provider during transition
      // This test verifies that the interface accepts the parameters correctly
      const session = Session.create({
        name: 'Test Session',
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        projectId: testProject.getId(),
      });

      expect(session).toBeDefined();
      // Configuration should be stored even if resolution falls back
      const sessionData = session.getSessionData();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.anthropicInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('claude-3-5-haiku-20241022');
    });

    it('should require projectId', () => {
      expect(() => {
        Session.create({
          name: 'No Project Session',
          providerInstanceId: testProviderInstances.anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          // Missing projectId
        } as any);
      }).toThrow();
    });
  });

  describe('Session info with provider instances', () => {
    it('should return correct provider info for Anthropic instance', () => {
      const session = Session.create({
        name: 'Anthropic Session',
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
        projectId: testProject.getId(),
      });

      const info = session.getInfo();
      expect(info).toBeDefined();
      expect(info?.provider).toBe('anthropic');
      expect(info?.model).toBe('claude-3-5-sonnet-20241022');
      expect(info?.agents).toHaveLength(1); // Coordinator agent
      expect(info?.agents[0]?.provider).toBe('anthropic');
      expect(info?.agents[0]?.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should store OpenAI provider instance configuration', () => {
      const session = Session.create({
        name: 'OpenAI Session',
        providerInstanceId: testProviderInstances.openaiInstanceId,
        modelId: 'gpt-4o-mini',
        projectId: testProject.getId(),
      });

      // Verify configuration is stored correctly even if resolution falls back to anthropic
      const sessionData = session.getSessionData();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.openaiInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('gpt-4o-mini');

      // Note: During transition period, provider resolution falls back to 'anthropic'
      // This will be fixed when full provider instance resolution is implemented
      const info = session.getInfo();
      expect(info).toBeDefined();
      expect(info?.model).toBe('gpt-4o-mini'); // Model should be preserved
    });
  });

  describe('Provider instance inheritance', () => {
    it('should pass provider instance configuration to coordinator agent', () => {
      const session = Session.create({
        name: 'Test Session',
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        projectId: testProject.getId(),
      });

      const agents = session.getAgents();
      expect(agents).toHaveLength(1);

      const coordinatorAgent = agents[0];
      expect(coordinatorAgent?.provider).toBe('anthropic');
      expect(coordinatorAgent?.model).toBe('claude-3-5-haiku-20241022');
    });

    it('should store provider instance configuration in session data', () => {
      const session = Session.create({
        name: 'Configuration Test',
        providerInstanceId: testProviderInstances.openaiInstanceId,
        modelId: 'gpt-4o',
        projectId: testProject.getId(),
      });

      const sessionData = session.getSessionData();
      expect(sessionData).toBeDefined();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.openaiInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('gpt-4o');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle custom configuration alongside provider instances', () => {
      const session = Session.create({
        name: 'Custom Config Session',
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        projectId: testProject.getId(),
        configuration: {
          temperature: 0.8,
          customSetting: 'test-value',
        },
      });

      const sessionData = session.getSessionData();
      expect(sessionData?.configuration?.providerInstanceId).toBe(
        testProviderInstances.anthropicInstanceId
      );
      expect(sessionData?.configuration?.modelId).toBe('claude-3-5-haiku-20241022');
      expect(sessionData?.configuration?.temperature).toBe(0.8);
      expect(sessionData?.configuration?.customSetting).toBe('test-value');
    });

    it('should generate name when not provided', () => {
      const session = Session.create({
        providerInstanceId: testProviderInstances.anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        projectId: testProject.getId(),
      });

      const info = session.getInfo();
      expect(info?.name).toBeDefined();
      expect(info?.name).not.toBe('');
      expect(info?.name).toMatch(/\w+, \w+ \d+/); // Should match pattern like "Monday, Jan 1"
    });
  });
});

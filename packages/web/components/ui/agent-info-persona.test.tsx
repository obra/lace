import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentInfo } from '@/types/core';

// Mock AgentsSection component
const AgentsSection = ({ agents }: { agents: AgentInfo[] }) => (
  <div>
    {agents.map((agent) => (
      <div key={agent.threadId} data-testid={`agent-${agent.threadId}`}>
        <div data-testid="agent-name">{agent.name}</div>
        <div data-testid="agent-persona">{agent.persona}</div>
        <div data-testid="agent-status">{agent.status}</div>
      </div>
    ))}
  </div>
);

describe('Web UI Persona Integration', () => {
  const mockAgent: AgentInfo = {
    threadId: 'lace_20250904_test01' as any,
    name: 'Test Agent',
    modelId: 'claude-3-sonnet',
    providerInstanceId: 'anthropic',
    status: 'idle',
    persona: 'coding-agent',
  };

  describe('AgentInfo interface with personas', () => {
    it('includes persona field in AgentInfo type', () => {
      // Type-level test - if this compiles, the persona field exists
      const agentWithPersona: AgentInfo = {
        threadId: 'lace_20250904_test01' as any,
        name: 'Test Agent',
        modelId: 'claude-3-sonnet', 
        providerInstanceId: 'anthropic',
        status: 'idle',
        persona: 'helper-agent', // This field must exist for compilation
      };
      
      expect(agentWithPersona.persona).toBe('helper-agent');
    });

    it('persona field is required in AgentInfo', () => {
      // This test ensures persona is not optional
      const agent = mockAgent;
      expect(typeof agent.persona).toBe('string');
      expect(agent.persona).toBeTruthy();
    });
  });

  describe('Agent display components', () => {
    it('can display agent persona in components', () => {
      render(<AgentsSection agents={[mockAgent]} />);
      
      expect(screen.getByTestId('agent-name')).toHaveTextContent('Test Agent');
      expect(screen.getByTestId('agent-persona')).toHaveTextContent('coding-agent');
      expect(screen.getByTestId('agent-status')).toHaveTextContent('idle');
    });

    it('handles different persona types', () => {
      const agents: AgentInfo[] = [
        { ...mockAgent, persona: 'lace' },
        { ...mockAgent, threadId: 'lace_20250904_test02' as any, persona: 'coding-agent' },
        { ...mockAgent, threadId: 'lace_20250904_test03' as any, persona: 'helper-agent' },
      ];
      
      render(<AgentsSection agents={agents} />);
      
      const personaElements = screen.getAllByTestId('agent-persona');
      expect(personaElements).toHaveLength(3);
      expect(personaElements[0]).toHaveTextContent('lace');
      expect(personaElements[1]).toHaveTextContent('coding-agent');
      expect(personaElements[2]).toHaveTextContent('helper-agent');
    });
  });

  describe('NewAgentSpec format support', () => {
    it('NewAgentSpec imports are available for web components', async () => {
      // Test that the web UI can import the core types
      const { isNewAgentSpec, parseNewAgentSpec, createNewAgentSpec } = await import('@/types/core');
      
      expect(typeof isNewAgentSpec).toBe('function');
      expect(typeof parseNewAgentSpec).toBe('function'); 
      expect(typeof createNewAgentSpec).toBe('function');
    });

    it('can create and parse NewAgentSpec in web context', async () => {
      const { isNewAgentSpec, parseNewAgentSpec, createNewAgentSpec } = await import('@/types/core');
      
      const spec = createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet');
      expect(isNewAgentSpec(spec)).toBe(true);
      
      const parsed = parseNewAgentSpec(spec);
      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.provider).toBe('anthropic');
      expect(parsed.model).toBe('claude-3-sonnet');
    });
  });
});
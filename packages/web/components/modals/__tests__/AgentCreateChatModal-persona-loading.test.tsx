// ABOUTME: Tests for persona loading states in AgentCreateChatModal
// ABOUTME: Tests loading indicators, error messages, and graceful degradation

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentCreateChatModal } from '../AgentCreateChatModal';

const mockPersonas = [{ name: 'default', isUserDefined: false, path: 'default.md' }];

const mockProviders = [
  {
    instanceId: 'anthropic-1',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-3', displayName: 'Claude 3' }],
  },
];

describe('AgentCreateChatModal - Persona Loading States', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreateAgent: vi.fn(),
    personas: mockPersonas,
    providers: mockProviders,
    defaultPersonaName: 'default',
    defaultProviderInstanceId: 'anthropic-1',
    defaultModelId: 'claude-3',
  };

  it('should show loading placeholder when personas are loading', () => {
    render(<AgentCreateChatModal {...defaultProps} personas={[]} personasLoading={true} />);

    const personaSelector = screen.getByTestId('persona-selector-trigger');
    expect(personaSelector).toHaveTextContent('Loading personas...');
    expect(personaSelector).toBeDisabled();
  });

  it('should show error message when personas fail to load', () => {
    render(
      <AgentCreateChatModal {...defaultProps} personas={[]} personasError="Network timeout" />
    );

    expect(screen.getByText('Failed to load personas: Network timeout')).toBeInTheDocument();
  });

  it('should show normal placeholder when personas loaded successfully', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        personas={mockPersonas}
        personasLoading={false}
        personasError={null}
      />
    );

    const personaSelector = screen.getByTestId('persona-selector-trigger');
    expect(personaSelector).toHaveTextContent('default'); // Shows selected default
    expect(personaSelector).not.toBeDisabled();
  });

  it('should allow creation even when persona loading failed (graceful degradation)', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        personas={[]} // Empty due to error
        personasError="Failed to connect"
        defaultPersonaName="default" // Still has default
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    // Should be enabled since we have persona name, provider, and model
    expect(sendButton).not.toBeDisabled();
  });

  it('should disable creation when personas loading and no default provided', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        personas={[]}
        personasLoading={true}
        defaultPersonaName={undefined}
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).toBeDisabled();
  });

  it('should not show error message when no error', () => {
    render(<AgentCreateChatModal {...defaultProps} personas={mockPersonas} personasError={null} />);

    expect(screen.queryByText(/Failed to load personas/)).not.toBeInTheDocument();
  });

  it('should handle both loading and error states properly', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        personas={[]}
        personasLoading={false}
        personasError="Connection failed"
      />
    );

    // Should show error but not loading
    expect(screen.getByText('Failed to load personas: Connection failed')).toBeInTheDocument();
    const personaSelector = screen.getByTestId('persona-selector-trigger');
    expect(personaSelector).not.toBeDisabled(); // Not loading anymore
    expect(personaSelector).toHaveTextContent('Select persona...'); // Not loading text
  });
});

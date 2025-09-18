// ABOUTME: Tests for SettingsNavigation component verifying tab navigation
// ABOUTME: Ensures correct routing between settings sections and active state highlighting

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SettingsNavigation } from './SettingsNavigation';

describe('SettingsNavigation', () => {
  it('renders all navigation tabs', () => {
    render(
      <MemoryRouter initialEntries={['/settings/providers']}>
        <SettingsNavigation activeTab="providers" />
      </MemoryRouter>
    );

    expect(screen.getByText('AI Models')).toBeInTheDocument();
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('UI')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('generates correct links for each tab', () => {
    render(
      <MemoryRouter initialEntries={['/settings/providers']}>
        <SettingsNavigation activeTab="providers" />
      </MemoryRouter>
    );

    const aiModelsLink = screen.getByRole('link', { name: /ai models/i });
    const mcpLink = screen.getByRole('link', { name: /mcp servers/i });
    const uiLink = screen.getByRole('link', { name: /ui/i });
    const userLink = screen.getByRole('link', { name: /user/i });

    expect(aiModelsLink).toHaveAttribute('href', '/settings/providers');
    expect(mcpLink).toHaveAttribute('href', '/settings/mcp');
    expect(uiLink).toHaveAttribute('href', '/settings/ui');
    expect(userLink).toHaveAttribute('href', '/settings/user');
  });

  it('highlights the active tab', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/settings/ui']}>
        <SettingsNavigation activeTab="ui" />
      </MemoryRouter>
    );

    const uiLink = screen.getByRole('link', { name: /ui/i });
    expect(uiLink).toHaveClass('text-primary');

    // Test different active tab
    rerender(
      <MemoryRouter initialEntries={['/settings/mcp']}>
        <SettingsNavigation activeTab="mcp" />
      </MemoryRouter>
    );

    const mcpLink = screen.getByRole('link', { name: /mcp servers/i });
    expect(mcpLink).toHaveClass('text-primary');
  });
});

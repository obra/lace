// ABOUTME: Tests for SettingsPanel component covering content display and layout
// ABOUTME: Ensures proper panel structure, title rendering, and content area management

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('renders panel with title', () => {
    render(
      <SettingsPanel title="General Settings">
        <div>Panel content</div>
      </SettingsPanel>
    );
    
    expect(screen.getByText('General Settings')).toBeInTheDocument();
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('renders panel without title when not provided', () => {
    render(
      <SettingsPanel>
        <div>Panel content</div>
      </SettingsPanel>
    );
    
    expect(screen.getByText('Panel content')).toBeInTheDocument();
    // Should not have a title element
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <SettingsPanel title="General Settings" description="Configure basic application settings">
        <div>Panel content</div>
      </SettingsPanel>
    );
    
    expect(screen.getByText('General Settings')).toBeInTheDocument();
    expect(screen.getByText('Configure basic application settings')).toBeInTheDocument();
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const { container } = render(
      <SettingsPanel title="Test Panel" className="custom-panel">
        <div>Panel content</div>
      </SettingsPanel>
    );
    
    expect(container.firstChild).toHaveClass('custom-panel');
  });

  it('renders multiple children correctly', () => {
    render(
      <SettingsPanel title="Multi-content Panel">
        <div>First content</div>
        <div>Second content</div>
        <button>Action button</button>
      </SettingsPanel>
    );
    
    expect(screen.getByText('Multi-content Panel')).toBeInTheDocument();
    expect(screen.getByText('First content')).toBeInTheDocument();
    expect(screen.getByText('Second content')).toBeInTheDocument();
    expect(screen.getByText('Action button')).toBeInTheDocument();
  });

  it('has proper heading hierarchy with role', () => {
    render(
      <SettingsPanel title="Settings Panel">
        <div>Content</div>
      </SettingsPanel>
    );
    
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Settings Panel');
  });

  it('supports icon in title', () => {
    render(
      <SettingsPanel title="Settings Panel" icon="⚙️">
        <div>Content</div>
      </SettingsPanel>
    );
    
    expect(screen.getByText('⚙️')).toBeInTheDocument();
    expect(screen.getByText('Settings Panel')).toBeInTheDocument();
  });
});
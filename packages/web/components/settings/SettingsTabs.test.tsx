// ABOUTME: Tests for SettingsTabs component covering tab navigation and content switching
// ABOUTME: Ensures proper tab behavior, accessibility, and keyboard navigation support

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsTabs } from './SettingsTabs';

describe('SettingsTabs', () => {
  it('renders with default tab selected', () => {
    render(
      <SettingsTabs defaultTab="general">
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
      </SettingsTabs>
    );
    
    expect(screen.getByText('General Content')).toBeInTheDocument();
    expect(screen.queryByText('Advanced Content')).not.toBeInTheDocument();
  });

  it('switches tabs when tab buttons are clicked', () => {
    render(
      <SettingsTabs defaultTab="general">
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
      </SettingsTabs>
    );
    
    expect(screen.getByText('General Content')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Advanced Content')).toBeInTheDocument();
    expect(screen.queryByText('General Content')).not.toBeInTheDocument();
  });

  it('calls onTabChange when tab is changed', () => {
    const mockOnTabChange = vi.fn();
    render(
      <SettingsTabs defaultTab="general" onTabChange={mockOnTabChange}>
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
      </SettingsTabs>
    );
    
    fireEvent.click(screen.getByText('Advanced'));
    expect(mockOnTabChange).toHaveBeenCalledWith('advanced');
  });

  it('supports keyboard navigation between tabs', () => {
    render(
      <SettingsTabs defaultTab="general">
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
        <div data-tab="privacy">Privacy Content</div>
      </SettingsTabs>
    );
    
    const generalTab = screen.getByText('General');
    generalTab.focus();
    
    fireEvent.keyDown(generalTab, { key: 'ArrowRight' });
    expect(screen.getByText('Advanced')).toHaveFocus();
    
    fireEvent.keyDown(screen.getByText('Advanced'), { key: 'ArrowRight' });
    expect(screen.getByText('Privacy')).toHaveFocus();
  });

  it('wraps keyboard navigation at boundaries', () => {
    render(
      <SettingsTabs defaultTab="general">
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
      </SettingsTabs>
    );
    
    const advancedTab = screen.getByText('Advanced');
    advancedTab.focus();
    
    // Arrow right from last tab should wrap to first
    fireEvent.keyDown(advancedTab, { key: 'ArrowRight' });
    expect(screen.getByText('General')).toHaveFocus();
    
    // Arrow left from first tab should wrap to last  
    fireEvent.keyDown(screen.getByText('General'), { key: 'ArrowLeft' });
    expect(screen.getByText('Advanced')).toHaveFocus();
  });

  it('activates tab with Enter or Space key', () => {
    render(
      <SettingsTabs defaultTab="general">
        <div data-tab="general">General Content</div>
        <div data-tab="advanced">Advanced Content</div>
      </SettingsTabs>
    );
    
    const advancedTab = screen.getByText('Advanced');
    fireEvent.keyDown(advancedTab, { key: 'Enter' });
    
    expect(screen.getByText('Advanced Content')).toBeInTheDocument();
    expect(screen.queryByText('General Content')).not.toBeInTheDocument();
  });

  it('renders custom tab labels', () => {
    const tabs = [
      { id: 'ui', label: 'UI Settings', icon: '🎨' },
      { id: 'system', label: 'System', icon: '⚙️' }
    ];
    
    render(
      <SettingsTabs defaultTab="ui" tabs={tabs}>
        <div data-tab="ui">UI Content</div>
        <div data-tab="system">System Content</div>
      </SettingsTabs>
    );
    
    expect(screen.getByText('🎨')).toBeInTheDocument();
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
  });
});
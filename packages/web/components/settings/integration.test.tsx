// ABOUTME: Integration test for settings components verifying they work together
// ABOUTME: Tests complete settings workflow with all components composed

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SettingsTabs, SettingsPanel, SettingField } from './index';
import { Modal } from '@/components/ui/Modal';

describe('Settings Components Integration', () => {
  it('renders complete settings modal with tabs and panels', () => {
    const mockOnClose = vi.fn();
    const mockOnThemeChange = vi.fn();

    render(
      <Modal isOpen={true} onClose={mockOnClose} title="Settings">
        <SettingsTabs defaultTab="ui">
          <div data-tab="ui">
            <SettingsPanel title="UI Settings" description="Customize your interface">
              <SettingField label="Theme" description="Choose your color theme">
                <select onChange={(e) => mockOnThemeChange(e.target.value)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </SettingField>
              <SettingField label="Notifications" layout="horizontal">
                <input type="checkbox" />
              </SettingField>
            </SettingsPanel>
          </div>
          <div data-tab="privacy">
            <SettingsPanel title="Privacy Settings">
              <SettingField label="Data Collection" required>
                <input type="checkbox" />
              </SettingField>
            </SettingsPanel>
          </div>
        </SettingsTabs>
      </Modal>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Ui')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    expect(screen.getByText('Customize your interface')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Choose your color theme')).toBeInTheDocument();
  });

  it('switches between tabs and shows different panels', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <SettingsTabs defaultTab="ui">
          <div data-tab="ui">
            <SettingsPanel title="UI Settings">
              <SettingField label="Theme">
                <select>
                  <option value="light">Light</option>
                </select>
              </SettingField>
            </SettingsPanel>
          </div>
          <div data-tab="privacy">
            <SettingsPanel title="Privacy Settings">
              <SettingField label="Analytics">
                <input type="checkbox" />
              </SettingField>
            </SettingsPanel>
          </div>
        </SettingsTabs>
      </Modal>
    );

    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    expect(screen.queryByText('Privacy Settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Privacy'));

    expect(screen.getByText('Privacy Settings')).toBeInTheDocument();
    expect(screen.queryByText('UI Settings')).not.toBeInTheDocument();
  });

  it('handles form interactions within settings', () => {
    const mockOnThemeChange = vi.fn();

    render(
      <Modal isOpen={true} onClose={() => {}}>
        <SettingsTabs defaultTab="ui">
          <div data-tab="ui">
            <SettingsPanel title="UI Settings">
              <SettingField label="Theme">
                <select onChange={mockOnThemeChange}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </SettingField>
            </SettingsPanel>
          </div>
        </SettingsTabs>
      </Modal>
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'dark' } });

    expect(mockOnThemeChange).toHaveBeenCalled();
  });

  it('shows required indicators properly', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <SettingsTabs defaultTab="account">
          <div data-tab="account">
            <SettingsPanel title="Account Settings">
              <SettingField label="API Key" required>
                <input type="text" />
              </SettingField>
              <SettingField label="Display Name">
                <input type="text" />
              </SettingField>
            </SettingsPanel>
          </div>
        </SettingsTabs>
      </Modal>
    );

    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByText('Display Name')).toBeInTheDocument();
  });
});

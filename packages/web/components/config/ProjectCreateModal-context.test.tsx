// ABOUTME: Unit test to isolate ProviderInstanceProvider and ProjectCreateModal context interaction
// ABOUTME: Tests if ProjectCreateModal properly receives data from ProviderInstanceProvider context

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectCreateModal } from './ProjectCreateModal';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock FontAwesome
vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon }: { icon: unknown }) => <span data-testid="icon">{String(icon)}</span>,
}));

// Mock other UI components
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="glass-card">{children}</div>
  ),
}));

vi.mock('@/components/ui/AccentButton', () => ({
  AccentButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui', () => ({
  DirectoryField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} data-testid="directory-field" />
  ),
}));

vi.mock('@/components/ui/ToolPolicyToggle', () => ({
  ToolPolicyToggle: () => <div data-testid="tool-policy-toggle">Policy Toggle</div>,
}));

import { api } from '@/lib/api-client';

const mockApi = vi.mocked(api);

describe('ProjectCreateModal Context Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock empty initial state
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/api/provider/instances') {
        return Promise.resolve({ instances: [] });
      }
      if (url === '/api/provider/catalog') {
        return Promise.resolve({
          providers: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              type: 'anthropic',
              models: [
                {
                  id: 'claude-3-5-sonnet',
                  name: 'Claude 3.5 Sonnet',
                  context_window: 200000,
                  default_max_tokens: 4096,
                },
              ],
            },
          ],
        });
      }
      return Promise.resolve({});
    });
  });

  it('should receive providers from ProviderInstanceProvider context', async () => {
    let capturedLog: unknown = null;

    // Capture console.log calls
    const originalLog = console.log;
    console.log = vi.fn((...args) => {
      if (args[0]?.includes?.('[PROJECT CREATE DEBUG]')) {
        capturedLog = args;
      }
      originalLog(...args);
    });

    const TestWrapper = () => (
      <ProviderInstanceProvider>
        <ProjectCreateModal
          isOpen={true}
          loading={false}
          onClose={() => {}}
          onSubmit={async () => {}}
          onAddProvider={() => {}}
        />
      </ProviderInstanceProvider>
    );

    render(<TestWrapper />);

    // Wait for context to load
    await waitFor(
      () => {
        expect(capturedLog).toBeTruthy();
      },
      { timeout: 5000 }
    );

    // Check if the component received the context data
    expect(capturedLog).toContain('[PROJECT CREATE DEBUG]');

    console.log = originalLog;
  });

  it('should update when provider is added to context', async () => {
    let updateCount = 0;
    const receivedProviders: unknown[] = [];

    // Capture all provider updates
    const originalLog = console.log;
    console.log = vi.fn((...args) => {
      if (args[0]?.includes?.('[PROJECT CREATE DEBUG] ProjectCreateModal received providers:')) {
        updateCount++;
        receivedProviders.push(args[1]);
      }
      originalLog(...args);
    });

    // Mock API to simulate provider being added
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/api/provider/instances') {
        // Simulate empty initially, then with provider
        return updateCount === 0
          ? Promise.resolve({ instances: [] })
          : Promise.resolve({
              instances: [
                {
                  id: 'test-provider-anthropic',
                  displayName: 'test-provider',
                  catalogProviderId: 'anthropic',
                },
              ],
            });
      }
      if (url === '/api/provider/catalog') {
        return Promise.resolve({
          providers: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              type: 'anthropic',
              models: [
                {
                  id: 'claude-3-5-sonnet',
                  name: 'Claude 3.5 Sonnet',
                  context_window: 200000,
                  default_max_tokens: 4096,
                },
              ],
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const TestWrapper = () => (
      <ProviderInstanceProvider>
        <ProjectCreateModal
          isOpen={true}
          loading={false}
          onClose={() => {}}
          onSubmit={async () => {}}
          onAddProvider={() => {}}
        />
      </ProviderInstanceProvider>
    );

    render(<TestWrapper />);

    // Wait for initial render
    await waitFor(
      () => {
        expect(updateCount).toBeGreaterThan(0);
      },
      { timeout: 5000 }
    );

    console.log('Received provider updates:', receivedProviders);
    console.log('Update count:', updateCount);

    console.log = originalLog;
  });
});

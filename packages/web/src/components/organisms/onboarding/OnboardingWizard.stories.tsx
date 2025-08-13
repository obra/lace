import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { within, userEvent, expect } from '@storybook/test';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import type { ProviderCatalogItem } from '@/types/web';

// Mock providers similar to unit tests
const mockProviders: ProviderCatalogItem[] = [
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    requiresApiKey: true,
    instanceId: 'anthropic:default',
    models: [
      { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 8192 },
      { id: 'claude-haiku-4-20240307', displayName: 'Claude Haiku 4', contextWindow: 200000, maxOutputTokens: 4096 },
    ],
  },
];

const meta: Meta<typeof ProjectSelectorPanel> = {
  title: 'Organisms/Onboarding/OnboardingWizard',
  component: ProjectSelectorPanel,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div className="p-6 max-w-5xl mx-auto">
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
  args: {
    projects: [],
    selectedProject: null,
    providers: mockProviders,
    onProjectSelect: () => {},
    onProjectCreate: () => {},
    onProjectUpdate: () => {},
    loading: false,
    autoOpenCreate: true,
    onAutoCreateHandled: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof ProjectSelectorPanel>;

export const Welcome: Story = {
  name: 'Welcome Step',
};

export const Directory: Story = {
  name: 'Directory Step',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Move from Welcome -> Directory
    await user.click(await canvas.findByRole('button', { name: 'Get started' }));

    // Assert directory input visible
    await canvas.findByPlaceholderText('/path/to/your/project');
  },
};

export const Provider: Story = {
  name: 'Provider/Model Step',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Welcome -> Directory
    await user.click(await canvas.findByRole('button', { name: 'Get started' }));

    // Provide directory
    const dir = await canvas.findByPlaceholderText('/path/to/your/project');
    await user.type(dir, '/home/user/my-app');

    // Next -> Provider
    await user.click(await canvas.findByRole('button', { name: 'Next' }));

    // Assert provider/model selects present
    await canvas.findByLabelText('Provider', undefined, { selector: 'select' }).catch(async () => {
      // Fallback to text lookup if label association differs
      expect(await canvas.findByText('Provider')).toBeTruthy();
    });
    expect(await canvas.findByText('Model')).toBeTruthy();
  },
};

export const Review: Story = {
  name: 'Review Step',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Welcome -> Directory
    await user.click(await canvas.findByRole('button', { name: 'Get started' }));

    // Provide directory
    const dir = await canvas.findByPlaceholderText('/path/to/your/project');
    await user.type(dir, '/home/user/my-app');

    // Next -> Provider
    await user.click(await canvas.findByRole('button', { name: 'Next' }));

    // Optionally pick model (defaults are set by component when provider changes)
    // Next -> Review
    await user.click(await canvas.findByRole('button', { name: 'Next' }));

    // Assert review content
    expect(await canvas.findByText('Review')).toBeTruthy();
    expect(await canvas.findByText(/Directory:/)).toBeTruthy();
  },
};

export const AdvancedSetup: Story = {
  name: 'Advanced Setup (Full Form)',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Switch to advanced mode from Welcome
    await user.click(await canvas.findByRole('button', { name: 'Advanced setup' }));

    // Expect some advanced form fields to exist
    // The exact labels depend on the full form; check a representative field
    expect(await canvas.findByText(/Default Provider|Tool Access Policies|Environment Variables/i)).toBeTruthy();
  },
};

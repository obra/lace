import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { VaporBackground } from '@/components/ui/VaporBackground';
import { dmSans, lato, jetBrainsMono } from '@/app/fonts';

// Mock providers similar to unit tests
const mockProviders = [
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    requiresApiKey: true,
    instanceId: 'anthropic:default',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        displayName: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: 'claude-haiku-4-20240307',
        displayName: 'Claude Haiku 4',
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
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
      <SettingsProvider>
        <div
          data-theme="dim"
          className={`${dmSans.className} ${lato.variable} ${jetBrainsMono.variable} relative min-h-screen text-base-content`}
        >
          <VaporBackground />
          <div className="relative p-6 max-w-5xl mx-auto">
            <Story />
          </div>
        </div>
      </SettingsProvider>
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
};

export const Provider: Story = {
  name: 'Provider/Model Step',
};

export const Review: Story = {
  name: 'Review Step',
};

export const AdvancedSetup: Story = {
  name: 'Advanced Setup (Full Form)',
};

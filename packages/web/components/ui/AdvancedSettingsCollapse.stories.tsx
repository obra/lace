// ABOUTME: Storybook story for AdvancedSettingsCollapse.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import {
  AdvancedSettingsCollapse,
  type AdvancedSettingsCollapseProps,
} from './AdvancedSettingsCollapse';

const meta: Meta<AdvancedSettingsCollapseProps> = {
  title: 'Molecules/Onboarding/AdvancedSettingsCollapse',
  component: AdvancedSettingsCollapse,
  parameters: { layout: 'centered' },
  args: {
    title: 'Advanced settings',
    defaultOpen: true,
  },
};
export default meta;

type Story = StoryObj<AdvancedSettingsCollapseProps>;

export const Default: Story = {
  args: {
    children: (
      <div className="space-y-2">
        <div className="text-sm">Max tokens: 4096</div>
        <div className="text-sm">Tools: bash, file_read, file_write</div>
      </div>
    ),
  },
};

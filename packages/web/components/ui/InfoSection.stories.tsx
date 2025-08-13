// ABOUTME: Storybook story for InfoSection.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { InfoSection, type InfoSectionProps } from './InfoSection';

const meta: Meta<InfoSectionProps> = {
  title: 'Molecules/Onboarding/InfoSection',
  component: InfoSection,
  parameters: { layout: 'centered' },
  args: {
    title: 'Why provide a project directory?',
    defaultOpen: true,
  },
};
export default meta;

type Story = StoryObj<InfoSectionProps>;

export const Default: Story = {
  args: {
    children: (
      <ul className="list-disc list-inside text-sm">
        <li>We use this path to read your codebase and tailor suggestions.</li>
        <li>You can change it later in Project Settings.</li>
      </ul>
    ),
  },
};

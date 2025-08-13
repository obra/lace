// ABOUTME: Storybook story for InfoIconButton.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { InfoIconButton, type InfoIconButtonProps } from './InfoIconButton';

const meta: Meta<InfoIconButtonProps> = {
  title: 'Atoms/InfoIconButton',
  component: InfoIconButton,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    label: { control: 'text' },
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Show info',
    active: false,
  },
};
export default meta;

type Story = StoryObj<InfoIconButtonProps>;

export const Default: Story = {};
export const Active: Story = { args: { active: true } };
export const Disabled: Story = { args: { disabled: true } };

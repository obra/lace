import type { Meta, StoryObj } from '@storybook/react';
import { AccentSelect, type AccentSelectProps } from './AccentSelect';

const meta: Meta<AccentSelectProps> = {
  title: 'Atoms/AccentSelect',
  component: AccentSelect,
  parameters: { layout: 'centered' },
  args: {
    label: 'Model',
    helperText: 'Choose a model',
    options: [
      { label: 'gpt-4o', value: 'gpt-4o' },
      { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
      { label: 'o3-mini', value: 'o3-mini' },
    ],
  },
  argTypes: {
    label: { control: 'text' },
    helperText: { control: 'text' },
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<AccentSelectProps>;

export const Default: Story = {};
export const Invalid: Story = { args: { invalid: true, helperText: 'Please select a model' } };
export const Disabled: Story = { args: { disabled: true } };

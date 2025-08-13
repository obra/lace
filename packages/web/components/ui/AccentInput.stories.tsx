import type { Meta, StoryObj } from '@storybook/react';
import { AccentInput, type AccentInputProps } from './AccentInput';

const meta: Meta<AccentInputProps> = {
  title: 'Atoms/AccentInput',
  component: AccentInput,
  parameters: { layout: 'centered' },
  args: {
    label: 'Project Name',
    placeholder: 'my-awesome-project',
    helperText: 'Used to identify your project',
    invalid: false,
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    helperText: { control: 'text' },
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<AccentInputProps>;

export const Default: Story = {};
export const Invalid: Story = { args: { invalid: true, helperText: 'Please provide a name' } };
export const Disabled: Story = { args: { disabled: true } };

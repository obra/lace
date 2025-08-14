/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook stories for DirectoryField component
// ABOUTME: Documents all component variants with interactive examples

import type { Meta, StoryObj } from '@storybook/react';
import { ComponentProps, useState } from 'react';
import { DirectoryField } from '@/components/ui/DirectoryField';

const meta = {
  title: 'UI/DirectoryField',
  component: DirectoryField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A directory browser field that allows users to select directories by typing or browsing. Includes autocomplete and navigation features.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DirectoryField>;

export default meta;
type Story = StoryObj;

// Wrapper component to manage state
function DirectoryFieldWrapper(
  props: Omit<ComponentProps<typeof DirectoryField>, 'value' | 'onChange'> & { value?: string }
) {
  const [value, setValue] = useState(props.value || '');

  return <DirectoryField {...props} value={value} onChange={setValue} />;
}

export const Default: Story = {
  render: () => (
    <DirectoryFieldWrapper label="Project Directory" placeholder="Select a directory" />
  ),
};

export const Required: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Required Directory"
      required={true}
      helpText="This field is required"
    />
  ),
};

export const WithError: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Directory with Error"
      error={true}
      value="/invalid/path"
      helpText="Please select a valid directory"
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <DirectoryFieldWrapper label="Disabled Directory" value="/some/path" disabled={true} />
  ),
};

export const WithValue: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Pre-filled Directory"
      value={'/mock/path'}
      helpText="Directory field with existing value"
      prepopulatePath={false}
    />
  ),
};

export const LargeSize: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Large Directory Field"
      placeholder="Choose your project directory"
      className="input-lg"
      helpText="Large input for prominent form sections"
    />
  ),
};

export const WithoutLabel: Story = {
  render: () => (
    <DirectoryFieldWrapper
      placeholder="Select directory path"
      helpText="Directory field without label"
      prepopulatePath={false}
    />
  ),
};

export const AutoPrepopulated: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Auto-Prepopulated Directory"
      placeholder="Loading home directory..."
      helpText="Automatically loads and fills with home directory on mount"
      prepopulatePath={true}
    />
  ),
};

export const FilteringDemo: Story = {
  render: () => (
    <DirectoryFieldWrapper
      label="Directory with Filtering"
      value="git"
      helpText="Try typing to filter directories (e.g., 'git', '.h', 'D')"
      prepopulatePath={false}
    />
  ),
};

// ABOUTME: Storybook story for OnboardingActions.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { OnboardingActions, type OnboardingActionsProps } from './OnboardingActions';

const meta: Meta<OnboardingActionsProps> = {
  title: 'Molecules/Onboarding/OnboardingActions',
  component: OnboardingActions,
  parameters: { layout: 'centered' },
  args: {
    primaryLabel: 'Continue',
    secondaryLabel: 'Back',
  },
};
export default meta;

type Story = StoryObj<OnboardingActionsProps>;

export const Default: Story = {
  args: {
    onPrimary: () => alert('Continue'),
    onSecondary: () => alert('Back'),
  },
};

export const Loading: Story = {
  args: {
    onPrimary: () => undefined,
    loading: true,
  },
};

import type { Meta, StoryObj } from '@storybook/react';
import { OnboardingHero, type OnboardingHeroProps } from './OnboardingHero';

const meta: Meta<OnboardingHeroProps> = {
  title: 'Molecules/Onboarding/OnboardingHero',
  component: OnboardingHero,
  parameters: { layout: 'centered' },
  args: {
    title: (
      <>
        Code with clarity.
        <br />
        <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
          Not complexity.
        </span>
      </>
    ),
    subtitle: 'Create your first project to start collaborating with agents.',
    primaryLabel: 'Create your first project',
  },
};
export default meta;

type Story = StoryObj<OnboardingHeroProps>;

export const Default: Story = {
  args: {
    onPrimary: () => alert('Primary clicked'),
    secondaryLabel: 'View docs',
    onSecondary: () => alert('Secondary clicked'),
  },
};

/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for CarouselCodeChanges.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CarouselCodeChanges } from './CarouselCodeChanges';

const meta: Meta<typeof CarouselCodeChanges> = {
  title: 'Organisms/CarouselCodeChanges',
  component: CarouselCodeChanges,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Code changes carousel component that displays commit changes with file details, impact indicators, and addition/deletion statistics. Perfect for showing git commit history, code reviews, and deployment summaries.',
      },
    },
  },
  argTypes: {
    changes: {
      description: 'Array of code change objects to display',
      control: false,
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CarouselCodeChanges>;

// Sample data for different types of code changes
const sampleFeatureChanges = [
  {
    id: 'feature-1',
    type: 'feature' as const,
    title: 'Add user authentication system',
    commitHash: 'a1b2c3d',
    totalFiles: 8,
    maxDisplayFiles: 3,
    files: [
      {
        path: 'src/auth/AuthProvider.tsx',
        additions: 45,
        deletions: 0,
        impact: 'high' as const,
      },
      {
        path: 'src/auth/LoginForm.tsx',
        additions: 32,
        deletions: 0,
        impact: 'medium' as const,
      },
      {
        path: 'src/auth/types.ts',
        additions: 18,
        deletions: 0,
        impact: 'low' as const,
      },
    ],
  },
  {
    id: 'bugfix-1',
    type: 'bugfix' as const,
    title: 'Fix memory leak in timeline component',
    commitHash: 'e4f5g6h',
    totalFiles: 3,
    maxDisplayFiles: 3,
    files: [
      {
        path: 'src/timeline/TimelineView.tsx',
        additions: 5,
        deletions: 12,
        impact: 'high' as const,
      },
      {
        path: 'src/timeline/hooks/useTimelineData.ts',
        additions: 8,
        deletions: 3,
        impact: 'medium' as const,
      },
      {
        path: 'src/timeline/TimelineView.test.tsx',
        additions: 15,
        deletions: 2,
        impact: 'low' as const,
      },
    ],
  },
];

const refactorChanges = [
  {
    id: 'refactor-1',
    type: 'refactor' as const,
    title: 'Reorganize component structure',
    commitHash: 'i7j8k9l',
    totalFiles: 15,
    maxDisplayFiles: 4,
    files: [
      {
        path: 'src/components/ui/atoms/Button.tsx',
        additions: 0,
        deletions: 45,
        impact: 'medium' as const,
      },
      {
        path: 'src/components/atoms/Button.tsx',
        additions: 45,
        deletions: 0,
        impact: 'medium' as const,
      },
      {
        path: 'src/components/ui/molecules/Modal.tsx',
        additions: 0,
        deletions: 78,
        impact: 'high' as const,
      },
      {
        path: 'src/components/molecules/Modal.tsx',
        additions: 78,
        deletions: 0,
        impact: 'high' as const,
      },
    ],
  },
];

const mixedChanges = [
  {
    id: 'feature-2',
    type: 'feature' as const,
    title: 'Implement dark mode support',
    commitHash: 'm1n2o3p',
    totalFiles: 12,
    maxDisplayFiles: 3,
    files: [
      {
        path: 'src/theme/SettingsProvider.tsx',
        additions: 67,
        deletions: 5,
        impact: 'high' as const,
      },
      {
        path: 'src/styles/globals.css',
        additions: 89,
        deletions: 12,
        impact: 'medium' as const,
      },
      {
        path: 'tailwind.config.js',
        additions: 23,
        deletions: 8,
        impact: 'medium' as const,
      },
    ],
  },
  {
    id: 'docs-1',
    type: 'docs' as const,
    title: 'Update API documentation',
    commitHash: 'q4r5s6t',
    totalFiles: 6,
    maxDisplayFiles: 3,
    files: [
      {
        path: 'docs/api/authentication.md',
        additions: 45,
        deletions: 18,
        impact: 'low' as const,
      },
      {
        path: 'docs/api/endpoints.md',
        additions: 32,
        deletions: 7,
        impact: 'low' as const,
      },
      {
        path: 'README.md',
        additions: 15,
        deletions: 3,
        impact: 'low' as const,
      },
    ],
  },
  {
    id: 'maintenance-1',
    type: 'maintenance' as const,
    title: 'Update dependencies to latest versions',
    commitHash: 'u7v8w9x',
    totalFiles: 4,
    maxDisplayFiles: 3,
    files: [
      {
        path: 'package.json',
        additions: 12,
        deletions: 12,
        impact: 'medium' as const,
      },
      {
        path: 'package-lock.json',
        additions: 2456,
        deletions: 1834,
        impact: 'low' as const,
      },
      {
        path: 'src/types/dependencies.ts',
        additions: 5,
        deletions: 2,
        impact: 'low' as const,
      },
    ],
  },
];

const largeChangeSet = [
  {
    id: 'large-feature',
    type: 'feature' as const,
    title: 'Complete rewrite of messaging system',
    commitHash: 'y1z2a3b',
    totalFiles: 28,
    maxDisplayFiles: 4,
    files: [
      {
        path: 'src/messaging/MessageBus.ts',
        additions: 234,
        deletions: 45,
        impact: 'high' as const,
      },
      {
        path: 'src/messaging/types/Message.ts',
        additions: 89,
        deletions: 12,
        impact: 'high' as const,
      },
      {
        path: 'src/messaging/handlers/MessageHandler.ts',
        additions: 156,
        deletions: 67,
        impact: 'high' as const,
      },
      {
        path: 'src/messaging/utils/MessageValidator.ts',
        additions: 78,
        deletions: 23,
        impact: 'medium' as const,
      },
    ],
  },
];

export const Default: Story = {
  args: {
    changes: sampleFeatureChanges,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Default code changes carousel showing feature and bugfix commits with file details and impact indicators.',
      },
    },
  },
};

export const SingleChange: Story = {
  args: {
    changes: [sampleFeatureChanges[0]],
  },
  parameters: {
    docs: {
      description: {
        story: 'Single code change display showing a feature commit with multiple files.',
      },
    },
  },
};

export const RefactoringChanges: Story = {
  args: {
    changes: refactorChanges,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Refactoring changes showing file moves and reorganization with paired additions/deletions.',
      },
    },
  },
};

export const MixedChangeTypes: Story = {
  args: {
    changes: mixedChanges,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Mixed change types including features, documentation updates, and maintenance tasks.',
      },
    },
  },
};

export const LargeChangeset: Story = {
  args: {
    changes: largeChangeSet,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Large changeset with many files showing truncated file list and "more files" indicator.',
      },
    },
  },
};

export const AllChangeTypes: Story = {
  args: {
    changes: [
      {
        id: 'feature-showcase',
        type: 'feature' as const,
        title: 'Add real-time notifications',
        commitHash: 'abc123f',
        totalFiles: 5,
        files: [
          {
            path: 'src/notifications/NotificationService.ts',
            additions: 89,
            deletions: 0,
            impact: 'high' as const,
          },
          {
            path: 'src/notifications/types.ts',
            additions: 34,
            deletions: 0,
            impact: 'medium' as const,
          },
          {
            path: 'src/hooks/useNotifications.ts',
            additions: 45,
            deletions: 0,
            impact: 'medium' as const,
          },
        ],
      },
      {
        id: 'bugfix-showcase',
        type: 'bugfix' as const,
        title: 'Fix race condition in data fetching',
        commitHash: 'def456b',
        totalFiles: 2,
        files: [
          { path: 'src/api/DataService.ts', additions: 12, deletions: 8, impact: 'high' as const },
          {
            path: 'src/api/DataService.test.ts',
            additions: 23,
            deletions: 5,
            impact: 'low' as const,
          },
        ],
      },
      {
        id: 'refactor-showcase',
        type: 'refactor' as const,
        title: 'Extract reusable utility functions',
        commitHash: 'ghi789r',
        totalFiles: 8,
        maxDisplayFiles: 2,
        files: [
          {
            path: 'src/utils/formatters.ts',
            additions: 67,
            deletions: 0,
            impact: 'medium' as const,
          },
          {
            path: 'src/utils/validators.ts',
            additions: 45,
            deletions: 0,
            impact: 'medium' as const,
          },
        ],
      },
      {
        id: 'maintenance-showcase',
        type: 'maintenance' as const,
        title: 'Update ESLint configuration',
        commitHash: 'jkl012m',
        totalFiles: 3,
        files: [
          { path: '.eslintrc.js', additions: 15, deletions: 8, impact: 'low' as const },
          { path: 'package.json', additions: 2, deletions: 2, impact: 'low' as const },
          { path: 'src/types/eslint.d.ts', additions: 8, deletions: 0, impact: 'low' as const },
        ],
      },
      {
        id: 'docs-showcase',
        type: 'docs' as const,
        title: 'Add component documentation',
        commitHash: 'mno345d',
        totalFiles: 4,
        files: [
          {
            path: 'docs/components/Button.md',
            additions: 56,
            deletions: 0,
            impact: 'low' as const,
          },
          { path: 'docs/components/Modal.md', additions: 78, deletions: 0, impact: 'low' as const },
          { path: 'docs/README.md', additions: 12, deletions: 3, impact: 'low' as const },
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Comprehensive showcase of all change types with their distinct color coding and styling.',
      },
    },
  },
};

export const HighImpactChanges: Story = {
  args: {
    changes: [
      {
        id: 'high-impact-1',
        type: 'feature' as const,
        title: 'Critical security update',
        commitHash: 'sec001x',
        totalFiles: 6,
        maxDisplayFiles: 3,
        files: [
          {
            path: 'src/security/AuthGuard.ts',
            additions: 78,
            deletions: 34,
            impact: 'high' as const,
          },
          {
            path: 'src/security/TokenValidator.ts',
            additions: 45,
            deletions: 23,
            impact: 'high' as const,
          },
          {
            path: 'src/security/EncryptionService.ts',
            additions: 67,
            deletions: 12,
            impact: 'high' as const,
          },
        ],
      },
      {
        id: 'high-impact-2',
        type: 'bugfix' as const,
        title: 'Fix critical data corruption issue',
        commitHash: 'fix001x',
        totalFiles: 4,
        files: [
          {
            path: 'src/database/DataIntegrity.ts',
            additions: 89,
            deletions: 45,
            impact: 'high' as const,
          },
          {
            path: 'src/database/BackupService.ts',
            additions: 34,
            deletions: 12,
            impact: 'high' as const,
          },
          {
            path: 'src/database/DataValidator.ts',
            additions: 56,
            deletions: 23,
            impact: 'high' as const,
          },
          {
            path: 'src/database/RecoveryService.ts',
            additions: 78,
            deletions: 0,
            impact: 'high' as const,
          },
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'High-impact changes showing critical security and bug fixes with prominent impact indicators.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    changes: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state when no changes are provided - component renders nothing.',
      },
    },
  },
};

export const MinimalChanges: Story = {
  args: {
    changes: [
      {
        id: 'minimal-1',
        type: 'docs' as const,
        title: 'Fix typo in README',
        commitHash: 'typo01x',
        totalFiles: 1,
        files: [{ path: 'README.md', additions: 1, deletions: 1, impact: 'low' as const }],
      },
      {
        id: 'minimal-2',
        type: 'maintenance' as const,
        title: 'Update version number',
        commitHash: 'ver02x',
        totalFiles: 1,
        files: [{ path: 'package.json', additions: 1, deletions: 1, impact: 'low' as const }],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Minimal changes with single files and low impact modifications.',
      },
    },
  },
};

export const FileTypeVariety: Story = {
  args: {
    changes: [
      {
        id: 'file-variety',
        type: 'feature' as const,
        title: 'Add multi-language support',
        commitHash: 'i18n001',
        totalFiles: 8,
        maxDisplayFiles: 6,
        files: [
          {
            path: 'src/i18n/translations.json',
            additions: 234,
            deletions: 0,
            impact: 'medium' as const,
          },
          {
            path: 'src/components/LanguageSelector.tsx',
            additions: 67,
            deletions: 0,
            impact: 'medium' as const,
          },
          {
            path: 'src/styles/rtl-support.css',
            additions: 45,
            deletions: 0,
            impact: 'low' as const,
          },
          {
            path: 'docs/internationalization.md',
            additions: 89,
            deletions: 0,
            impact: 'low' as const,
          },
          { path: 'config/i18n-config.js', additions: 23, deletions: 0, impact: 'low' as const },
          {
            path: 'src/utils/locale-detector.ts',
            additions: 34,
            deletions: 0,
            impact: 'medium' as const,
          },
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Showcase of different file types with appropriate icons: TypeScript, CSS, JSON, Markdown, and JavaScript files.',
      },
    },
  },
};

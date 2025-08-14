// ABOUTME: Storybook story for IntegrationEntry.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { IntegrationEntry } from './IntegrationEntry';

const meta: Meta<typeof IntegrationEntry> = {
  title: 'Organisms/IntegrationEntry',
  component: IntegrationEntry,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Integration entry component that displays timeline entries for external service integrations like Google Drive, Google Sheets, Slack, and GitHub. Shows action history, metadata, and provides links to external resources.',
      },
    },
  },
  argTypes: {
    entry: {
      description: 'Integration entry data',
      control: 'object',
    },
    compact: {
      description: 'Whether to show compact view',
      control: 'boolean',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof IntegrationEntry>;

// Sample integration entries for different services
const baseTimestamp = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago

export const GoogleDriveDocument: Story = {
  args: {
    entry: {
      id: '1',
      type: 'google-drive',
      timestamp: baseTimestamp,
      action: 'created',
      title: 'Project Requirements.docx',
      description:
        'Created comprehensive project requirements document with detailed specifications',
      url: 'https://drive.google.com/file/d/example',
      fileType: 'document',
      sharedWith: ['john@example.com', 'jane@example.com'],
      user: {
        name: 'Claude',
        avatar: 'https://example.com/avatar.jpg',
      },
    },
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Google Drive document integration entry showing file creation with sharing information.',
      },
    },
  },
};

export const GoogleSheetsAnalysis: Story = {
  args: {
    entry: {
      id: '2',
      type: 'google-sheets',
      timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      action: 'updated',
      title: 'Data Analysis Report',
      description: 'Updated spreadsheet with latest performance metrics and trend analysis',
      url: 'https://sheets.google.com/example',
      sheetName: 'Performance Metrics',
      rowsAdded: 50,
      collaborators: ['analyst@example.com', 'manager@example.com'],
      user: {
        name: 'Claude',
      },
    },
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Google Sheets integration entry showing data analysis updates with row counts and collaborators.',
      },
    },
  },
};

export const SlackMessage: Story = {
  args: {
    entry: {
      id: '3',
      type: 'slack',
      timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      action: 'posted',
      title: 'Development Update',
      description: 'Posted update about feature completion and upcoming deployments',
      url: 'https://workspace.slack.com/messages/example',
      channel: '#development',
      messagePreview:
        'Feature XYZ is now complete and ready for testing. Deployment scheduled for tomorrow.',
      reactions: [
        { emoji: '👍', count: 5 },
        { emoji: '🚀', count: 3 },
        { emoji: '✅', count: 2 },
      ],
      user: {
        name: 'Claude',
      },
    },
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Slack integration entry showing message posting with channel, preview, and reactions.',
      },
    },
  },
};

export const GitHubPullRequest: Story = {
  args: {
    entry: {
      id: '4',
      type: 'github',
      timestamp: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      action: 'created',
      title: 'Add user authentication system',
      description: 'Implemented OAuth2 authentication with Google and GitHub providers',
      url: 'https://github.com/example/repo/pull/123',
      repository: 'example/lace',
      pullRequest: 123,
      commitCount: 8,
      user: {
        name: 'Claude',
      },
    },
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'GitHub integration entry showing pull request creation with repository info and commit count.',
      },
    },
  },
};

export const CompactView: Story = {
  args: {
    entry: {
      id: '5',
      type: 'google-drive',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      action: 'shared',
      title: 'Meeting Notes.docx',
      description: 'Shared meeting notes with the team',
      url: 'https://drive.google.com/file/d/example',
      fileType: 'document',
      sharedWith: ['team@example.com'],
    },
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Compact view of integration entry for timeline or summary displays.',
      },
    },
  },
};

export const AllIntegrationTypes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Integration Timeline</div>
      <div className="space-y-3">
        <IntegrationEntry
          entry={{
            id: '1',
            type: 'google-drive',
            timestamp: new Date(Date.now() - 10 * 60 * 1000),
            action: 'created',
            title: 'API Documentation.pdf',
            description: 'Created comprehensive API documentation',
            url: 'https://drive.google.com/file/d/example',
            fileType: 'document',
            sharedWith: ['dev-team@example.com'],
            user: { name: 'Claude' },
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '2',
            type: 'google-sheets',
            timestamp: new Date(Date.now() - 25 * 60 * 1000),
            action: 'completed',
            title: 'Performance Analysis',
            description: 'Completed quarterly performance analysis',
            url: 'https://sheets.google.com/example',
            sheetName: 'Q4 Analysis',
            rowsAdded: 75,
            collaborators: ['analyst@example.com'],
            user: { name: 'Claude' },
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '3',
            type: 'slack',
            timestamp: new Date(Date.now() - 40 * 60 * 1000),
            action: 'posted',
            title: 'Daily Standup',
            description: 'Posted daily standup summary',
            url: 'https://workspace.slack.com/messages/example',
            channel: '#daily-standup',
            messagePreview: 'Yesterday: API docs completed. Today: Working on integration tests.',
            reactions: [{ emoji: '👍', count: 3 }],
            user: { name: 'Claude' },
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '4',
            type: 'github',
            timestamp: new Date(Date.now() - 90 * 60 * 1000),
            action: 'completed',
            title: 'Fix authentication bug',
            description: 'Merged pull request fixing OAuth timeout issue',
            url: 'https://github.com/example/repo/pull/124',
            repository: 'example/lace',
            pullRequest: 124,
            commitCount: 3,
            user: { name: 'Claude' },
          }}
          compact={false}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Timeline view showing all integration types in a realistic conversation flow.',
      },
    },
  },
};

export const CompactTimeline: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Recent Activity (Compact)</div>
      <div className="space-y-2">
        <IntegrationEntry
          entry={{
            id: '1',
            type: 'google-drive',
            timestamp: new Date(Date.now() - 5 * 60 * 1000),
            action: 'created',
            title: 'Weekly Report.docx',
            url: 'https://drive.google.com/file/d/example',
            fileType: 'document',
            sharedWith: ['manager@example.com'],
          }}
          compact={true}
        />
        <IntegrationEntry
          entry={{
            id: '2',
            type: 'slack',
            timestamp: new Date(Date.now() - 15 * 60 * 1000),
            action: 'posted',
            title: 'Code Review Request',
            url: 'https://workspace.slack.com/messages/example',
            channel: '#code-review',
            messagePreview: 'Please review PR #125 when you have a moment.',
          }}
          compact={true}
        />
        <IntegrationEntry
          entry={{
            id: '3',
            type: 'github',
            timestamp: new Date(Date.now() - 30 * 60 * 1000),
            action: 'updated',
            title: 'Feature branch updates',
            url: 'https://github.com/example/repo/pull/125',
            repository: 'example/lace',
            pullRequest: 125,
            commitCount: 2,
          }}
          compact={true}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Compact timeline view suitable for sidebars or summary displays.',
      },
    },
  },
};

export const WithoutURL: Story = {
  args: {
    entry: {
      id: '6',
      type: 'google-sheets',
      timestamp: new Date(Date.now() - 45 * 60 * 1000),
      action: 'updated',
      title: 'Internal Analysis',
      description: 'Updated internal analysis spreadsheet (no external access)',
      sheetName: 'Internal Data',
      rowsAdded: 25,
      collaborators: ['internal@example.com'],
      user: { name: 'Claude' },
    },
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Integration entry without external URL - shows how the component handles internal resources.',
      },
    },
  },
};

export const DifferentActions: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Different Action Types</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IntegrationEntry
          entry={{
            id: '1',
            type: 'google-drive',
            timestamp: new Date(Date.now() - 10 * 60 * 1000),
            action: 'created',
            title: 'New Document',
            fileType: 'document',
            sharedWith: ['team@example.com'],
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '2',
            type: 'google-drive',
            timestamp: new Date(Date.now() - 20 * 60 * 1000),
            action: 'shared',
            title: 'Shared Document',
            fileType: 'document',
            sharedWith: ['external@example.com'],
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '3',
            type: 'slack',
            timestamp: new Date(Date.now() - 30 * 60 * 1000),
            action: 'posted',
            title: 'Team Update',
            channel: '#general',
            messagePreview: 'Weekly team update is now available.',
          }}
          compact={false}
        />
        <IntegrationEntry
          entry={{
            id: '4',
            type: 'github',
            timestamp: new Date(Date.now() - 40 * 60 * 1000),
            action: 'completed',
            title: 'Bug Fix',
            repository: 'example/lace',
            pullRequest: 126,
            commitCount: 1,
          }}
          compact={false}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of different action types across various integration services.',
      },
    },
  },
};

export const ResponsiveDesign: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Responsive Design</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border-2 border-dashed border-base-300 p-4 rounded-lg">
          <h4 className="text-sm font-medium mb-3">Mobile View</h4>
          <div className="w-full max-w-sm space-y-2">
            <IntegrationEntry
              entry={{
                id: '1',
                type: 'google-drive',
                timestamp: new Date(Date.now() - 10 * 60 * 1000),
                action: 'created',
                title: 'Mobile Document.pdf',
                description: 'Created on mobile device',
                fileType: 'document',
                sharedWith: ['mobile@example.com'],
              }}
              compact={true}
            />
            <IntegrationEntry
              entry={{
                id: '2',
                type: 'slack',
                timestamp: new Date(Date.now() - 20 * 60 * 1000),
                action: 'posted',
                title: 'Quick Update',
                channel: '#mobile',
                messagePreview: 'Posted from mobile app.',
              }}
              compact={true}
            />
          </div>
        </div>
        <div className="border-2 border-dashed border-base-300 p-4 rounded-lg">
          <h4 className="text-sm font-medium mb-3">Desktop View</h4>
          <div className="w-full space-y-3">
            <IntegrationEntry
              entry={{
                id: '3',
                type: 'google-sheets',
                timestamp: new Date(Date.now() - 15 * 60 * 1000),
                action: 'updated',
                title: 'Desktop Analysis',
                description: 'Comprehensive data analysis performed on desktop',
                sheetName: 'Desktop Data',
                rowsAdded: 100,
                collaborators: ['desktop@example.com'],
              }}
              compact={false}
            />
            <IntegrationEntry
              entry={{
                id: '4',
                type: 'github',
                timestamp: new Date(Date.now() - 25 * 60 * 1000),
                action: 'created',
                title: 'Desktop Feature Implementation',
                description: 'Implemented complex feature using desktop development environment',
                repository: 'example/lace',
                pullRequest: 127,
                commitCount: 12,
              }}
              compact={false}
            />
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Integration entry responsive design showing how it adapts to different screen sizes.',
      },
    },
  },
};

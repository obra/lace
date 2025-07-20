import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import GoogleDocChatMessage from './GoogleDocChatMessage';

const meta: Meta<typeof GoogleDocChatMessage> = {
  title: 'Organisms/GoogleDocChatMessage',
  component: GoogleDocChatMessage,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## GoogleDocChatMessage

**Atomic Classification**: Document Integration Organism  
**Composed of**: Avatar + Badge + MessageText + IconButton + DocumentSkeleton + Image atoms + complex layout molecules  
**Single Responsibility**: Rich chat message display with Google Docs document preview, metadata, and interaction capabilities

### Purpose
A sophisticated chat message organism that extends basic chat functionality to include rich document previews, metadata display, and document interaction features. Specifically designed for Google Docs integration with thumbnail previews, permission management, and expandable content.

### When to Use
- Chat interfaces with document sharing capabilities
- Google Docs integration and collaboration features
- Rich media chat messages with document previews
- Document-centric collaboration platforms
- File sharing and preview systems
- Educational or business chat applications

### Atomic Composition
- **Avatar**: User/agent profile pictures with role identification
- **Badge**: Permission indicators (view/comment/edit) with semantic colors
- **MessageText**: User names, timestamps, and document metadata
- **IconButton**: Expand/collapse, external link, and permission icons
- **DocumentSkeleton**: Loading states for document preview
- **Image**: Document thumbnails with error handling
- **Container**: Complex layout with headers, previews, and actions

### Design Tokens Used
- **Colors**: Role-based gradients (teal for user, orange for agent), semantic permission colors
- **Spacing**: Consistent gaps (gap-3) and padding (p-3) throughout layout
- **Typography**: Hierarchical text sizing (text-sm, text-xs) with semantic weights
- **Borders**: Document container borders and rounded corners
- **Shadows**: None (relies on borders for definition)
- **Animations**: None (static layout focused on content)

### Document Integration Features
- **Google Docs URL Detection**: Automatic detection and handling of Google Docs URLs
- **Thumbnail Generation**: OG image fetching with graceful fallbacks
- **Permission Display**: Visual indicators for view/comment/edit permissions
- **Expandable Content**: Collapsible document preview for space efficiency
- **Metadata Display**: Document title, owner, and modification date
- **External Links**: Direct integration with Google Docs opening

### State Management
- **Expansion State**: Controlled expand/collapse for document previews
- **Image Error Handling**: Graceful fallbacks for failed thumbnail loading
- **Loading States**: Skeleton loading during OG image fetching
- **Permission States**: Visual differentiation between permission levels
- **URL Validation**: Google Docs URL detection and validation

### Integration Points
- **useOgImage Hook**: Automatic Open Graph image fetching
- **FontAwesome Icons**: Consistent iconography for documents and actions
- **DocumentSkeleton**: Reusable loading component integration
- **URL Utils**: Google Docs URL detection and validation
- **Message Types**: Extended Message interface with document properties

### Visual Features
- **Role-based Styling**: Different colors for user vs agent messages
- **Permission Badges**: Color-coded permission indicators
- **Document Previews**: Thumbnail images with fallback icons
- **Expandable Layout**: Collapsible content sections
- **Metadata Display**: Rich document information presentation
- **Action Buttons**: Quick access to document operations

### Error Handling
- **Image Loading Errors**: Graceful fallbacks to document icons
- **Missing Thumbnails**: Automatic OG image fetching
- **URL Validation**: Safe handling of malformed URLs
- **Permission Errors**: Clear visual indicators for access levels
- **Loading States**: Skeleton loading during async operations

### Accessibility
- **Keyboard Navigation**: Full keyboard support for all interactions
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Theme-aware styling for accessibility
- **Alternative Text**: Descriptive alt text for document images
- **Role Identification**: Clear user/agent role indicators

### Organism Guidelines
✓ **Do**: Use for document-rich chat messages with Google Docs integration  
✓ **Do**: Provide proper document metadata and permission information  
✓ **Do**: Include expandable content for space-efficient layouts  
✓ **Do**: Handle image loading errors gracefully  
✓ **Do**: Support keyboard navigation and accessibility  
✗ **Don't**: Use for simple text-only chat messages  
✗ **Don't**: Override document URL validation without testing  
✗ **Don't**: Skip loading states for async operations  
✗ **Don't**: Ignore permission-based styling and functionality
        `,
      },
    },
  },
  argTypes: {
    message: {
      description: 'Extended message object with document information',
      control: { type: 'object' },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const baseChatMessage = {
  id: 'msg-1',
  content: 'I found this document that might be helpful for our project planning.',
  role: 'user' as const,
  timestamp: new Date(),
};

const sampleDocument = {
  id: 'doc-1',
  title: 'Project Planning Template - Q4 2024',
  url: 'https://docs.google.com/document/d/1234567890/edit',
  thumbnailUrl: 'https://via.placeholder.com/400x300/e3f2fd/1976d2?text=Project+Planning+Template',
  lastModified: new Date('2024-01-15'),
  owner: 'Sarah Johnson',
  permissions: 'edit' as const,
  preview: 'This document outlines our quarterly planning process and includes templates for project kickoffs, milestone tracking, and stakeholder communication. The template is designed to be flexible enough for various project types while maintaining consistency across teams.',
};

export const Default: Story = {
  args: {
    message: {
      ...baseChatMessage,
      document: sampleDocument,
    },
  },
  render: (args) => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
      <GoogleDocChatMessage {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default Google Doc chat message with document preview and metadata.',
      },
    },
  },
};

export const AgentMessage: Story = {
  args: {
    message: {
      ...baseChatMessage,
      role: 'assistant',
      content: 'I\'ve analyzed the document and found several areas where we can improve our workflow.',
      document: {
        ...sampleDocument,
        title: 'Workflow Analysis Report - January 2024',
        owner: 'Lace AI Assistant',
        permissions: 'view',
        preview: 'This automated analysis identifies bottlenecks in our current workflow and suggests improvements based on best practices from similar teams. The report includes metrics, recommendations, and implementation timelines.',
      },
    },
  },
  render: (args) => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
      <GoogleDocChatMessage {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Agent message with Google Doc attachment showing view-only permissions.',
      },
    },
  },
};

export const PermissionVariants: Story = {
  render: () => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100 space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Permission Levels</h3>
        <div className="space-y-4">
          <GoogleDocChatMessage
            message={{
              ...baseChatMessage,
              content: 'Here\'s the document with edit permissions.',
              document: {
                ...sampleDocument,
                permissions: 'edit',
                title: 'Editable Document - Full Access',
              },
            }}
          />
          <GoogleDocChatMessage
            message={{
              ...baseChatMessage,
              content: 'This document allows comments and suggestions.',
              document: {
                ...sampleDocument,
                permissions: 'comment',
                title: 'Collaborative Document - Comment Access',
              },
            }}
          />
          <GoogleDocChatMessage
            message={{
              ...baseChatMessage,
              content: 'This is a read-only document for reference.',
              document: {
                ...sampleDocument,
                permissions: 'view',
                title: 'Reference Document - View Only',
              },
            }}
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different permission levels showing edit, comment, and view-only access.',
      },
    },
  },
};

export const WithoutThumbnail: Story = {
  args: {
    message: {
      ...baseChatMessage,
      content: 'This document doesn\'t have a thumbnail preview.',
      document: {
        ...sampleDocument,
        thumbnailUrl: undefined,
        title: 'Internal Meeting Notes - No Thumbnail',
        preview: 'Weekly team meeting notes covering project updates, blockers, and next steps. This document is updated collaboratively by all team members.',
      },
    },
  },
  render: (args) => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
      <GoogleDocChatMessage {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Document message without thumbnail showing fallback icon display.',
      },
    },
  },
};

export const LongContent: Story = {
  args: {
    message: {
      ...baseChatMessage,
      content: 'This document has extensive content that demonstrates the expand/collapse functionality.',
      document: {
        ...sampleDocument,
        title: 'Comprehensive Project Documentation - Detailed Content',
        preview: 'This comprehensive project documentation covers all aspects of our development process, from initial planning through deployment and maintenance. It includes detailed sections on architecture decisions, coding standards, testing procedures, deployment processes, monitoring strategies, and post-launch support. The document serves as a single source of truth for all project-related information and is regularly updated by the development team. Additional sections cover risk management, timeline tracking, resource allocation, and stakeholder communication protocols. This extensive documentation ensures that all team members have access to the information they need to contribute effectively to the project.',
      },
    },
  },
  render: (args) => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
      <GoogleDocChatMessage {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Document with long content demonstrating expand/collapse functionality.',
      },
    },
  },
};

export const LoadingState: Story = {
  render: () => {
    const [isLoading, setIsLoading] = useState(true);
    
    // Simulate loading completion after 2 seconds
    setTimeout(() => setIsLoading(false), 2000);
    
    return (
      <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
        <div className="mb-4">
          <button 
            onClick={() => setIsLoading(true)}
            className="btn btn-primary btn-sm"
          >
            Simulate Loading
          </button>
        </div>
        <GoogleDocChatMessage
          message={{
            ...baseChatMessage,
            content: 'Loading document preview...',
            document: isLoading ? {
              ...sampleDocument,
              thumbnailUrl: undefined,
            } : sampleDocument,
          }}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state showing skeleton loader while fetching document preview.',
      },
    },
  },
};

export const ChatConversation: Story = {
  render: () => (
    <div className="w-full max-w-3xl mx-auto p-6 bg-base-100">
      <div className="space-y-4">
        <GoogleDocChatMessage
          message={{
            id: 'msg-1',
            content: 'Can you help me review this project proposal?',
            role: 'user',
            timestamp: new Date(Date.now() - 300000),
            document: {
              ...sampleDocument,
              title: 'Q4 Project Proposal - Review Required',
              permissions: 'edit',
              preview: 'This proposal outlines our plans for the Q4 initiatives including timeline, budget, and resource requirements.',
            },
          }}
        />
        <GoogleDocChatMessage
          message={{
            id: 'msg-2',
            content: 'I\'ve reviewed the proposal and created a feedback document with my suggestions.',
            role: 'assistant',
            timestamp: new Date(Date.now() - 240000),
            document: {
              id: 'doc-2',
              title: 'Proposal Feedback - Lace Analysis',
              url: 'https://docs.google.com/document/d/feedback123/edit',
              thumbnailUrl: 'https://via.placeholder.com/400x300/fff3e0/f57c00?text=Feedback+Document',
              lastModified: new Date(),
              owner: 'Lace AI Assistant',
              permissions: 'comment',
              preview: 'Detailed feedback on the Q4 proposal including budget optimization suggestions, timeline adjustments, and resource allocation recommendations.',
            },
          }}
        />
        <GoogleDocChatMessage
          message={{
            id: 'msg-3',
            content: 'Thanks! I\'ll incorporate your feedback and update the proposal.',
            role: 'user',
            timestamp: new Date(Date.now() - 180000),
          }}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Full conversation showing multiple Google Doc messages in context.',
      },
    },
  },
};

export const MobileView: Story = {
  render: () => (
    <div className="w-full max-w-sm mx-auto p-4 bg-base-100 border border-base-300 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Mobile Chat</h3>
      <GoogleDocChatMessage
        message={{
          ...baseChatMessage,
          content: 'Shared doc for mobile review',
          document: {
            ...sampleDocument,
            title: 'Mobile-Optimized Document',
            preview: 'This document is optimized for mobile viewing with shorter content sections and clear formatting.',
          },
        }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Google Doc message adapted for mobile screen sizes.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 GoogleDocChatMessage Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then interact with the document previews!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Document with Thumbnail</h4>
          <div className="bg-base-100 border border-base-300 rounded-lg p-4">
            <GoogleDocChatMessage
              message={{
                ...baseChatMessage,
                content: 'Project planning document with preview',
                document: {
                  ...sampleDocument,
                  title: 'Interactive Demo Document',
                },
              }}
            />
          </div>
        </div>
        
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Permission Variants</h4>
          <div className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-3">
            <GoogleDocChatMessage
              message={{
                ...baseChatMessage,
                content: 'Edit permissions',
                document: {
                  ...sampleDocument,
                  permissions: 'edit',
                  title: 'Editable Document',
                  preview: 'Click to expand and see the full content preview.',
                },
              }}
            />
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">GoogleDocChatMessage Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Document Previews</strong> - Rich thumbnails and content previews</li>
          <li>• <strong>Permission Management</strong> - Visual indicators for access levels</li>
          <li>• <strong>Expandable Content</strong> - Collapsible document previews</li>
          <li>• <strong>Loading States</strong> - Skeleton loading for async operations</li>
          <li>• <strong>Error Handling</strong> - Graceful fallbacks for failed images</li>
          <li>• <strong>Google Docs Integration</strong> - Direct link to documents</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing GoogleDocChatMessage with tennis commentary. Enable commentary in the toolbar and interact with the documents!',
      },
    },
  },
};
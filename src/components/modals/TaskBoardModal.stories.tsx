import type { Meta, StoryObj } from '@storybook/react';
import { TaskBoardModal } from './TaskBoardModal';
import { Task } from '~/types';

const meta: Meta<typeof TaskBoardModal> = {
  title: 'Organisms/TaskBoardModal',
  component: TaskBoardModal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## TaskBoardModal

**Atomic Classification**: Task Management Organism  
**Composed of**: Modal + Kanban board + Task cards + Form inputs  
**Single Responsibility**: Full-featured task management interface with drag-and-drop Kanban board functionality

### Purpose
A comprehensive task management modal that provides a Kanban-style board interface for organizing, creating, and updating project tasks across different status columns with drag-and-drop functionality.

### When to Use
- Project task management and organization
- Team collaboration and task tracking
- Sprint planning and workflow management
- Task status visualization and updates
- Quick task creation and assignment

### Organism Composition
- **Modal Container**: Full-screen modal with close functionality
- **Task Creation Form**: Form for adding new tasks with priority and description
- **Kanban Board**: Four-column board (To Do, In Progress, Review, Done)
- **Task Cards**: Individual draggable task cards with priority indicators
- **Drag-and-Drop**: Interactive task movement between columns
- **Priority System**: Visual priority indicators (high, medium, low)

### Features
- **Drag-and-Drop**: Move tasks between status columns by dragging
- **Task Creation**: Form-based task creation with validation
- **Priority Management**: Visual priority indicators with color coding
- **Status Columns**: Four predefined status categories
- **Responsive Design**: Adapts from single column to four-column layout
- **Task Counts**: Column headers show task counts
- **Empty States**: Visual feedback when columns are empty

### State Management
- **Task List**: Array of tasks with status, priority, and metadata
- **Drag State**: Currently dragged task tracking
- **Form State**: New task creation form data
- **Modal State**: Open/close state management
- **Column State**: Tasks organized by status columns

### Integration Points
- **Modal Component**: Uses shared modal component for consistent behavior
- **FontAwesome Icons**: Consistent iconography throughout interface
- **Task Type**: Integrates with shared task type definitions
- **Event Handlers**: Callbacks for task creation and updates
- **Theme Support**: Respects current theme settings

### Visual Features
- **Kanban Layout**: Four-column board with color-coded headers
- **Priority Colors**: Red (high), yellow (medium), green (low) indicators
- **Drag Feedback**: Visual feedback during drag operations
- **Task Metadata**: Assignee, ID, and description display
- **Responsive Grid**: Adapts to different screen sizes
- **Empty State Icons**: Friendly empty state visuals

### Organism Guidelines
✓ **Do**: Use for comprehensive task management interfaces  
✓ **Do**: Implement drag-and-drop for intuitive task movement  
✓ **Do**: Provide clear visual feedback for all interactions  
✓ **Do**: Support task creation with proper validation  
✗ **Don't**: Use for simple task lists (use simpler components)  
✗ **Don't**: Skip accessibility features for drag-and-drop  
✗ **Don't**: Modify without testing responsive behavior  
✗ **Don't**: Remove task metadata or priority indicators

### Organism Hierarchy
- **Organism Level**: Complete task management interface
- **Molecule Level**: Task cards, form inputs, column headers
- **Atom Level**: Buttons, inputs, badges, icons
- **System Level**: Modal, drag-and-drop, form validation

### Performance Considerations
- **Drag Optimization**: Efficient drag-and-drop state management
- **Task Filtering**: Optimized task filtering by status
- **Form Validation**: Client-side validation for responsiveness
- **Memory Management**: Proper cleanup of drag event listeners
- **Responsive Rendering**: Optimized for different screen sizes
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample tasks for stories
const sampleTasks: Task[] = [
  {
    id: 1,
    title: 'AI Model Integration',
    description: 'Integrate latest language model with improved performance and reduced latency',
    priority: 'high',
    assignee: 'Claude',
    status: 'in_progress',
  },
  {
    id: 2,
    title: 'Auth Bug Fix',
    description: 'Fix session timeout issue occurring in production environment',
    priority: 'high',
    assignee: 'Human',
    status: 'pending',
  },
  {
    id: 3,
    title: 'Update Documentation',
    description: 'Comprehensive API documentation update with new endpoints',
    priority: 'medium',
    assignee: 'Claude',
    status: 'review',
  },
  {
    id: 4,
    title: 'Performance Optimization',
    description: 'Optimize database queries and implement caching strategies',
    priority: 'medium',
    assignee: 'Human',
    status: 'pending',
  },
  {
    id: 5,
    title: 'UI Component Library',
    description: 'Build reusable component library with Storybook documentation',
    priority: 'low',
    assignee: 'Claude',
    status: 'completed',
  },
  {
    id: 6,
    title: 'Security Audit',
    description: 'Conduct comprehensive security audit of authentication system',
    priority: 'high',
    assignee: 'Human',
    status: 'review',
  },
  {
    id: 7,
    title: 'Mobile Responsive Design',
    description: 'Ensure all components work seamlessly on mobile devices',
    priority: 'medium',
    assignee: 'Claude',
    status: 'completed',
  },
  {
    id: 8,
    title: 'Unit Test Coverage',
    description: 'Improve test coverage to 90% across all components',
    priority: 'low',
    assignee: 'Human',
    status: 'pending',
  },
];

const minimalTasks: Task[] = [
  {
    id: 1,
    title: 'Setup Project',
    description: 'Initialize new project with basic configuration',
    priority: 'high',
    assignee: 'Claude',
    status: 'in_progress',
  },
  {
    id: 2,
    title: 'Design Review',
    description: 'Review initial design mockups',
    priority: 'medium',
    assignee: 'Human',
    status: 'pending',
  },
];

export const Default: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Default task board modal with sample tasks distributed across all status columns.',
      },
    },
  },
};

export const EmptyBoard: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: [],
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty task board showing empty state for all columns.',
      },
    },
  },
};

export const MinimalTasks: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: minimalTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board with minimal set of tasks to show basic functionality.',
      },
    },
  },
};

export const HighPriorityTasks: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks.filter(task => task.priority === 'high'),
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board filtered to show only high priority tasks.',
      },
    },
  },
};

export const CompletedTasks: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks.filter(task => task.status === 'completed'),
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board showing only completed tasks in the Done column.',
      },
    },
  },
};

export const MobileView: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Task board optimized for mobile viewing with stacked columns.',
      },
    },
  },
};

export const TaskCreationFlow: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: minimalTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  render: (args) => (
    <div className="space-y-4">
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Task Creation Demo:</h4>
        <ol className="text-sm space-y-1">
          <li>1. Click "New Task" button in the header</li>
          <li>2. Fill in task title and select priority</li>
          <li>3. Optionally add description</li>
          <li>4. Click "Create Task" to add to board</li>
        </ol>
      </div>
      <TaskBoardModal {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Task board demonstrating the task creation workflow.',
      },
    },
  },
};

export const DragAndDropDemo: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  render: (args) => (
    <div className="space-y-4">
      <div className="bg-green-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Drag & Drop Demo:</h4>
        <ol className="text-sm space-y-1">
          <li>1. Click and hold any task card</li>
          <li>2. Drag the task to a different column</li>
          <li>3. Release to drop and update status</li>
          <li>4. Watch the task move between columns</li>
        </ol>
      </div>
      <TaskBoardModal {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Task board demonstrating drag-and-drop functionality between columns.',
      },
    },
  },
};

export const PriorityDistribution: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        title: `High Priority Task ${i + 1}`,
        description: `Critical task requiring immediate attention`,
        priority: 'high' as const,
        assignee: 'Claude',
        status: 'pending' as const,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: i + 4,
        title: `Medium Priority Task ${i + 1}`,
        description: `Important task for project progress`,
        priority: 'medium' as const,
        assignee: 'Human',
        status: 'in_progress' as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: i + 8,
        title: `Low Priority Task ${i + 1}`,
        description: `Nice to have feature or improvement`,
        priority: 'low' as const,
        assignee: 'Claude',
        status: 'review' as const,
      })),
    ],
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board showing distribution of tasks across different priority levels.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  render: (args) => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">📋 TaskBoardModal Interactive Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Complete Kanban-style task management with drag-and-drop functionality!
        </p>
      </div>
      
      <TaskBoardModal {...args} />
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">TaskBoardModal Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Drag-and-Drop</strong> - Move tasks between status columns</li>
          <li>• <strong>Task Creation</strong> - Form-based task creation with validation</li>
          <li>• <strong>Priority Management</strong> - Visual priority indicators</li>
          <li>• <strong>Status Tracking</strong> - Four-column Kanban board</li>
          <li>• <strong>Responsive Design</strong> - Works on all screen sizes</li>
          <li>• <strong>Real-time Updates</strong> - Immediate task status changes</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing the complete TaskBoardModal task management organism.',
      },
    },
  },
};
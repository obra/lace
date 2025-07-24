import type { Meta, StoryObj } from '@storybook/react';
import { TaskBoardModal } from './TaskBoardModal';
import { Task } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';

// Demo columns definition for stories
interface TaskColumn {
  id: string;
  title: string;
  status: Task['status'];
  color: string;
}

const DEMO_TASK_COLUMNS: TaskColumn[] = [
  {
    id: 'todo',
    title: 'To Do',
    status: 'pending',
    color: 'bg-blue-100 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  },
  {
    id: 'progress',
    title: 'In Progress',
    status: 'in_progress',
    color: 'bg-yellow-100 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
  },
  {
    id: 'blocked',
    title: 'Blocked',
    status: 'blocked',
    color: 'bg-purple-100 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800',
  },
  {
    id: 'done',
    title: 'Done',
    status: 'completed',
    color: 'bg-green-100 border-green-200 dark:bg-green-900/20 dark:border-green-800',
  },
];

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
- **Kanban Board**: Four-column board (To Do, In Progress, Blocked, Done)
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
    id: 'taskboard-task-001',
    title: 'AI Model Integration',
    description: 'Integrate latest language model with improved performance and reduced latency',
    prompt: 'Integrate the latest language model to improve performance and reduce latency in our AI system',
    priority: 'high',
    assignedTo: asThreadId('lace_20240115_session001.1'),
    status: 'in_progress',
    createdBy: asThreadId('lace_20240115_session001'),
    threadId: asThreadId('lace_20240115_session001'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-16T14:30:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-002',
    title: 'Auth Bug Fix',
    description: 'Fix session timeout issue occurring in production environment',
    prompt: 'Fix the session timeout issue that users are experiencing in production',
    priority: 'high',
    assignedTo: 'human',
    status: 'pending',
    createdBy: asThreadId('lace_20240115_session002'),
    threadId: asThreadId('lace_20240115_session002'),
    createdAt: new Date('2024-01-14T09:15:00Z'),
    updatedAt: new Date('2024-01-14T09:15:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-003',
    title: 'Update Documentation',
    description: 'Comprehensive API documentation update with new endpoints',
    prompt: 'Update our API documentation to include all new endpoints and improve clarity',
    priority: 'medium',
    assignedTo: asThreadId('lace_20240115_session001.1'),
    status: 'blocked',
    createdBy: asThreadId('lace_20240115_session003'),
    threadId: asThreadId('lace_20240115_session003'),
    createdAt: new Date('2024-01-13T16:20:00Z'),
    updatedAt: new Date('2024-01-15T11:45:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-004',
    title: 'Performance Optimization',
    description: 'Optimize database queries and implement caching strategies',
    prompt: 'Optimize our database performance through query optimization and caching implementation',
    priority: 'medium',
    assignedTo: 'human',
    status: 'pending',
    createdBy: asThreadId('lace_20240115_session004'),
    threadId: asThreadId('lace_20240115_session004'),
    createdAt: new Date('2024-01-12T13:30:00Z'),
    updatedAt: new Date('2024-01-12T13:30:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-005',
    title: 'UI Component Library',
    description: 'Build reusable component library with Storybook documentation',
    prompt: 'Create a comprehensive UI component library with proper Storybook documentation',
    priority: 'low',
    assignedTo: asThreadId('lace_20240115_session001.1'),
    status: 'completed',
    createdBy: asThreadId('lace_20240115_session005'),
    threadId: asThreadId('lace_20240115_session005'),
    createdAt: new Date('2024-01-10T08:00:00Z'),
    updatedAt: new Date('2024-01-14T17:00:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-006',
    title: 'Security Audit',
    description: 'Conduct comprehensive security audit of authentication system',
    prompt: 'Perform a thorough security audit of our authentication and authorization systems',
    priority: 'high',
    assignedTo: 'human',
    status: 'blocked',
    createdBy: asThreadId('lace_20240115_session006'),
    threadId: asThreadId('lace_20240115_session006'),
    createdAt: new Date('2024-01-11T14:15:00Z'),
    updatedAt: new Date('2024-01-13T10:20:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-007',
    title: 'Mobile Responsive Design',
    description: 'Ensure all components work seamlessly on mobile devices',
    prompt: 'Make our application fully responsive and mobile-friendly across all components',
    priority: 'medium',
    assignedTo: asThreadId('lace_20240115_session001.1'),
    status: 'completed',
    createdBy: asThreadId('lace_20240115_session007'),
    threadId: asThreadId('lace_20240115_session007'),
    createdAt: new Date('2024-01-09T12:45:00Z'),
    updatedAt: new Date('2024-01-12T16:30:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-008',
    title: 'Unit Test Coverage',
    description: 'Improve test coverage to 90% across all components',
    prompt: 'Increase our unit test coverage to 90% to improve code reliability and maintainability',
    priority: 'low',
    assignedTo: 'human',
    status: 'pending',
    createdBy: asThreadId('lace_20240115_session008'),
    threadId: asThreadId('lace_20240115_session008'),
    createdAt: new Date('2024-01-08T15:00:00Z'),
    updatedAt: new Date('2024-01-08T15:00:00Z'),
    notes: [],
  },
];

const minimalTasks: Task[] = [
  {
    id: 'taskboard-task-minimal-001',
    title: 'Setup Project',
    description: 'Initialize new project with basic configuration',
    prompt: 'Set up a new project with all necessary configuration and dependencies',
    priority: 'high',
    assignedTo: asThreadId('lace_20240115_session001.1'),
    status: 'in_progress',
    createdBy: asThreadId('lace_20240115_sessionminimal001'),
    threadId: asThreadId('lace_20240115_sessionminimal001'),
    createdAt: new Date('2024-01-16T10:00:00Z'),
    updatedAt: new Date('2024-01-16T12:00:00Z'),
    notes: [],
  },
  {
    id: 'taskboard-task-minimal-002',
    title: 'Design Review',
    description: 'Review initial design mockups',
    prompt: 'Review and provide feedback on the initial design mockups for the project',
    priority: 'medium',
    assignedTo: 'human',
    status: 'pending',
    createdBy: asThreadId('lace_20240115_sessionminimal002'),
    threadId: asThreadId('lace_20240115_sessionminimal002'),
    createdAt: new Date('2024-01-16T11:00:00Z'),
    updatedAt: new Date('2024-01-16T11:00:00Z'),
    notes: [],
  },
];

export const Default: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    columns: DEMO_TASK_COLUMNS,
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
  },
  render: (args) => (
    <div className="space-y-4">
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Task Creation Demo:</h4>
        <ol className="text-sm space-y-1">
          <li>1. Click &quot;New Task&quot; button in the header</li>
          <li>2. Fill in task title and select priority</li>
          <li>3. Optionally add description</li>
          <li>4. Click &quot;Create Task&quot; to add to board</li>
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
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
        id: `taskboard-task-high-${String(i + 1).padStart(3, '0')}`,
        title: `High Priority Task ${i + 1}`,
        description: `Critical task requiring immediate attention`,
        prompt: `Handle critical high priority task number ${i + 1}`,
        priority: 'high' as const,
        assignedTo: asThreadId('lace_20240115_session001.1'),
        status: 'pending' as const,
        createdBy: asThreadId('lace_20240115_threadhigh001'),
        threadId: asThreadId('lace_20240115_threadhigh001'),
        createdAt: new Date(`2024-01-${String(15 + i).padStart(2, '0')}T10:00:00Z`),
        updatedAt: new Date(`2024-01-${String(15 + i).padStart(2, '0')}T10:00:00Z`),
        notes: [],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `taskboard-task-medium-${String(i + 1).padStart(3, '0')}`,
        title: `Medium Priority Task ${i + 1}`,
        description: `Important task for project progress`,
        prompt: `Complete medium priority task number ${i + 1}`,
        priority: 'medium' as const,
        assignedTo: 'human' as const,
        status: 'in_progress' as const,
        createdBy: asThreadId('lace_20240115_threadmedium001'),
        threadId: asThreadId('lace_20240115_threadmedium001'),
        createdAt: new Date(`2024-01-${String(12 + i).padStart(2, '0')}T14:00:00Z`),
        updatedAt: new Date(`2024-01-${String(13 + i).padStart(2, '0')}T09:00:00Z`),
        notes: [],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `taskboard-task-low-${String(i + 1).padStart(3, '0')}`,
        title: `Low Priority Task ${i + 1}`,
        description: `Nice to have feature or improvement`,
        prompt: `Work on low priority enhancement task number ${i + 1}`,
        priority: 'low' as const,
        assignedTo: asThreadId('lace_20240115_session001.1'),
        status: 'blocked' as const,
        createdBy: asThreadId('lace_20240115_threadlow001'),
        threadId: asThreadId('lace_20240115_threadlow001'),
        createdAt: new Date(`2024-01-${String(10 + i).padStart(2, '0')}T16:00:00Z`),
        updatedAt: new Date(`2024-01-${String(14 + i).padStart(2, '0')}T11:00:00Z`),
        notes: [],
      })),
    ],
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board showing distribution of tasks across different priority levels.',
      },
    },
  },
};

export const CustomColumns: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    columns: [
      {
        id: 'backlog',
        title: 'Backlog',
        status: 'pending',
        color: 'bg-gray-100 border-gray-200 dark:bg-gray-900/20 dark:border-gray-800',
      },
      {
        id: 'active',
        title: 'Active Sprint',
        status: 'in_progress',
        color: 'bg-blue-100 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
      },
      {
        id: 'review',
        title: 'Code Review',
        status: 'blocked',
        color: 'bg-orange-100 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800',
      },
      {
        id: 'shipped',
        title: 'Shipped',
        status: 'completed',
        color: 'bg-emerald-100 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
      },
    ],
    onTaskUpdate: (task) => console.log('Task updated:', task),
    onTaskCreate: (task) => console.log('Task created:', task),
  },
  parameters: {
    docs: {
      description: {
        story: 'Task board with custom column configuration showing different titles and colors.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    tasks: sampleTasks,
    onTaskUpdate: (task) => console.log('Task updated:', task), // Task updated
    onTaskCreate: (task) => console.log('Task created:', task), // Task created
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
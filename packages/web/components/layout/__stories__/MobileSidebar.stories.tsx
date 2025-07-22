// ABOUTME: Storybook stories for the composable MobileSidebar component
// ABOUTME: Demonstrates mobile-optimized overlay with composition patterns

import type { Meta, StoryObj } from '@storybook/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faComments, faRobot, faPlus, faTasks } from '@/lib/fontawesome';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { useState } from 'react';

const meta: Meta<typeof MobileSidebar> = {
  title: 'Layout/MobileSidebar',
  component: MobileSidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'A mobile-optimized sidebar with overlay and backdrop, using the same composition pattern as the desktop sidebar.',
      },
    },
  },
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'Whether the mobile sidebar is open',
    },
    currentTheme: {
      control: 'select',
      options: ['light', 'dark', 'cupcake', 'cyberpunk'],
      description: 'Current theme name',
    },
  },
};

export default meta;
type Story = StoryObj<typeof MobileSidebar>;

// Mock data
const mockProjects = [
  { id: '1', name: 'E-commerce Site', sessionCount: 3 },
  { id: '2', name: 'Mobile App', sessionCount: 1 },
  { id: '3', name: 'API Backend', sessionCount: 0 },
];

const mockSessions = [
  { id: 'session-1', name: 'User Authentication', agentCount: 2 },
  { id: 'session-2', name: 'Product Catalog', agentCount: 1 },
  { id: 'session-3', name: 'Payment Flow', agentCount: 3 },
];

const mockAgents = [
  { threadId: 'agent-1', name: 'Coordinator', provider: 'anthropic' },
  { threadId: 'agent-2', name: 'Frontend Dev', provider: 'openai' },
  { threadId: 'agent-3', name: 'Backend Dev', provider: 'anthropic' },
];

// Interactive wrapper component for controlling the open state
function InteractiveMobileSidebar({ children, ...props }: { children: React.ReactNode; isOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(props.isOpen || false);
  
  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {/* Mobile viewport simulation */}
      <div className="w-full h-full bg-base-200 flex flex-col">
        <div className="p-4 border-b border-base-300 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Mobile App</h1>
          <button 
            className="btn btn-primary btn-sm lg:hidden"
            onClick={() => setIsOpen(true)}
          >
            Open Sidebar
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-base-content/60 text-center">
            {isOpen ? 'Sidebar is open' : 'Click "Open Sidebar" to see the mobile sidebar'}
          </p>
        </div>
      </div>
      
      <MobileSidebar 
        {...props} 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)}
      >
        {children}
      </MobileSidebar>
    </div>
  );
}

export const ProjectsOnly: Story = {
  args: {
    isOpen: true,
    currentTheme: 'dark',
    onClose: () => {},
    onThemeChange: () => {},
  },
  render: (args) => (
    <InteractiveMobileSidebar {...args}>
      <SidebarSection title="Projects" icon={faFolder}>
        {mockProjects.map((project) => (
          <SidebarItem key={project.id} active={project.id === '1'}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                <span>{project.name}</span>
              </div>
              {project.sessionCount > 0 && (
                <span className="text-xs text-base-content/40">
                  {project.sessionCount}
                </span>
              )}
            </div>
          </SidebarItem>
        ))}
      </SidebarSection>
    </InteractiveMobileSidebar>
  ),
};

export const ProjectsAndSessions: Story = {
  args: {
    isOpen: true,
    currentTheme: 'dark',
    onClose: () => {},
    onThemeChange: () => {},
  },
  render: (args) => (
    <InteractiveMobileSidebar {...args}>
      <SidebarSection title="Projects" icon={faFolder}>
        {mockProjects.map((project) => (
          <SidebarItem key={project.id} active={project.id === '1'}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                <span>{project.name}</span>
              </div>
              {project.sessionCount > 0 && (
                <span className="text-xs text-base-content/40">
                  {project.sessionCount}
                </span>
              )}
            </div>
          </SidebarItem>
        ))}
      </SidebarSection>

      <SidebarSection title="Sessions" icon={faComments}>
        {mockSessions.map((session) => (
          <SidebarItem key={session.id} active={session.id === 'session-1'}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faComments} className="w-4 h-4" />
                <span>{session.name}</span>
              </div>
              <span className="text-xs text-base-content/40">
                {session.agentCount} agents
              </span>
            </div>
          </SidebarItem>
        ))}
        <SidebarButton>
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
          New Session
        </SidebarButton>
      </SidebarSection>
    </InteractiveMobileSidebar>
  ),
};

export const FullHierarchy: Story = {
  args: {
    isOpen: true,
    currentTheme: 'dark',
    onClose: () => {},
    onThemeChange: () => {},
  },
  render: (args) => (
    <InteractiveMobileSidebar {...args}>
      <SidebarSection title="Projects" icon={faFolder}>
        {mockProjects.map((project) => (
          <SidebarItem key={project.id} active={project.id === '1'}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                <span>{project.name}</span>
              </div>
              {project.sessionCount > 0 && (
                <span className="text-xs text-base-content/40">
                  {project.sessionCount}
                </span>
              )}
            </div>
          </SidebarItem>
        ))}
      </SidebarSection>

      <SidebarSection title="Agents" icon={faRobot}>
        {mockAgents.map((agent) => (
          <SidebarItem key={agent.threadId} active={agent.threadId === 'agent-1'}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
                <span>{agent.name}</span>
              </div>
              <span className="text-xs text-base-content/40">
                {agent.provider}
              </span>
            </div>
          </SidebarItem>
        ))}
        <SidebarButton variant="secondary">
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
          New Agent
        </SidebarButton>
      </SidebarSection>

      <SidebarSection title="Tasks" icon={faTasks} collapsible={true} defaultCollapsed={true}>
        <SidebarItem>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span>Implement OAuth</span>
          </div>
        </SidebarItem>
        <SidebarItem>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>Add unit tests</span>
          </div>
        </SidebarItem>
      </SidebarSection>
    </InteractiveMobileSidebar>
  ),
};

export const TouchInteractions: Story = {
  args: {
    isOpen: false,
    currentTheme: 'dark',
    onClose: () => {},
    onThemeChange: () => {},
  },
  render: (args) => (
    <InteractiveMobileSidebar {...args}>
      <SidebarSection title="Touch Demo" icon={faFolder}>
        <SidebarItem>
          <div className="text-center py-2">
            <p className="font-medium">Touch interactions:</p>
            <p className="text-sm text-base-content/60">• Tap items to select</p>
            <p className="text-sm text-base-content/60">• Tap backdrop to close</p>
            <p className="text-sm text-base-content/60">• Swipe gesture (iOS/Android)</p>
          </div>
        </SidebarItem>
        <SidebarButton>
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
          Touch-Friendly Button
        </SidebarButton>
      </SidebarSection>
    </InteractiveMobileSidebar>
  ),
};
// ABOUTME: Storybook stories for the new composable Sidebar components
// ABOUTME: Demonstrates flexible composition patterns and different usage scenarios

import type { Meta, StoryObj } from '@storybook/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faComments, faRobot, faPlus, faTasks } from '~/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '~/components/layout/Sidebar';

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'A flexible, composable sidebar that accepts custom content through composition rather than props.',
      },
    },
  },
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'Whether the sidebar is open or collapsed',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

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

export const ProjectsOnly: Story = {
  args: {
    isOpen: true,
    onToggle: () => {},
  },
  render: (args) => (
    <div style={{ height: '100vh', display: 'flex' }}>
      <Sidebar {...args}>
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
      </Sidebar>
      <div className="flex-1 bg-base-200 flex items-center justify-center">
        <p className="text-base-content/60">Select a project to see sessions</p>
      </div>
    </div>
  ),
};

export const ProjectsAndSessions: Story = {
  args: {
    isOpen: true,
    onToggle: () => {},
  },
  render: (args) => (
    <div style={{ height: '100vh', display: 'flex' }}>
      <Sidebar {...args}>
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
      </Sidebar>
      <div className="flex-1 bg-base-200 flex items-center justify-center">
        <p className="text-base-content/60">Select a session to see agents</p>
      </div>
    </div>
  ),
};

export const FullHierarchy: Story = {
  args: {
    isOpen: true,
    onToggle: () => {},
  },
  render: (args) => (
    <div style={{ height: '100vh', display: 'flex' }}>
      <Sidebar {...args}>
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
      </Sidebar>
      <div className="flex-1 bg-base-200 flex items-center justify-center">
        <p className="text-base-content/60">Agent conversation would appear here</p>
      </div>
    </div>
  ),
};

export const Collapsed: Story = {
  args: {
    isOpen: false,
    onToggle: () => {},
  },
  render: (args) => (
    <div style={{ height: '100vh', display: 'flex' }}>
      <Sidebar {...args}>
        <SidebarSection title="Projects" icon={faFolder}>
          {mockProjects.map((project) => (
            <SidebarItem key={project.id}>
              <span>{project.name}</span>
            </SidebarItem>
          ))}
        </SidebarSection>
      </Sidebar>
      <div className="flex-1 bg-base-200 flex items-center justify-center">
        <p className="text-base-content/60">Sidebar is collapsed</p>
      </div>
    </div>
  ),
};

export const ButtonVariants: Story = {
  args: {
    isOpen: true,
    onToggle: () => {},
  },
  render: (args) => (
    <div style={{ height: '100vh', display: 'flex' }}>
      <Sidebar {...args}>
        <SidebarSection title="Button Examples">
          <SidebarButton variant="primary">
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            Primary Button
          </SidebarButton>
          <SidebarButton variant="secondary">
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            Secondary Button
          </SidebarButton>
          <SidebarButton variant="ghost">
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            Ghost Button
          </SidebarButton>
          <SidebarButton size="sm">
            Small Button
          </SidebarButton>
          <SidebarButton disabled>
            Disabled Button
          </SidebarButton>
          <SidebarButton loading>
            Loading Button
          </SidebarButton>
        </SidebarSection>
      </Sidebar>
      <div className="flex-1 bg-base-200 flex items-center justify-center">
        <p className="text-base-content/60">Button variant examples</p>
      </div>
    </div>
  ),
};
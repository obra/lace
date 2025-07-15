import {
  faSearch,
  faTerminal,
  faTasks,
  faUser,
  faRobot,
  faCog,
  faPlus,
  faStop,
  faCheck,
} from '~/lib/fontawesome';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  UserIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { AtomsClient } from '~/components/admin/design/AtomsClient';

export default function AtomsPage() {

  const designTokens = {
    colors: {
      semantic: [
        { name: 'Primary', class: 'bg-primary', desc: 'Main brand color, CTAs' },
        { name: 'Secondary', class: 'bg-secondary', desc: 'Supporting actions' },
        { name: 'Accent', class: 'bg-accent', desc: 'Highlights, notifications' },
        { name: 'Neutral', class: 'bg-neutral', desc: 'Text, borders' },
        { name: 'Base-100', class: 'bg-base-100', desc: 'Background surfaces' },
        { name: 'Base-200', class: 'bg-base-200', desc: 'Subtle backgrounds' },
        { name: 'Base-300', class: 'bg-base-300', desc: 'Borders, dividers' },
      ],
      feedback: [
        { name: 'Success', class: 'bg-success', desc: 'Positive feedback' },
        { name: 'Warning', class: 'bg-warning', desc: 'Caution, attention' },
        { name: 'Error', class: 'bg-error', desc: 'Errors, destructive' },
        { name: 'Info', class: 'bg-info', desc: 'Information, tips' },
      ],
    },
    spacing: [
      { name: 'xs', value: '0.25rem', class: 'p-1' },
      { name: 'sm', value: '0.5rem', class: 'p-2' },
      { name: 'md', value: '1rem', class: 'p-4' },
      { name: 'lg', value: '1.5rem', class: 'p-6' },
      { name: 'xl', value: '2rem', class: 'p-8' },
      { name: '2xl', value: '3rem', class: 'p-12' },
    ],
    typography: [
      { name: 'xs', class: 'text-xs', size: '0.75rem', usage: 'Captions, fine print' },
      { name: 'sm', class: 'text-sm', size: '0.875rem', usage: 'Small labels, secondary text' },
      { name: 'base', class: 'text-base', size: '1rem', usage: 'Body text, default' },
      { name: 'lg', class: 'text-lg', size: '1.125rem', usage: 'Large body text' },
      { name: 'xl', class: 'text-xl', size: '1.25rem', usage: 'Subheadings' },
      { name: '2xl', class: 'text-2xl', size: '1.5rem', usage: 'Section headers' },
      { name: '3xl', class: 'text-3xl', size: '1.875rem', usage: 'Page titles' },
    ],
    shadows: [
      { name: 'sm', class: 'shadow-sm', usage: 'Subtle elevation' },
      { name: 'md', class: 'shadow-md', usage: 'Cards, modals' },
      { name: 'lg', class: 'shadow-lg', usage: 'Floating elements' },
      { name: 'xl', class: 'shadow-xl', usage: 'Major elevation' },
    ],
    borderRadius: [
      { name: 'sm', class: 'rounded-sm', value: '0.125rem', usage: 'Buttons, inputs' },
      { name: 'md', class: 'rounded-md', value: '0.375rem', usage: 'Cards, containers' },
      { name: 'lg', class: 'rounded-lg', value: '0.5rem', usage: 'Large cards, modals' },
      { name: 'full', class: 'rounded-full', value: '9999px', usage: 'Avatars, pills' },
    ],
  };

  const buttonVariants = [
    { name: 'Primary', class: 'btn-primary', usage: 'Main actions' },
    { name: 'Secondary', class: 'btn-secondary', usage: 'Secondary actions' },
    { name: 'Accent', class: 'btn-accent', usage: 'Attention grabbing' },
    { name: 'Outline', class: 'btn-outline', usage: 'Subtle actions' },
    { name: 'Ghost', class: 'btn-ghost', usage: 'Minimal actions' },
    { name: 'Link', class: 'btn-link', usage: 'Text-like actions' },
  ];

  const buttonSizes = [
    { name: 'xs', class: 'btn-xs' },
    { name: 'sm', class: 'btn-sm' },
    { name: 'md', class: '' },
    { name: 'lg', class: 'btn-lg' },
  ];

  const inputTypes = [
    { name: 'Text', type: 'text', placeholder: 'Enter text...' },
    { name: 'Password', type: 'password', placeholder: 'Password' },
    { name: 'Email', type: 'email', placeholder: 'email@example.com' },
    { name: 'Search', type: 'search', placeholder: 'Search...' },
  ];

  const fontAwesomeIcons = [
    { iconName: 'faSearch', name: 'Search', usage: 'Search inputs, discovery' },
    { iconName: 'faTerminal', name: 'Terminal', usage: 'Code, CLI, technical' },
    { iconName: 'faTasks', name: 'Tasks', usage: 'Todo items, project management' },
    { iconName: 'faUser', name: 'User', usage: 'Human messages, profiles' },
    { iconName: 'faRobot', name: 'Robot', usage: 'AI messages, automation' },
    { iconName: 'faCog', name: 'Settings', usage: 'Configuration, preferences' },
    { iconName: 'faPlus', name: 'Plus', usage: 'Add, create, expand' },
    { iconName: 'faCheck', name: 'Check', usage: 'Complete, confirm, success' },
    { iconName: 'faStop', name: 'Stop', usage: 'Stop, cancel, end' },
  ];

  const heroIcons = [
    { iconName: 'ChevronDownIcon', name: 'Chevron Down', usage: 'Expanded states, dropdowns' },
    { iconName: 'ChevronRightIcon', name: 'Chevron Right', usage: 'Collapsed states, navigation' },
    { iconName: 'HomeIcon', name: 'Home', usage: 'Main navigation, dashboard' },
    { iconName: 'UserIcon', name: 'User', usage: 'Profile, account' },
    { iconName: 'CogIcon', name: 'Cog', usage: 'Settings, configuration' },
  ];

  // Atomic breakdown recommendations from analysis
  const atomicRecommendations = [
    {
      category: 'Input Atoms',
      description: 'Basic form elements extracted from complex components',
      atoms: [
        {
          name: 'ChatTextarea',
          source: 'EnhancedChatInput',
          usage: 'Auto-resize textarea with keyboard handling',
        },
        {
          name: 'VoiceButton',
          source: 'VoiceRecognitionUI',
          usage: 'Voice recording toggle with states',
        },
        {
          name: 'SendButton',
          source: 'EnhancedChatInput',
          usage: 'Submit/stop with loading states',
        },
        { name: 'FileAttachButton', source: 'FileAttachment', usage: 'File selection trigger' },
      ],
    },
    {
      category: 'Message Atoms',
      description: 'Elements extracted from TimelineMessage component',
      atoms: [
        {
          name: 'MessageAvatar',
          source: 'TimelineMessage',
          usage: 'Agent/user avatar with colors',
        },
        { name: 'MessageTimestamp', source: 'TimelineMessage', usage: 'Formatted time display' },
        { name: 'AgentBadge', source: 'TimelineMessage', usage: 'Agent name with semantic colors' },
        { name: 'ToolStatusBadge', source: 'TimelineMessage', usage: 'Tool execution status' },
      ],
    },
    {
      category: 'Navigation Atoms',
      description: 'Building blocks from Sidebar and navigation components',
      atoms: [
        { name: 'ToggleButton', source: 'Sidebar', usage: 'Expand/collapse trigger' },
        { name: 'SectionHeader', source: 'Sidebar', usage: 'Collapsible section title' },
        { name: 'ProjectBadge', source: 'Sidebar', usage: 'Project folder icon + name' },
        { name: 'QuickActionButton', source: 'Sidebar', usage: 'Icon buttons for tools' },
      ],
    },
    {
      category: 'Status Atoms',
      description: 'Consistent status and feedback indicators',
      atoms: [
        { name: 'PriorityBadge', source: 'TaskBoardModal', usage: 'Task priority indicator' },
        { name: 'ConfidenceMeter', source: 'VoiceRecognitionUI', usage: 'Recognition confidence' },
        { name: 'WaveformBar', source: 'VoiceRecognitionUI', usage: 'Audio visualization bar' },
        { name: 'DragOverlay', source: 'EnhancedChatInput', usage: 'Drag and drop feedback' },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Atoms</h1>
          <p className="text-base-content/70 mb-4">
            The fundamental building blocks of our design system. These are the smallest functional
            units that can't be broken down further without losing their meaning.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-primary rounded-full"></div>
            <span>Single responsibility • Highly reusable • No internal composition</span>
          </div>
        </div>

        <AtomsClient
          designTokens={designTokens}
          buttonVariants={buttonVariants}
          buttonSizes={buttonSizes}
          inputTypes={inputTypes}
          fontAwesomeIcons={fontAwesomeIcons}
          heroIcons={heroIcons}
          atomicRecommendations={atomicRecommendations}
        />


        {/* Usage Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Atom Usage Guidelines</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-success">✓ Do</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Use design tokens consistently across all components</li>
                <li>• Combine atoms to create more complex molecules</li>
                <li>• Follow semantic color usage (primary for CTAs, etc.)</li>
                <li>• Use appropriate icon libraries for different contexts</li>
                <li>• Maintain consistent spacing and typography scales</li>
                <li>• Extract reusable patterns from large components</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-error">✗ Don't</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Create custom colors outside the token system</li>
                <li>• Mix FontAwesome and Heroicons in the same context</li>
                <li>• Use arbitrary spacing values instead of the scale</li>
                <li>• Override atom styles in higher-level components</li>
                <li>• Create atoms that contain other atoms</li>
                <li>• Leave large components unatomized (300+ lines)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

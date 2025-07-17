// ABOUTME: Dynamic component registry that automatically discovers components and stories
// ABOUTME: Uses filesystem scanning to eliminate need for manual updates

// Browser-compatible component registry - uses static data generated at build time

export interface ComponentInfo {
  name: string;
  description: string;
  hasStory: boolean;
  hasComponent: boolean;
  category: 'atoms' | 'molecules' | 'organisms' | 'templates' | 'pages';
  subcategory?: string;
  storyPath?: string;
  componentPath?: string;
  filePath?: string;
}

export interface ComponentStats {
  total: number;
  withStories: number;
  withoutStories: number;
  completionPercentage: number;
}

// Component descriptions (keep these as they provide meaningful context)
const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  // Atoms
  'AgentBadge': 'Status indicators for AI agents',
  'Avatar': 'User/agent profile pictures',
  'Badge': 'Status and label badges',
  'ChatTextarea': 'Multi-line text input with drag-and-drop',
  'ExpandableHeader': 'Collapsible section headers with actions',
  'FileAttachButton': 'File attachment button with type restrictions',
  'IconButton': 'Clickable icon buttons with tooltips',
  'InlineCode': 'Inline code snippets with syntax highlighting',
  'LoadingDots': 'Animated loading indicators',
  'LoadingSkeleton': 'Loading skeleton placeholders with multiple variants',
  'MessageText': 'Rich text with code parsing capabilities',
  'NavigationButton': 'Navigation-specific icon buttons with variants',
  'SectionHeader': 'Section headers with badges and state',
  'SendButton': 'Message sending button with state management',
  'StatusDot': 'Connection status indicators',
  'TimestampDisplay': 'Time formatting component',
  'VoiceButton': 'Voice input controls with animations',
  
  // Molecules
  'ChatInputComposer': 'Complete chat input with voice and file support',
  'MessageBubble': 'Chat message containers with avatars and actions',
  'MessageDisplay': 'Complete message rendering with layout',
  'MessageHeader': 'Message headers with agent info and timestamps',
  'NavigationItem': 'Complete navigation list items with icons',
  'Modal': 'Modal component with variants and backdrop',
  'CodeBlock': 'Advanced code block with syntax highlighting',
  'FileAttachment': 'File attachment display with preview',
  'SidebarSection': 'Sidebar section component with collapsible content',
  'AnimatedModal': 'Animated modal component with transitions',
  'SwipeableCard': 'Swipeable card component with gesture support',
  'VoiceRecognitionUI': 'Voice recognition interface with visual feedback',
  'DragDropOverlay': 'Drag and drop overlay with visual feedback',
  'SkeletonLoader': 'Generic skeleton loader with multiple variants',
  'AccountDropdown': 'User account dropdown menu with usage stats',
  'ThemeSelector': 'Theme selection component with visual previews',
  'AnimatedButton': 'Animated button component with comprehensive interactions',
  'StreamingIndicator': 'Streaming status indicator with agent identification',
  
  // Organisms
  'Sidebar': 'Full navigation sidebar with project and timeline management',
  'TimelineMessage': 'Timeline entries for different message types',
  'TypingIndicator': 'Animated typing indicators for chat',
  'ChatHeader': 'Chat header component with branding',
  'EnhancedChatInput': 'Enhanced chat input with advanced features',
  'GoogleDocChatMessage': 'Google Doc style chat message',
  'FileDiffViewer': 'File diff viewer component with syntax highlighting',
  'TimelineView': 'Conversation timeline display with real-time streaming',
  'TaskBoardModal': 'Kanban-style task management modal',
  'MobileSidebar': 'Mobile-optimized navigation sidebar',
  'IntegrationEntry': 'Integration entry component for timeline',
  'Carousel': 'Generic carousel component',
  'CarouselCodeChanges': 'Code changes carousel component',
  'AnimatedCarousel': 'Animated carousel component',
  'AnimatedTimelineMessage': 'Animated timeline message component',
  'AnimatedTimelineView': 'Animated timeline view component',
  'AnimatedTypingIndicator': 'Animated typing indicator component',
  'FeedbackDisplay': 'Feedback display component',
  'FeedbackEventCard': 'Feedback event card component',
  'FeedbackInsightCard': 'Feedback insight card component',
  'FeedbackMiniDisplay': 'Mini feedback display component',
  'PerformancePanel': 'Performance monitoring panel',
  'PredictivePanel': 'Predictive analytics panel',
  
  // Templates
  'EnhancedInstructionsEditor': 'Enhanced instructions editor template',
  'InstructionsEditor': 'Instructions editor template',
  'InstructionsManager': 'Instructions manager template',
  'ProjectInstructionsEditor': 'Project instructions editor template',
  'UserInstructionsEditor': 'User instructions editor template',
  'SearchReplace': 'Search and replace functionality template',
  'AtomsClient': 'Atoms design system client template',
  'ComponentsClient': 'Components design system client template',
  'MissingClient': 'Missing components client template',
  'OrganismsClient': 'Organisms design system client template',
  
  // Pages
  'LaceApp': 'Main application page with complete interface',
  'ChatInterface': 'Chat interface page wrapper',
  'AnimatedLaceApp': 'Animated version of main application',
};

// Subcategory mappings based on component purpose
const SUBCATEGORY_MAPPINGS: Record<string, string> = {
  // Atoms
  'AgentBadge': 'Interactive',
  'Avatar': 'Content',
  'Badge': 'Content',
  'ChatTextarea': 'Input',
  'ExpandableHeader': 'Interactive',
  'FileAttachButton': 'Interactive',
  'IconButton': 'Interactive',
  'InlineCode': 'Content',
  'LoadingDots': 'Feedback',
  'LoadingSkeleton': 'Feedback',
  'MessageText': 'Content',
  'NavigationButton': 'Interactive',
  'SectionHeader': 'Interactive',
  'SendButton': 'Interactive',
  'StatusDot': 'Content',
  'TimestampDisplay': 'Content',
  'VoiceButton': 'Interactive',
  
  // Molecules
  'ChatInputComposer': 'Input',
  'MessageBubble': 'Message',
  'MessageDisplay': 'Message',
  'MessageHeader': 'Message',
  'NavigationItem': 'Navigation',
  'Modal': 'Layout',
  'CodeBlock': 'Content',
  'FileAttachment': 'Content',
  'SidebarSection': 'Layout',
  'AnimatedModal': 'Layout',
  'SwipeableCard': 'Interactive',
  'VoiceRecognitionUI': 'Input',
  'DragDropOverlay': 'Interactive',
  'SkeletonLoader': 'Feedback',
  'AccountDropdown': 'Navigation',
  'ThemeSelector': 'Control',
  'AnimatedButton': 'Interactive',
  'StreamingIndicator': 'Feedback',
  
  // Organisms
  'Sidebar': 'Layout',
  'TimelineMessage': 'Content',
  'TypingIndicator': 'Feedback',
  'ChatHeader': 'Layout',
  'EnhancedChatInput': 'Input',
  'GoogleDocChatMessage': 'Message',
  'FileDiffViewer': 'Content',
  'TimelineView': 'Content',
  'TaskBoardModal': 'Task Management',
  'MobileSidebar': 'Layout',
  'IntegrationEntry': 'Content',
  'Carousel': 'Interactive',
  'CarouselCodeChanges': 'Content',
  'AnimatedCarousel': 'Interactive',
  'AnimatedTimelineMessage': 'Content',
  'AnimatedTimelineView': 'Content',
  'AnimatedTypingIndicator': 'Feedback',
  'FeedbackDisplay': 'Analytics',
  'FeedbackEventCard': 'Analytics',
  'FeedbackInsightCard': 'Analytics',
  'FeedbackMiniDisplay': 'Analytics',
  'PerformancePanel': 'Analytics',
  'PredictivePanel': 'Analytics',
  
  // Templates
  'EnhancedInstructionsEditor': 'Admin',
  'InstructionsEditor': 'Admin',
  'InstructionsManager': 'Admin',
  'ProjectInstructionsEditor': 'Admin',
  'UserInstructionsEditor': 'Admin',
  'SearchReplace': 'Admin',
  'AtomsClient': 'Design System',
  'ComponentsClient': 'Design System',
  'MissingClient': 'Design System',
  'OrganismsClient': 'Design System',
  
  // Pages
  'LaceApp': 'Application',
  'ChatInterface': 'Application',
  'AnimatedLaceApp': 'Application',
};

// Domain to category mappings based on our new structure
const DOMAIN_CATEGORY_MAPPINGS: Record<string, ComponentInfo['category']> = {
  'ui': 'atoms', // Default to atoms for ui, but we'll override for specific components
  'pages': 'pages',
  'admin': 'templates',
  'chat': 'organisms',
  'timeline': 'organisms',
  'layout': 'organisms',
  'modals': 'organisms',
  'feedback': 'organisms',
  'files': 'organisms',
  'organisms': 'organisms',
  'demo': 'templates', // Demo components are template-like
};

// UI components that are actually molecules (not atoms)
const UI_MOLECULES = new Set([
  'ChatInputComposer',
  'MessageBubble',
  'MessageDisplay',
  'MessageHeader',
  'NavigationItem',
  'Modal',
  'CodeBlock',
  'FileAttachment',
  'SidebarSection',
  'AnimatedModal',
  'SwipeableCard',
  'VoiceRecognitionUI',
  'DragDropOverlay',
  'SkeletonLoader',
  'AccountDropdown',
  'ThemeSelector',
  'AnimatedButton',
  'StreamingIndicator',
]);

// Static component registry - manually maintained but comprehensive
// This ensures browser compatibility while maintaining all functionality
const STATIC_COMPONENT_REGISTRY: ComponentInfo[] = [
  // ATOMS - UI Components
  { name: 'AgentBadge', description: 'Status indicators for AI agents', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'Avatar', description: 'User/agent profile pictures', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'Badge', description: 'Status and label badges', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'ChatTextarea', description: 'Multi-line text input with drag-and-drop', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Input' },
  { name: 'ExpandableHeader', description: 'Collapsible section headers with actions', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'FileAttachButton', description: 'File attachment button with type restrictions', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'IconButton', description: 'Clickable icon buttons with tooltips', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'InlineCode', description: 'Inline code snippets with syntax highlighting', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'LoadingDots', description: 'Animated loading indicators', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Feedback' },
  { name: 'LoadingSkeleton', description: 'Loading skeleton placeholders with multiple variants', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Feedback' },
  { name: 'MessageText', description: 'Rich text with code parsing capabilities', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'NavigationButton', description: 'Navigation-specific icon buttons with variants', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'SectionHeader', description: 'Section headers with badges and state', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'SendButton', description: 'Message sending button with state management', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  { name: 'StatusDot', description: 'Connection status indicators', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'TimestampDisplay', description: 'Time formatting component', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Content' },
  { name: 'VoiceButton', description: 'Voice input controls with animations', hasStory: true, hasComponent: true, category: 'atoms', subcategory: 'Interactive' },
  
  // MOLECULES - UI Components
  { name: 'ChatInputComposer', description: 'Complete chat input with voice and file support', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Input' },
  { name: 'MessageBubble', description: 'Chat message containers with avatars and actions', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Message' },
  { name: 'MessageDisplay', description: 'Complete message rendering with layout', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Message' },
  { name: 'MessageHeader', description: 'Message headers with agent info and timestamps', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Message' },
  { name: 'NavigationItem', description: 'Complete navigation list items with icons', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Navigation' },
  { name: 'Modal', description: 'Modal component with variants and backdrop', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Layout' },
  { name: 'CodeBlock', description: 'Advanced code block with syntax highlighting', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Content' },
  { name: 'FileAttachment', description: 'File attachment display with preview', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Content' },
  { name: 'SidebarSection', description: 'Sidebar section component with collapsible content', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Layout' },
  { name: 'AnimatedModal', description: 'Animated modal component with transitions', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Layout' },
  { name: 'SwipeableCard', description: 'Swipeable card component with gesture support', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Interactive' },
  { name: 'VoiceRecognitionUI', description: 'Voice recognition interface with visual feedback', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Input' },
  { name: 'DragDropOverlay', description: 'Drag and drop overlay with visual feedback', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Interactive' },
  { name: 'SkeletonLoader', description: 'Generic skeleton loader with multiple variants', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Feedback' },
  { name: 'AccountDropdown', description: 'User account dropdown menu with usage stats', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Navigation' },
  { name: 'ThemeSelector', description: 'Theme selection component with visual previews', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Control' },
  { name: 'AnimatedButton', description: 'Animated button component with comprehensive interactions', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Interactive' },
  { name: 'StreamingIndicator', description: 'Streaming status indicator with agent identification', hasStory: true, hasComponent: true, category: 'molecules', subcategory: 'Feedback' },
  
  // ORGANISMS - Layout Components
  { name: 'Sidebar', description: 'Full navigation sidebar with project and timeline management', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Layout' },
  { name: 'MobileSidebar', description: 'Mobile-optimized navigation sidebar', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Layout' },
  
  // ORGANISMS - Timeline Components
  { name: 'TimelineMessage', description: 'Timeline entries for different message types', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  { name: 'TypingIndicator', description: 'Animated typing indicators for chat', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Feedback' },
  { name: 'TimelineView', description: 'Conversation timeline display with real-time streaming', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  { name: 'AnimatedTimelineMessage', description: 'Animated timeline message component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  { name: 'AnimatedTimelineView', description: 'Animated timeline view component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  { name: 'AnimatedTypingIndicator', description: 'Animated typing indicator component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Feedback' },
  { name: 'IntegrationEntry', description: 'Integration entry component for timeline', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  
  // ORGANISMS - Chat Components
  { name: 'EnhancedChatInput', description: 'Enhanced chat input with advanced features', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Input' },
  { name: 'GoogleDocChatMessage', description: 'Google Doc style chat message', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Message' },
  
  // ORGANISMS - File Components
  { name: 'FileDiffViewer', description: 'File diff viewer component with syntax highlighting', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  { name: 'CarouselCodeChanges', description: 'Code changes carousel component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Content' },
  
  // ORGANISMS - Modal Components
  { name: 'TaskBoardModal', description: 'Kanban-style task management modal', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Task Management' },
  
  // ORGANISMS - UI Components
  { name: 'Carousel', description: 'Generic carousel component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Interactive' },
  { name: 'AnimatedCarousel', description: 'Animated carousel component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Interactive' },
  
  // ORGANISMS - Feedback Components
  { name: 'FeedbackDisplay', description: 'Feedback display component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  { name: 'FeedbackEventCard', description: 'Feedback event card component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  { name: 'FeedbackInsightCard', description: 'Feedback insight card component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  { name: 'FeedbackMiniDisplay', description: 'Mini feedback display component', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  { name: 'PerformancePanel', description: 'Performance monitoring panel', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  { name: 'PredictivePanel', description: 'Predictive analytics panel', hasStory: true, hasComponent: true, category: 'organisms', subcategory: 'Analytics' },
  
  // TEMPLATES - Admin Components
  { name: 'EnhancedInstructionsEditor', description: 'Enhanced instructions editor template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  { name: 'InstructionsEditor', description: 'Instructions editor template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  { name: 'InstructionsManager', description: 'Instructions manager template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  { name: 'ProjectInstructionsEditor', description: 'Project instructions editor template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  { name: 'UserInstructionsEditor', description: 'User instructions editor template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  { name: 'SearchReplace', description: 'Search and replace functionality template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Admin' },
  
  // TEMPLATES - Design System Components
  { name: 'AtomsClient', description: 'Atoms design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'ComponentsClient', description: 'Components design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'MissingClient', description: 'Missing components client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'OrganismsClient', description: 'Organisms design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'MoleculesClient', description: 'Molecules design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'PagesClient', description: 'Pages design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'TemplatesClient', description: 'Templates design system client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  { name: 'DesignSystemClient', description: 'Design system overview client template', hasStory: false, hasComponent: true, category: 'templates', subcategory: 'Design System' },
  
  // PAGES - Application Pages
  { name: 'LaceApp', description: 'Main application page with complete interface', hasStory: true, hasComponent: true, category: 'pages', subcategory: 'Application' },
  { name: 'ChatInterface', description: 'Chat interface page wrapper', hasStory: true, hasComponent: true, category: 'pages', subcategory: 'Application' },
  { name: 'AnimatedLaceApp', description: 'Animated version of main application', hasStory: true, hasComponent: true, category: 'pages', subcategory: 'Application' },
];

// Export static component registry
export const COMPONENT_REGISTRY: ComponentInfo[] = STATIC_COMPONENT_REGISTRY.sort((a, b) => {
  const categoryOrder = ['atoms', 'molecules', 'organisms', 'templates', 'pages'];
  const aCategoryIndex = categoryOrder.indexOf(a.category);
  const bCategoryIndex = categoryOrder.indexOf(b.category);
  
  if (aCategoryIndex !== bCategoryIndex) {
    return aCategoryIndex - bCategoryIndex;
  }
  
  return a.name.localeCompare(b.name);
});

// Function to refresh the registry (now just returns the static registry)
export function refreshComponentRegistry(): ComponentInfo[] {
  return COMPONENT_REGISTRY;
}

// Helper functions
export function getComponentsByCategory(category: ComponentInfo['category']): ComponentInfo[] {
  return COMPONENT_REGISTRY.filter(c => c.category === category);
}

export function getComponentStats(category: ComponentInfo['category']): ComponentStats {
  const components = getComponentsByCategory(category);
  const total = components.length;
  const withStories = components.filter(c => c.hasStory).length;
  const withoutStories = total - withStories;
  const completionPercentage = total > 0 ? Math.round((withStories / total) * 100) : 0;
  
  return { total, withStories, withoutStories, completionPercentage };
}

export function getOverallStats(): ComponentStats {
  const total = COMPONENT_REGISTRY.length;
  const withStories = COMPONENT_REGISTRY.filter(c => c.hasStory).length;
  const withoutStories = total - withStories;
  const completionPercentage = total > 0 ? Math.round((withStories / total) * 100) : 0;
  
  return { total, withStories, withoutStories, completionPercentage };
}

export function generateStoryLink(componentName: string, category: string): string {
  return `?path=/docs/${category}-${componentName.toLowerCase()}--docs`;
}

export function getStatusIndicator(completionPercentage: number): { emoji: string; text: string; color: string } {
  if (completionPercentage === 100) {
    return { emoji: '✅', text: 'Complete', color: 'green' };
  } else if (completionPercentage >= 50) {
    return { emoji: '🔄', text: 'In Progress', color: 'yellow' };
  } else {
    return { emoji: '📋', text: 'Planned', color: 'gray' };
  }
}

export function getComponentsBySubcategory(category: ComponentInfo['category'], subcategory: string): ComponentInfo[] {
  return COMPONENT_REGISTRY.filter(c => c.category === category && c.subcategory === subcategory);
}

export function getSubcategories(category: ComponentInfo['category']): string[] {
  const subcategories = new Set(
    COMPONENT_REGISTRY
      .filter(c => c.category === category)
      .map(c => c.subcategory)
      .filter((subcategory): subcategory is string => Boolean(subcategory))
  );
  return Array.from(subcategories).sort();
}

// Additional utility functions for the dynamic registry
export function getComponentByName(name: string): ComponentInfo | undefined {
  return COMPONENT_REGISTRY.find(c => c.name === name);
}

export function getComponentsWithoutStories(): ComponentInfo[] {
  return COMPONENT_REGISTRY.filter(c => !c.hasStory);
}

export function getComponentsByDomain(domain: string): ComponentInfo[] {
  // Since we don't have file paths in the static registry, we'll approximate by subcategory
  const domainMappings: Record<string, string[]> = {
    ui: ['Interactive', 'Content', 'Input', 'Feedback', 'Message', 'Navigation', 'Layout', 'Control'],
    layout: ['Layout'],
    timeline: ['Content', 'Feedback'],
    chat: ['Input', 'Message'],
    files: ['Content'],
    modals: ['Task Management'],
    feedback: ['Analytics'],
    admin: ['Admin'],
    pages: ['Application'],
  };
  
  const relevantSubcategories = domainMappings[domain] || [];
  return COMPONENT_REGISTRY.filter(c => relevantSubcategories.includes(c.subcategory || ''));
}

export function getRegistryStats(): {
  totalComponents: number;
  totalWithStories: number;
  totalWithoutStories: number;
  overallCompletionPercentage: number;
  categoryCounts: Record<string, number>;
  domainCounts: Record<string, number>;
} {
  const stats = getOverallStats();
  
  const categoryCounts: Record<string, number> = {};
  const domainCounts: Record<string, number> = {
    ui: 0,
    layout: 0,
    timeline: 0,
    chat: 0,
    files: 0,
    modals: 0,
    feedback: 0,
    admin: 0,
    pages: 0,
  };
  
  COMPONENT_REGISTRY.forEach(component => {
    categoryCounts[component.category] = (categoryCounts[component.category] || 0) + 1;
    
    // Approximate domain counts based on subcategories
    const subcategory = component.subcategory || '';
    if (['Interactive', 'Content', 'Input', 'Feedback', 'Message', 'Navigation', 'Control'].includes(subcategory)) {
      domainCounts.ui++;
    } else if (subcategory === 'Layout') {
      domainCounts.layout++;
    } else if (subcategory === 'Task Management') {
      domainCounts.modals++;
    } else if (subcategory === 'Analytics') {
      domainCounts.feedback++;
    } else if (subcategory === 'Admin') {
      domainCounts.admin++;
    } else if (subcategory === 'Application') {
      domainCounts.pages++;
    }
  });
  
  return {
    totalComponents: stats.total,
    totalWithStories: stats.withStories,
    totalWithoutStories: stats.withoutStories,
    overallCompletionPercentage: stats.completionPercentage,
    categoryCounts,
    domainCounts,
  };
}
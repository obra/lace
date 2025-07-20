'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faSearch, faTerminal, faTasks, faFolder, faMicrophone } from '@/lib/fontawesome';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { TimelineView } from '@/components/timeline/TimelineView';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';
import { VoiceRecognitionUI } from '@/components/ui/VoiceRecognitionUI';
import { StreamingIndicator } from '@/components/ui/StreamingIndicator';
import { DragDropOverlay } from '@/components/ui/DragDropOverlay';
import { AttachedFile } from '@/components/ui/FileAttachment';
import { TimelineEntry, Project, Timeline, Task, RecentFile, StreamEvent } from '~/types';
import { useVoiceRecognition } from '~/hooks/useVoiceRecognition';
import { useConversationStream } from '~/hooks/useConversationStream';

const availableThemes = [
  { name: 'light', colors: { primary: '#570DF8', secondary: '#F000B8', accent: '#37CDBE' } },
  { name: 'dark', colors: { primary: '#661AE6', secondary: '#D926AA', accent: '#1FB2A5' } },
  { name: 'cupcake', colors: { primary: '#65C3C8', secondary: '#EF9FBC', accent: '#EEAF3A' } },
  { name: 'corporate', colors: { primary: '#4B6BFB', secondary: '#7C3AED', accent: '#37CDBE' } },
  { name: 'synthwave', colors: { primary: '#E779C1', secondary: '#58C7F3', accent: '#F7CC50' } },
  { name: 'cyberpunk', colors: { primary: '#FF7598', secondary: '#75D1F0', accent: '#C07F00' } },
];

export function LaceApp() {
  // UI State
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showVoiceUI, setShowVoiceUI] = useState(false);

  // Chat State
  const [prompt, setPrompt] = useState('');
  const [isToolRunning, setIsToolRunning] = useState(false);
  const nextEntryId = useRef(9);
  const [currentStreamingContent, setCurrentStreamingContent] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // Voice Recognition
  const {
    isListening,
    startListening,
    stopListening,
    transcript,
    interimTranscript,
    confidence,
    error,
  } = useVoiceRecognition({
    onResult: (transcript) => {
      setPrompt(transcript);
    },
  });

  // Conversation Stream
  const { isStreaming, isThinking, currentThreadId, sendMessage, interruptStream } =
    useConversationStream({
      onStreamEvent: (event: StreamEvent) => {
        if (event.type === 'token' && event.content) {
          setCurrentStreamingContent((prev) => prev + event.content);
        } else if (event.type === 'tool_call_start' && event.toolCall) {
          const toolEntry: TimelineEntry = {
            id: nextEntryId.current++,
            type: 'tool',
            tool: event.toolCall.name,
            content: `${event.toolCall.name} started`,
            timestamp: new Date(),
          };
          setTimelineEntries((prev) => [...prev, toolEntry]);
        } else if (event.type === 'tool_call_complete' && event.toolCall && event.result) {
          const toolResult = event.result.success ? 'completed successfully' : 'failed';
          const toolEntry: TimelineEntry = {
            id: nextEntryId.current++,
            type: 'tool',
            tool: event.toolCall.name,
            content: `${event.toolCall.name} ${toolResult}`,
            result: event.result.content,
            timestamp: new Date(),
          };
          setTimelineEntries((prev) => [...prev, toolEntry]);
        }
      },
      onMessageComplete: (content: string) => {
        const aiEntry: TimelineEntry = {
          id: nextEntryId.current++,
          type: 'ai',
          content: content.trim(),
          agent: currentTimeline.agent,
          timestamp: new Date(),
        };
        setTimelineEntries((prev) => [...prev, aiEntry]);
        setCurrentStreamingContent('');
      },
      onError: (error: string) => {
        console.error('Stream error:', error);
        setCurrentStreamingContent('');
      },
    });

  // Data State
  const [currentProject, setCurrentProject] = useState<Project>({
    id: 1,
    name: 'AI Research',
    path: '/projects/ai-research',
  });

  const [projects] = useState<Project[]>([
    { id: 1, name: 'AI Research', path: '/projects/ai-research' },
    { id: 2, name: 'Web App', path: '/projects/webapp' },
    { id: 3, name: 'Data Pipeline', path: '/projects/data-pipeline' },
  ]);

  const [currentTimeline, setCurrentTimeline] = useState<Timeline>({
    id: 1,
    name: 'Main Dev',
    agent: 'Claude',
  });

  const [timelines, setTimelines] = useState<Timeline[]>([
    { id: 2, name: 'Code Review', agent: 'Claude' },
    { id: 3, name: 'Research', agent: 'Gemini' },
    { id: 4, name: 'Testing', agent: 'Claude' },
    { id: 5, name: 'Data Analysis', agent: 'GPT-4' },
    { id: 6, name: 'Tennis Commentary Demo', agent: 'Claude' },
    { id: 7, name: 'Design System Demo', agent: 'Claude' },
  ]);

  const [recentFiles] = useState<RecentFile[]>([
    { name: 'app.py', path: '/src/app.py' },
    { name: 'config.yaml', path: '/config/config.yaml' },
    { name: 'README.md', path: '/README.md' },
    { name: 'test_models.py', path: '/tests/test_models.py' },
  ]);

  const [activeTasks] = useState<Task[]>([
    {
      id: 1,
      title: 'AI Model Integration',
      description: 'Integrate latest language model',
      priority: 'high',
      assignee: 'Claude',
      status: 'in_progress',
    },
    {
      id: 2,
      title: 'Auth Bug Fix',
      description: 'Fix login timeout',
      priority: 'medium',
      assignee: 'Human',
      status: 'pending',
    },
    {
      id: 3,
      title: 'Update Docs',
      description: 'API documentation',
      priority: 'low',
      assignee: 'Claude',
      status: 'review',
    },
  ]);

  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([
    {
      id: 1,
      type: 'admin',
      content: 'Timeline started',
      timestamp: new Date(Date.now() - 3600000),
    },
    {
      id: 2,
      type: 'human',
      content: 'Can you help me create a React component with TypeScript that uses our new syntax highlighting system?',
      timestamp: new Date(Date.now() - 1800000),
    },
    {
      id: 3,
      type: 'ai',
      content: "I'll help you create a React component with TypeScript that demonstrates our syntax highlighting capabilities. Here's a complete example:\n\n```typescript\nimport React, { useState, useEffect } from 'react';\nimport { syntaxHighlighting } from '@/lib/syntax-highlighting';\n\ninterface CodeDisplayProps {\n  code: string;\n  language?: string;\n  fileName?: string;\n  showLineNumbers?: boolean;\n}\n\nexport const CodeDisplay: React.FC<CodeDisplayProps> = ({\n  code,\n  language = 'javascript',\n  fileName,\n  showLineNumbers = true\n}) => {\n  const [highlighted, setHighlighted] = useState<string>('');\n  const [isLoading, setIsLoading] = useState(true);\n\n  useEffect(() => {\n    const highlightCode = async () => {\n      try {\n        const result = await syntaxHighlighting.highlightCode(\n          code,\n          language,\n          fileName\n        );\n        setHighlighted(result.highlighted);\n      } catch (error) {\n        console.error('Syntax highlighting failed:', error);\n        setHighlighted(code); // Fallback to plain text\n      } finally {\n        setIsLoading(false);\n      }\n    };\n\n    highlightCode();\n  }, [code, language, fileName]);\n\n  if (isLoading) {\n    return <div className=\"animate-pulse\">Loading...</div>;\n  }\n\n  return (\n    <div className=\"bg-base-300 rounded-lg p-4 font-mono\">\n      {fileName && (\n        <div className=\"text-sm text-base-content/60 mb-2\">\n          {fileName}\n        </div>\n      )}\n      <pre\n        className=\"text-sm overflow-x-auto\"\n        dangerouslySetInnerHTML={{ __html: highlighted }}\n      />\n    </div>\n  );\n};\n```\n\nThis component uses our new syntax highlighting system with these features:\n\n- **Language Detection**: Automatically detects the language if not specified\n- **File Name Support**: Can use the filename for better language detection\n- **Async Highlighting**: Uses the `syntaxHighlighting` service asynchronously\n- **Error Handling**: Falls back to plain text if highlighting fails\n- **Loading States**: Shows a loading indicator while processing\n- **Responsive Design**: Uses Tailwind classes for consistent styling\n\nYou can also use inline code like `const result = await api.getData()` which will be highlighted appropriately.",
      agent: 'Claude',
      timestamp: new Date(Date.now() - 1790000),
    },
    {
      id: 4,
      type: 'integration',
      tool: 'Google Drive',
      action: 'created',
      title: 'Analysis Report.docx',
      description: 'Code analysis report generated',
      link: 'https://drive.google.com/file/d/example',
      timestamp: new Date(Date.now() - 1780000),
    },
    {
      id: 5,
      type: 'carousel',
      title: 'Recent Code Changes',
      timestamp: new Date(Date.now() - 1700000),
      items: [
        {
          title: 'Authentication Module',
          description: 'Added OAuth2 integration with Google and GitHub',
          type: 'feature' as const,
          impact: 'high' as const,
          files: ['src/auth/oauth.ts', 'src/auth/providers.ts'],
          commit: 'a1b2c3d',
        },
        {
          title: 'Database Migration',
          description: 'Updated user schema to support OAuth tokens',
          type: 'maintenance' as const,
          impact: 'medium' as const,
          files: ['migrations/001_oauth_tokens.sql', 'src/models/user.ts'],
          commit: 'e4f5g6h',
        },
        {
          title: 'Login Bug Fix',
          description: 'Fixed session timeout issue in production',
          type: 'bugfix' as const,
          impact: 'high' as const,
          files: ['src/auth/session.ts'],
          commit: 'i7j8k9l',
        },
      ],
    },
    {
      id: 6,
      type: 'integration',
      tool: 'Slack',
      action: 'updated',
      title: 'Development Team',
      description: 'Code review completed, changes deployed',
      timestamp: new Date(Date.now() - 900000),
    },
  ]);

  useEffect(() => {
    // Set theme on mount
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Handlers
  const handleSendMessage = useCallback(async () => {
    if (!prompt.trim()) return;

    // If currently streaming, interrupt first
    if (isStreaming) {
      interruptStream();
      // Small delay to ensure the interrupt is processed
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const humanEntry: TimelineEntry = {
      id: nextEntryId.current++,
      type: 'human',
      content: prompt.trim(),
      timestamp: new Date(),
    };

    setTimelineEntries((prev) => [...prev, humanEntry]);
    const userPrompt = prompt;
    // const messageFiles = [...attachedFiles]; // Capture current files
    setPrompt('');
    setAttachedFiles([]); // Clear attachments after sending

    // Reset streaming content for new message
    setCurrentStreamingContent('');

    // Send to real API
    try {
      await sendMessage(userPrompt, currentThreadId);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Add error message to timeline
      const errorEntry: TimelineEntry = {
        id: nextEntryId.current++,
        type: 'admin',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        timestamp: new Date(),
      };
      setTimelineEntries((prev) => [...prev, errorEntry]);
    }
  }, [prompt, isStreaming, interruptStream, sendMessage, currentThreadId]);

  const handleProjectChange = (project: Project) => {
    setCurrentProject(project);
    setShowMobileNav(false);
  };

  const handleTimelineChange = (timeline: Timeline) => {
    setCurrentTimeline(timeline);
    setShowMobileNav(false);
    
    // Show tennis commentary demo when that timeline is selected
    if (timeline.id === 6) {
      setTimelineEntries([
        {
          id: 1,
          type: 'admin',
          content: 'Tennis Commentary Demo Timeline - Experience the contextual feedback system in action!',
          timestamp: new Date(Date.now() - 1800000),
        },
        {
          id: 2,
          type: 'human',
          content: 'Show me how the tennis commentary system works with our contextual feedback',
          timestamp: new Date(Date.now() - 1600000),
        },
        {
          id: 3,
          type: 'ai',
          content: `Here's how our tennis commentary system provides engaging feedback during development sessions:

## 🎾 Tennis Commentary Features

The contextual feedback system provides **tennis-style commentary** on development activities:

### Tool Execution Commentary
When tools are executed, you'll see commentary like:
- *"A powerful file-read execution is underway - precision is key here!"*
- *"Excellent execution! The bash tool delivered exactly what was needed."*
- *"Watch this syntax-highlighting execution - timing and accuracy are everything."*

### Turn-Based Commentary
For conversation turns:
- *"A new turn begins - the agent is ready to tackle the next challenge!"*
- *"What a magnificent turn! The agent has delivered exceptional results."*
- *"Fresh turn, fresh possibilities - let's see what strategic moves unfold."*

### Error Handling Commentary
When errors occur:
- *"A minor setback, but watch how the agent adapts and recovers gracefully."*
- *"Every champion faces challenges - it's the recovery that defines greatness."*
- *"An unexpected twist! Let's see how the agent handles this curveball."*

### Performance Insights
The system tracks:
- **Response times** and performance trends
- **Tool usage patterns** and efficiency
- **Error patterns** and recovery strategies
- **Token usage** and context optimization

## 🎯 How to Enable Tennis Commentary

To enable tennis commentary in your development session:

\`\`\`typescript
import { FeedbackFactory } from '~/feedback/feedback-factory';

// Create with tennis commentary preset
const feedback = FeedbackFactory.createWithPreset(
  'tennis-commentary',
  { threadId: 'your-thread-id' }
);

// Or enable in existing config
const config = {
  enableTennisBanter: true,
  verbosity: 'commentary',
  timing: 'immediate'
};
\`\`\`

This creates an engaging, sports-commentary-style experience that makes development sessions more fun and informative!`,
          agent: 'Claude',
          timestamp: new Date(Date.now() - 1500000),
        },
        {
          id: 4,
          type: 'admin',
          content: '🎾 Tennis Commentary: "And here we see the agent entering deep thought mode - the mental preparation phase! Notice the contemplative pause - this is where the magic happens in AI reasoning."',
          timestamp: new Date(Date.now() - 1400000),
        },
        {
          id: 5,
          type: 'human',
          content: 'That\'s awesome! Can you show me a code example of how the diff viewer works?',
          timestamp: new Date(Date.now() - 1200000),
        },
        {
          id: 6,
          type: 'ai',
          content: `Absolutely! Here's how our FileDiffViewer component works with syntax highlighting:

\`\`\`typescript
import React from 'react';
import { FileDiffViewer } from '@/components/files/FileDiffViewer';

// Example usage showing before/after code changes
const ExampleDiffUsage = () => {
  const oldCode = \`function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}\`;

  const newCode = \`function calculateTotal(items: Item[]): number {
  return items.reduce((total, item) => total + item.price, 0);
}\`;

  return (
    <FileDiffViewer
      oldContent={oldCode}
      newContent={newCode}
      oldTitle="Original Implementation"
      newTitle="Refactored Implementation"
      language="typescript"
      viewMode="side-by-side"
      showLineNumbers={true}
      highlightChanges={true}
    />
  );
};
\`\`\`

The diff viewer features:
- **Side-by-side** and **unified** view modes
- **Syntax highlighting** with 30+ language support
- **Line numbers** and **change highlighting**
- **Responsive design** that works on all screen sizes
- **Performance optimized** with caching and lazy loading

Try it out by selecting different timelines or creating file changes!`,
          agent: 'Claude',
          timestamp: new Date(Date.now() - 1100000),
        },
        {
          id: 7,
          type: 'admin',
          content: '🎾 Tennis Commentary: "Beautiful work! The FileDiffViewer operation was executed with precision. That\'s a clean completion - the component performed flawlessly with syntax highlighting and responsive design working in perfect harmony!"',
          timestamp: new Date(Date.now() - 1000000),
        },
      ]);
    }
    
    // Show design system demo when that timeline is selected
    if (timeline.id === 7) {
      setTimelineEntries([
        {
          id: 1,
          type: 'admin',
          content: 'Design System Demo Timeline - Explore the atomic design system components!',
          timestamp: new Date(Date.now() - 1800000),
        },
        {
          id: 2,
          type: 'human',
          content: 'Show me the design system components we\'ve built',
          timestamp: new Date(Date.now() - 1600000),
        },
        {
          id: 3,
          type: 'ai',
          content: `Here's our comprehensive atomic design system built with React, TypeScript, and Tailwind CSS:

## 🎨 Design System Components

### Atoms (Basic Building Blocks)
- **AgentBadge**: Displays agent status with color coding
- **Badge**: Flexible status and category indicators
- **StatusDot**: Visual status indicators
- **IconButton**: Consistent icon-based buttons
- **SendButton**: Specialized send/submit actions
- **VoiceButton**: Voice input controls

### Molecules (Component Groups)
- **ChatInputComposer**: Advanced text input with features
- **ChatTextarea**: Multi-line text input
- **FileAttachButton**: File attachment handling
- **MessageBubble**: Chat message containers
- **MessageDisplay**: Message content rendering
- **MessageHeader**: Message metadata display
- **MessageText**: Text processing with syntax highlighting
- **TimestampDisplay**: Consistent time formatting

### Organisms (Complex Components)
- **FileDiffViewer**: Side-by-side code comparison
- **InstructionsEditor**: Rich text editing interface
- **UserInstructionsEditor**: User preference management
- **SidebarSection**: Navigation and organization
- **NavigationButton**: Complex navigation controls
- **NavigationItem**: Structured navigation elements

### Templates & Pages
- **Design System Admin**: Component showcase and documentation
- **Instructions Management**: User and project instructions
- **Feedback System**: Tennis commentary and insights

## 🔧 Key Features

### Syntax Highlighting System
\`\`\`typescript
// 30+ programming languages supported
const languages = [
  'javascript', 'typescript', 'python', 'java', 'cpp',
  'rust', 'go', 'php', 'ruby', 'swift', 'kotlin',
  'html', 'css', 'scss', 'json', 'yaml', 'xml',
  'bash', 'powershell', 'sql', 'dockerfile', 'markdown'
];

// Automatic language detection
const result = await syntaxHighlighting.highlightCode(code, 'auto', 'app.tsx');
\`\`\`

### Monospace Typography
- Applied to code blocks, inline code, and terminal interfaces
- Font stack: ui-monospace, JetBrains Mono, Fira Code, SF Mono
- Consistent sizing and spacing across all code contexts

### Responsive Design
- Mobile-first approach with Tailwind CSS
- Adaptive layouts for different screen sizes
- Touch-friendly interactions on mobile devices

Visit \`/admin/design\` to explore the full design system showcase!`,
          agent: 'Claude',
          timestamp: new Date(Date.now() - 1500000),
        },
        {
          id: 4,
          type: 'admin',
          content: '🎾 Tennis Commentary: "What a magnificent demonstration! The design system components are working in perfect harmony - atoms, molecules, and organisms all performing flawlessly together!"',
          timestamp: new Date(Date.now() - 1400000),
        },
        {
          id: 5,
          type: 'human',
          content: 'Can you show me how to access the admin design system?',
          timestamp: new Date(Date.now() - 1200000),
        },
        {
          id: 6,
          type: 'ai',
          content: `You can access the design system admin interface at:

**URL**: \`http://localhost:3001/admin/design\`

The admin interface includes:

### 📱 Component Categories
- **Atoms**: Basic building blocks like badges, buttons, and status indicators
- **Molecules**: Component groups like chat inputs and message displays  
- **Organisms**: Complex components like diff viewers and editors
- **Templates**: Page-level layouts and structures
- **Pages**: Complete page implementations

### 🎯 Interactive Features
- **Live component previews** with real code examples
- **Props documentation** for each component
- **Usage examples** showing best practices
- **Responsive testing** across different screen sizes

### 🔍 Component Analysis
- **Missing components** identified for future development
- **Component mapping** showing relationships
- **Atomic design principles** documentation
- **Reorganization plans** for optimization

The design system follows atomic design methodology and provides a consistent, scalable foundation for the entire application.

Try visiting \`/admin/design\` to explore all the components we've built!`,
          agent: 'Claude',
          timestamp: new Date(Date.now() - 1100000),
        },
        {
          id: 7,
          type: 'admin',
          content: '🎾 Tennis Commentary: "Excellent navigation guidance! The admin design system is perfectly accessible and well-organized. That\'s a clean completion - users can now explore the complete component library!"',
          timestamp: new Date(Date.now() - 1000000),
        },
      ]);
    }
  };

  const handleNewTimeline = () => {
    const newTimelineId = Math.max(...timelines.map((t) => t.id)) + 1;
    const newTimeline: Timeline = {
      id: newTimelineId,
      name: `Timeline ${newTimelineId}`,
      agent: 'Claude',
    };
    setTimelines((prev) => [...prev, newTimeline]);
    setCurrentTimeline(newTimeline);
    addSystemMessage(`New timeline created: ${newTimeline.name}`);
  };

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  };

  const handleTriggerTool = (toolName: string) => {
    setIsToolRunning(true);
    setShowQuickActions(false);
    setShowMobileNav(false);

    setTimeout(() => {
      const toolEntry: TimelineEntry = {
        id: nextEntryId.current++,
        type: 'tool',
        tool: toolName,
        content: `${toolName} executed`,
        result: `${toolName} completed successfully`,
        timestamp: new Date(),
      };

      setTimelineEntries((prev) => [...prev, toolEntry]);
      setIsToolRunning(false);
    }, 1500);
  };

  const addSystemMessage = (message: string) => {
    const adminEntry: TimelineEntry = {
      id: nextEntryId.current++,
      type: 'admin',
      content: message,
      timestamp: new Date(),
    };
    setTimelineEntries((prev) => [...prev, adminEntry]);
  };

  const handleOpenTask = (_task: Task) => {
    // Opening task
    setShowMobileNav(false);
  };

  const handleOpenFile = (file: RecentFile) => {
    // Opening file: file.path
    addSystemMessage(`Opened file: ${file.name}`);
  };

  const handleOpenTaskBoard = () => {
    setShowMobileNav(false);
    setShowTaskBoard(true);
  };

  const handleTaskUpdate = (updatedTask: Task) => {
    // In a real app, this would update the backend
    addSystemMessage(`Task "${updatedTask.title}" moved to ${updatedTask.status}`);
  };

  const handleTaskCreate = (newTask: Omit<Task, 'id'>) => {
    // In a real app, this would create in backend
    const task = { ...newTask, id: Date.now() };
    addSystemMessage(`New task created: "${task.title}"`);
  };

  // File attachment handlers
  const handleFilesAttached = (files: AttachedFile[]) => {
    setAttachedFiles((prev) => [...prev, ...files]);
    if (files.length === 1) {
      addSystemMessage(`File attached: ${files[0].name}`);
    } else {
      addSystemMessage(`${files.length} files attached`);
    }
  };

  const handleFileRemoved = (fileId: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file) {
        addSystemMessage(`File removed: ${file.name}`);
      }
      return prev.filter((f) => f.id !== fileId);
    });
  };

  const handleFileCleared = () => {
    const count = attachedFiles.length;
    setAttachedFiles([]);
    addSystemMessage(`${count} file${count === 1 ? '' : 's'} cleared`);
  };

  const handleFilesDropped = (files: FileList) => {
    const newFiles: AttachedFile[] = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    }));
    handleFilesAttached(newFiles);
  };

  const handleOpenFileManager = () => {
    setShowMobileNav(false);
    addSystemMessage('File Manager opened');
  };

  const handleOpenRulesFile = () => {
    addSystemMessage('Rules configuration opened');
  };

  return (
    <div className="flex h-screen bg-base-200 text-base-content font-sans overflow-hidden">
      {/* Mobile Sidebar */}
      <MobileSidebar
        isOpen={showMobileNav}
        onClose={() => setShowMobileNav(false)}
        currentProject={currentProject}
        projects={projects}
        currentTimeline={currentTimeline}
        timelines={timelines}
        activeTasks={activeTasks}
        currentTheme={currentTheme}
        availableThemes={availableThemes}
        onProjectChange={handleProjectChange}
        onTimelineChange={handleTimelineChange}
        onThemeChange={handleThemeChange}
        onTriggerTool={handleTriggerTool}
        onOpenTaskBoard={handleOpenTaskBoard}
        onOpenFileManager={handleOpenFileManager}
        onOpenTaskDetail={handleOpenTask}
      />

      {/* Desktop Sidebar */}
      <Sidebar
        isOpen={showDesktopSidebar}
        onToggle={() => setShowDesktopSidebar(!showDesktopSidebar)}
        currentProject={currentProject}
        projects={projects}
        currentTimeline={currentTimeline}
        timelines={timelines}
        activeTasks={activeTasks}
        recentFiles={recentFiles}
        currentTheme={currentTheme}
        onProjectChange={handleProjectChange}
        onTimelineChange={handleTimelineChange}
        onNewTimeline={handleNewTimeline}
        onOpenTask={handleOpenTask}
        onOpenFile={handleOpenFile}
        onTriggerTool={handleTriggerTool}
        onOpenTaskBoard={handleOpenTaskBoard}
        onOpenFileManager={handleOpenFileManager}
        onOpenRulesFile={handleOpenRulesFile}
        onThemeChange={handleThemeChange}
      />

      {/* Main Content Area */}
      <DragDropOverlay
        onFilesDropped={handleFilesDropped}
        disabled={isToolRunning || isStreaming}
        className="flex-1 flex flex-col min-w-0"
      >
        {/* Top Bar */}
        <div className="bg-transparent sticky top-0 z-30">
          <div className="flex items-center justify-between p-4 lg:px-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMobileNav(true)}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">{currentTimeline.name}</h1>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded hidden sm:inline-flex ${
                    currentTimeline.agent === 'Claude'
                      ? 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                      : currentTimeline.agent === 'Gemini'
                        ? 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-base-content/10 text-base-content/60'
                  }`}
                >
                  {currentTimeline.agent}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowQuickActions(!showQuickActions)}
                className="btn btn-ghost btn-sm lg:hidden"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Quick Actions Bar */}
          {showQuickActions && (
            <div className="border-t border-base-300 p-4 lg:hidden">
              <div className="flex gap-2 overflow-x-auto pb-2">
                <button
                  onClick={() => handleTriggerTool('file-find')}
                  className="btn btn-sm btn-outline flex-shrink-0"
                >
                  <FontAwesomeIcon icon={faSearch} className="w-4 h-4" />
                  Find Files
                </button>
                <button
                  onClick={() => handleTriggerTool('bash')}
                  className="btn btn-sm btn-outline flex-shrink-0"
                >
                  <FontAwesomeIcon icon={faTerminal} className="w-4 h-4" />
                  Terminal
                </button>
                <button
                  onClick={handleOpenTaskBoard}
                  className="btn btn-sm btn-outline flex-shrink-0"
                >
                  <FontAwesomeIcon icon={faTasks} className="w-4 h-4" />
                  Tasks
                </button>
                <button
                  onClick={handleOpenFileManager}
                  className="btn btn-sm btn-outline flex-shrink-0"
                >
                  <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                  Files
                </button>
                <button
                  onClick={() => {
                    setShowQuickActions(false);
                    setShowVoiceUI(true);
                  }}
                  className="btn btn-sm btn-outline flex-shrink-0 lg:hidden"
                >
                  <FontAwesomeIcon icon={faMicrophone} className="w-4 h-4" />
                  Voice
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Timeline Container */}
        <TimelineView
          entries={timelineEntries}
          isTyping={isStreaming || isThinking}
          currentAgent={currentTimeline.agent}
          streamingContent={currentStreamingContent}
        />

        {/* Chat Input */}
        <EnhancedChatInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => void handleSendMessage()}
          disabled={isToolRunning}
          isStreaming={isStreaming}
          isListening={isListening}
          onStartVoice={startListening}
          onStopVoice={stopListening}
          onInterrupt={interruptStream}
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
        />
      </DragDropOverlay>

      {/* Streaming Indicator */}
      <StreamingIndicator
        isVisible={isStreaming || isThinking}
        onInterrupt={interruptStream}
        agent={currentTimeline.agent}
      />

      {/* Modals */}
      <TaskBoardModal
        isOpen={showTaskBoard}
        onClose={() => setShowTaskBoard(false)}
        tasks={activeTasks}
        onTaskUpdate={handleTaskUpdate}
        onTaskCreate={handleTaskCreate}
      />

      {showVoiceUI && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg p-6 m-4 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Voice Input</h3>
              <button onClick={() => setShowVoiceUI(false)} className="btn btn-ghost btn-sm">
                ✕
              </button>
            </div>
            <VoiceRecognitionUI
              isListening={isListening}
              onStartListening={startListening}
              onStopListening={stopListening}
              transcript={transcript}
              interimTranscript={interimTranscript}
              confidence={confidence}
              error={error as string | undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faSearch, faTerminal, faTasks, faFolder, faMicrophone } from '~/lib/fontawesome';
import { Sidebar } from '~/components/layout/Sidebar';
import { MobileSidebar } from '~/components/layout/MobileSidebar';
import { TimelineView } from '~/components/timeline/TimelineView';
import { EnhancedChatInput } from '~/components/chat/EnhancedChatInput';
import { TaskBoardModal } from '~/components/modals/TaskBoardModal';
import { VoiceRecognitionUI } from '~/components/ui/VoiceRecognitionUI';
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
  const { isStreaming, isThinking, currentThreadId, sendMessage } = useConversationStream({
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
      content: 'Help me analyze the recent code changes',
      timestamp: new Date(Date.now() - 1800000),
    },
    {
      id: 3,
      type: 'ai',
      content: "I'll analyze the codebase changes for you. Let me examine the recent commits.",
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
    if (!prompt.trim() || isStreaming) return;

    const humanEntry: TimelineEntry = {
      id: nextEntryId.current++,
      type: 'human',
      content: prompt.trim(),
      timestamp: new Date(),
    };

    setTimelineEntries((prev) => [...prev, humanEntry]);
    const userPrompt = prompt;
    setPrompt('');

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
  }, [prompt, isStreaming, sendMessage, currentThreadId]);

  const handleProjectChange = (project: Project) => {
    setCurrentProject(project);
    setShowMobileNav(false);
  };

  const handleTimelineChange = (timeline: Timeline) => {
    setCurrentTimeline(timeline);
    setShowMobileNav(false);
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="bg-base-100 border-b border-base-300 sticky top-0 z-30">
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
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-base-content/60 hidden sm:inline">Connected</span>
              </div>
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
          disabled={isStreaming || isThinking || isToolRunning}
          isListening={isListening}
          onStartVoice={startListening}
          onStopVoice={stopListening}
        />
      </div>

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

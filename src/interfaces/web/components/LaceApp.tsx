// ABOUTME: Main web application component integrating all UI elements
// ABOUTME: Manages conversation state, UI layout, and component orchestration

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faSearch, faTerminal, faTasks, faFolder, faMicrophone } from '~/interfaces/web/lib/fontawesome';
import { Sidebar } from './layout/Sidebar';
import { MobileSidebar } from './layout/MobileSidebar';
import { TimelineView } from './timeline/TimelineView';
import { EnhancedChatInput } from './chat/EnhancedChatInput';
import { VoiceRecognitionUI } from './chat/VoiceRecognitionUI';
import { TimelineEntry, Project, Timeline, Task, RecentFile, StreamEvent } from '~/interfaces/web/types';
import { useVoiceRecognition, useConversationStream } from '~/interfaces/web/hooks';

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
      setShowVoiceUI(false);
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
          type: 'feature',
          impact: 'high',
          files: ['src/auth/oauth.ts', 'src/auth/providers.ts'],
          commit: 'a1b2c3d',
        },
        {
          title: 'Database Migration',
          description: 'Updated user schema to support OAuth tokens',
          type: 'maintenance',
          impact: 'medium',
          files: ['migrations/001_oauth_tokens.sql', 'src/models/user.ts'],
          commit: 'e4f5g6h',
        },
        {
          title: 'Login Bug Fix',
          description: 'Fixed session timeout issue in production',
          type: 'bugfix',
          impact: 'high',
          files: ['src/auth/session.ts'],
          commit: 'i7j8k9l',
        },
      ],
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

    try {
      await sendMessage(userPrompt, currentThreadId);
    } catch (error) {
      console.error('Failed to send message:', error);
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
    const systemEntry: TimelineEntry = {
      id: nextEntryId.current++,
      type: 'admin',
      content: `New timeline created: ${newTimeline.name}`,
      timestamp: new Date(),
    };
    setTimelineEntries([systemEntry]);
  };

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  };

  const handleTriggerTool = (toolName: string) => {
    setIsToolRunning(true);
    // Simulate tool execution
    setTimeout(() => {
      setIsToolRunning(false);
      const toolEntry: TimelineEntry = {
        id: nextEntryId.current++,
        type: 'tool',
        tool: toolName,
        content: `${toolName} executed`,
        result: `Tool ${toolName} completed successfully`,
        timestamp: new Date(),
      };
      setTimelineEntries((prev) => [...prev, toolEntry]);
    }, 2000);
  };

  const handleOpenTask = (task: Task) => {
    console.log('Opening task:', task);
  };

  const handleOpenFile = (file: RecentFile) => {
    console.log('Opening file:', file);
  };

  const handleOpenTaskBoard = () => {
    console.log('Opening task board');
  };

  const handleOpenFileManager = () => {
    console.log('Opening file manager');
  };

  const handleOpenRulesFile = () => {
    console.log('Opening rules file');
  };

  const handleOpenTaskDetail = (task: Task) => {
    console.log('Opening task detail:', task);
  };

  return (
    <div className="flex h-screen bg-base-100 text-base-content" data-theme={currentTheme}>
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
        onOpenTaskDetail={handleOpenTaskDetail}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <div className="lg:hidden border-b border-base-300 p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowMobileNav(true)}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
            >
              <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-br from-teal-600 to-teal-700 rounded flex items-center justify-center">
                <span className="text-white text-xs font-bold">L</span>
              </div>
              <span className="font-semibold">Lace</span>
            </div>
            <button
              onClick={() => setShowQuickActions(!showQuickActions)}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
            >
              <FontAwesomeIcon icon={faSearch} className="w-6 h-6" />
            </button>
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
        />

        {/* Chat Input */}
        <EnhancedChatInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => void handleSendMessage()}
          disabled={isStreaming || isThinking || isToolRunning}
          isListening={isListening}
          onStartVoice={() => setShowVoiceUI(true)}
          onStopVoice={stopListening}
        />
      </div>

      {/* Voice Recognition UI */}
      <VoiceRecognitionUI
        isListening={isListening}
        transcript={transcript}
        interimTranscript={interimTranscript}
        confidence={confidence}
        error={error}
        onStop={stopListening}
        onCancel={() => {
          stopListening();
          setShowVoiceUI(false);
        }}
      />
    </div>
  );
}
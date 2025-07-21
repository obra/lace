'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faSearch, faTerminal, faTasks, faFolder, faMicrophone } from '@/lib/fontawesome';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { AnimatedTimelineView } from '@/components/timeline/AnimatedTimelineView';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';
import { VoiceRecognitionUI } from '@/components/ui/VoiceRecognitionUI';
import { TimelineEntry, Project, Timeline, Task, RecentFile } from '@/types';
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition';
import {
  pageTransition,
  fadeInUp,
  staggerContainer,
  staggerItem,
  buttonTap,
  springConfig,
  sidebarVariants,
  notificationVariants,
} from '@/lib/animations';

const availableThemes = [
  { name: 'light', colors: { primary: '#570DF8', secondary: '#F000B8', accent: '#37CDBE' } },
  { name: 'dark', colors: { primary: '#661AE6', secondary: '#D926AA', accent: '#1FB2A5' } },
  { name: 'cupcake', colors: { primary: '#65C3C8', secondary: '#EF9FBC', accent: '#EEAF3A' } },
  { name: 'corporate', colors: { primary: '#4B6BFB', secondary: '#7C3AED', accent: '#37CDBE' } },
  { name: 'synthwave', colors: { primary: '#E779C1', secondary: '#58C7F3', accent: '#F7CC50' } },
  { name: 'cyberpunk', colors: { primary: '#FF7598', secondary: '#75D1F0', accent: '#C07F00' } },
];

export function AnimatedLaceApp() {
  // UI State
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showVoiceUI, setShowVoiceUI] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Chat State
  const [prompt, setPrompt] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isToolRunning, setIsToolRunning] = useState(false);
  const nextEntryId = useRef(9);

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

  // Data State
  const [currentProject, setCurrentProject] = useState<Project>({
    id: "1",
    name: 'AI Research',
    workingDirectory: '/projects/ai-research',
  });

  const [projects] = useState<Project[]>([
    { 
      id: 'ai-research-project',
      name: 'AI Research',
      description: 'Advanced AI research and development project',
      workingDirectory: '/projects/ai-research',
      isArchived: false,
      createdAt: new Date('2024-01-01T08:00:00Z'),
      lastUsedAt: new Date('2024-01-15T10:00:00Z'),
      sessionCount: 42,
    },
    { 
      id: 'web-app-project',
      name: 'Web App',
      description: 'Full-stack web application development',
      workingDirectory: '/projects/webapp',
      isArchived: false,
      createdAt: new Date('2023-12-20T10:00:00Z'),
      lastUsedAt: new Date('2024-01-14T15:30:00Z'),
      sessionCount: 28,
    },
    { 
      id: 'data-pipeline-project',
      name: 'Data Pipeline',
      description: 'ETL data processing pipeline',
      workingDirectory: '/projects/data-pipeline',
      isArchived: false,
      createdAt: new Date('2023-11-15T12:00:00Z'),
      lastUsedAt: new Date('2024-01-13T09:15:00Z'),
      sessionCount: 32,
    },
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
      id: 'animated-task-001',
      title: 'AI Model Integration',
      description: 'Integrate latest language model',
      prompt: 'Integrate the latest language model API with our existing codebase, ensuring proper error handling and performance optimization',
      priority: 'high',
      assignedTo: 'claude-agent-thread-id' as any,
      status: 'in_progress',
      createdBy: 'session-main-thread' as any,
      threadId: 'session-main' as any,
      createdAt: new Date('2024-01-15T09:00:00Z'),
      updatedAt: new Date('2024-01-15T10:30:00Z'),
      notes: [],
    },
    {
      id: 'animated-task-002',
      title: 'Auth Bug Fix',
      description: 'Fix login timeout',
      prompt: 'Investigate and fix the authentication timeout issue occurring in production environment',
      priority: 'medium',
      assignedTo: undefined,
      status: 'pending',
      createdBy: 'session-main-thread' as any,
      threadId: 'session-main' as any,
      createdAt: new Date('2024-01-14T14:00:00Z'),
      updatedAt: new Date('2024-01-14T14:00:00Z'),
      notes: [],
    },
    {
      id: 'animated-task-003',
      title: 'Update Docs',
      description: 'API documentation',
      prompt: 'Update the API documentation to reflect the recent changes in authentication endpoints and response formats',
      priority: 'low',
      assignedTo: 'claude-agent-thread-id' as any,
      status: 'blocked',
      createdBy: 'session-main-thread' as any,
      threadId: 'session-main' as any,
      createdAt: new Date('2024-01-13T16:00:00Z'),
      updatedAt: new Date('2024-01-13T16:30:00Z'),
      notes: [],
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

  // Auto-dismiss notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Handlers
  const handleSendMessage = useCallback(() => {
    if (!prompt.trim() || isTyping) return;

    const humanEntry: TimelineEntry = {
      id: nextEntryId.current++,
      type: 'human',
      content: prompt.trim(),
      timestamp: new Date(),
    };

    setTimelineEntries((prev) => [...prev, humanEntry]);
    const userPrompt = prompt;
    setPrompt('');

    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiEntry: TimelineEntry = {
        id: nextEntryId.current++,
        type: 'ai',
        content: `I'll help you with "${userPrompt}". Let me analyze that and provide assistance.`,
        agent: currentTimeline.agent,
        timestamp: new Date(),
      };

      setTimelineEntries((prev) => [...prev, aiEntry]);
      setIsTyping(false);
    }, 1000);
  }, [prompt, isTyping, currentTimeline.agent]);

  const handleProjectChange = (project: Project) => {
    setCurrentProject(project);
    setShowMobileNav(false);
    setNotification(`Switched to project: ${project.name}`);
  };

  const handleTimelineChange = (timeline: Timeline) => {
    setCurrentTimeline(timeline);
    setShowMobileNav(false);
    setNotification(`Switched to timeline: ${timeline.name}`);
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
    setNotification(`Theme changed to ${theme}`);
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
      setNotification(`Tool ${toolName} executed successfully`);
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
    setShowMobileNav(false);
  };

  const handleOpenFile = (file: RecentFile) => {
    addSystemMessage(`Opened file: ${file.name}`);
    setNotification(`Opened ${file.name}`);
  };

  const handleOpenTaskBoard = () => {
    setShowMobileNav(false);
    setShowTaskBoard(true);
  };

  const handleTaskUpdate = (updatedTask: Task) => {
    addSystemMessage(`Task "${updatedTask.title}" moved to ${updatedTask.status}`);
    setNotification(`Task updated: ${updatedTask.title}`);
  };

  const handleTaskCreate = (newTask: Omit<Task, 'id'>) => {
    const task = { 
      ...newTask, 
      id: `animated-task-${Date.now()}`,
    };
    addSystemMessage(`New task created: "${task.title}"`);
    setNotification(`Task created: ${task.title}`);
  };

  const handleOpenFileManager = () => {
    setShowMobileNav(false);
    addSystemMessage('File Manager opened');
    setNotification('File Manager opened');
  };

  const handleOpenRulesFile = () => {
    addSystemMessage('Rules configuration opened');
    setNotification('Rules configuration opened');
  };

  return (
    <motion.div
      className="flex h-screen bg-base-200 text-base-content font-sans overflow-hidden"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Mobile Sidebar */}
      <AnimatePresence>
        {showMobileNav && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowMobileNav(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              variants={sidebarVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className="relative w-80 h-full"
            >
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <motion.div
        initial={{ x: showDesktopSidebar ? 0 : -320 }}
        animate={{ x: showDesktopSidebar ? 0 : -320 }}
        transition={springConfig.smooth}
        className="hidden lg:block"
      >
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
      </motion.div>

      {/* Main Content Area */}
      <motion.div className="flex-1 flex flex-col min-w-0" layout transition={springConfig.smooth}>
        {/* Top Bar */}
        <motion.div
          className="bg-transparent sticky top-0 z-30"
          variants={fadeInUp}
          initial="initial"
          animate="animate"
        >
          <motion.div
            className="flex items-center justify-between p-4 lg:px-6"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
          >
            <motion.div className="flex items-center gap-3" variants={staggerItem}>
              <motion.button
                onClick={() => setShowMobileNav(true)}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
                {...buttonTap}
                whileHover={{ scale: 1.05 }}
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <motion.h1
                  className="font-semibold text-base-content truncate"
                  key={currentTimeline.name}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={springConfig.gentle}
                >
                  {currentTimeline.name}
                </motion.h1>
                <motion.span
                  className={`text-xs px-1.5 py-0.5 rounded hidden sm:inline-flex ${
                    currentTimeline.agent === 'Claude'
                      ? 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                      : currentTimeline.agent === 'Gemini'
                        ? 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-base-content/10 text-base-content/60'
                  }`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, ...springConfig.bouncy }}
                >
                  {currentTimeline.agent}
                </motion.span>
              </div>
            </motion.div>

            <motion.div className="flex items-center gap-2" variants={staggerItem}>
              <motion.button
                onClick={() => setShowQuickActions(!showQuickActions)}
                className="btn btn-ghost btn-sm lg:hidden"
                {...buttonTap}
                whileHover={{ scale: 1.05 }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                  />
                </svg>
              </motion.button>
            </motion.div>
          </motion.div>

          {/* Mobile Quick Actions Bar */}
          <AnimatePresence>
            {showQuickActions && (
              <motion.div
                className="border-t border-base-300 p-4 lg:hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springConfig.gentle}
              >
                <motion.div
                  className="flex gap-2 overflow-x-auto pb-2"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    { icon: faSearch, label: 'Find Files', tool: 'file-find' },
                    { icon: faTerminal, label: 'Terminal', tool: 'bash' },
                    { icon: faTasks, label: 'Tasks', action: handleOpenTaskBoard },
                    { icon: faFolder, label: 'Files', action: handleOpenFileManager },
                    { icon: faMicrophone, label: 'Voice', action: () => setShowVoiceUI(true) },
                  ].map((item, _index) => (
                    <motion.button
                      key={item.label}
                      onClick={item.action || (() => handleTriggerTool(item.tool ?? ''))}
                      className="btn btn-sm btn-outline flex-shrink-0"
                      variants={staggerItem}
                      {...buttonTap}
                      whileHover={{ scale: 1.05 }}
                    >
                      <FontAwesomeIcon icon={item.icon} className="w-4 h-4" />
                      {item.label}
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Timeline Container */}
        <AnimatedTimelineView
          entries={timelineEntries}
          isTyping={isTyping}
          currentAgent={currentTimeline.agent}
        />

        {/* Chat Input */}
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, ...springConfig.gentle }}
        >
          <EnhancedChatInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void handleSendMessage()}
            disabled={isTyping || isToolRunning}
            isListening={isListening}
            onStartVoice={startListening}
            onStopVoice={stopListening}
          />
        </motion.div>
      </motion.div>

      {/* Modals */}
      <TaskBoardModal
        isOpen={showTaskBoard}
        onClose={() => setShowTaskBoard(false)}
        tasks={activeTasks}
        onTaskUpdate={handleTaskUpdate}
        onTaskCreate={handleTaskCreate}
      />

      <AnimatePresence>
        {showVoiceUI && (
          <AnimatedModal
            isOpen={showVoiceUI}
            onClose={() => setShowVoiceUI(false)}
            title="Voice Input"
            size="md"
          >
            <VoiceRecognitionUI
              isListening={isListening}
              onStartListening={startListening}
              onStopListening={stopListening}
              transcript={transcript}
              interimTranscript={interimTranscript}
              confidence={confidence}
              error={error}
            />
          </AnimatedModal>
        )}
      </AnimatePresence>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            className="fixed top-4 right-4 z-50"
            variants={notificationVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="bg-success text-success-content px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
              {notification}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

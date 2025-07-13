// ABOUTME: Sophisticated animated version of LaceApp with advanced UI animations
// ABOUTME: Provides comprehensive animated interface with framer-motion and DaisyUI

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBars,
  faSearch,
  faTerminal,
  faTasks,
  faFolder,
  faMicrophone,
} from '~/interfaces/web/lib/fontawesome';
import { Sidebar } from '~/interfaces/web/components/layout/Sidebar';
import { MobileSidebar } from '~/interfaces/web/components/layout/MobileSidebar';
import { AnimatedTimelineView } from '~/interfaces/web/components/timeline/AnimatedTimelineView';
import { EnhancedChatInput } from '~/interfaces/web/components/chat/EnhancedChatInput';
import { AnimatedModal } from '~/interfaces/web/components/ui/AnimatedModal';
import { TaskBoardModal } from '~/interfaces/web/components/modals/TaskBoardModal';
import { VoiceRecognitionUI } from '~/interfaces/web/components/ui/VoiceRecognitionUI';
import {
  TimelineEntry,
  Project,
  Timeline,
  Task,
  RecentFile,
  ThreadId,
  createThreadId,
} from '~/interfaces/web/types';
import { useVoiceRecognition } from '~/interfaces/web/hooks/useVoiceRecognition';
import { useAgentConversation } from '~/interfaces/web/hooks/useAgentConversation';
import { useAgentStatus } from '~/interfaces/web/hooks/useAgentStatus';
import {
  pageTransition,
  fadeInUp,
  staggerContainer,
  staggerItem,
  buttonTap,
  hoverLift,
  springConfig,
  sidebarVariants,
  notificationVariants,
} from '~/interfaces/web/lib/animations';

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
  const [isToolRunning, setIsToolRunning] = useState(false);
  const nextEntryId = useRef(1000); // Start with high number to avoid conflicts

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
    id: 1,
    name: 'AI Research',
    path: '/projects/ai-research',
  });

  const [projects] = useState<Project[]>([
    { id: 1, name: 'AI Research', path: '/projects/ai-research' },
    { id: 2, name: 'Web App', path: '/projects/webapp' },
    { id: 3, name: 'Data Pipeline', path: '/projects/data-pipeline' },
  ]);

  const [currentTimeline, setCurrentTimeline] = useState<Timeline | null>(null);

  // Get initial Agent status to establish thread context
  const { loading: agentLoading, error: agentError, status: agentStatus } = useAgentStatus();

  // Real Conversation System - pass the current timeline's threadId if available
  const {
    sendMessage,
    isLoading: isStreaming,
    messages,
    currentThreadId,
  } = useAgentConversation({
    threadId: currentTimeline?.threadId,
  });

  // isTyping is now derived from the conversation stream state
  const isTyping = isStreaming;

  const [timelines, setTimelines] = useState<Timeline[]>([]);

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

  // Additional entries for tool/admin messages
  const [additionalEntries, setAdditionalEntries] = useState<TimelineEntry[]>([
    {
      id: 'admin-1',
      type: 'admin',
      content: 'Timeline started',
      timestamp: new Date(Date.now() - 3600000),
    },
  ]);

  // Convert real conversation messages to timeline entries
  const conversationEntries: TimelineEntry[] = messages.map((message, index) => ({
    id: `msg-${message.id}`,
    type: message.role === 'user' ? 'human' : 'ai',
    content: message.content,
    timestamp: message.timestamp,
    agent: message.role === 'assistant' ? currentTimeline?.agent || 'Claude' : undefined,
  }));

  // Combine conversation and additional entries, sorted by timestamp
  const timelineEntries = [...conversationEntries, ...additionalEntries].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  useEffect(() => {
    // Set theme on mount
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Initialize timeline from Agent status when available
  useEffect(() => {
    if (agentStatus && !currentTimeline) {
      if (agentStatus.latestThreadId) {
        // Agent has an existing thread, create timeline with it
        const agentTimeline: Timeline = {
          threadId: agentStatus.latestThreadId as ThreadId,
          name: 'Resumed Chat',
          agent: 'Claude',
        };
        setCurrentTimeline(agentTimeline);
        setTimelines([agentTimeline]);

        // Also save to localStorage for next time
        localStorage.setItem('currentTimelineId', agentStatus.latestThreadId);
      } else {
        // No existing thread, Agent will create one when first message is sent
        // Don't create timeline yet, wait for 'connection' event
      }
    }
  }, [agentStatus, currentTimeline]);

  // Create or update timeline when we get a thread ID from the Agent
  useEffect(() => {
    if (currentThreadId && !currentTimeline) {
      // Create a new timeline with the Agent-provided thread ID (use as-is from Agent)
      const newTimeline: Timeline = {
        threadId: currentThreadId as ThreadId,
        name: `Chat ${new Date().toLocaleTimeString()}`,
        agent: 'Claude',
      };
      setCurrentTimeline(newTimeline);
      setTimelines((prev) => [...prev, newTimeline]);
    }
  }, [currentThreadId, currentTimeline]);

  // Save current timeline to localStorage when it changes
  useEffect(() => {
    if (currentTimeline) {
      localStorage.setItem('currentTimelineId', currentTimeline.threadId);
    }
  }, [currentTimeline?.threadId]);

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
  const handleSendMessage = useCallback(async () => {
    if (!prompt.trim() || isStreaming) return;

    const userMessage = prompt.trim();
    setPrompt('');

    try {
      await sendMessage(userMessage);
    } catch (error) {
      console.error('Failed to send message:', error);
      setNotification('Failed to send message. Please try again.');
    }
  }, [prompt, isStreaming, sendMessage]);

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
    // Don't create a timeline here - let the user start a conversation
    // and the Agent will provide the thread ID
    setCurrentTimeline(null);
    addSystemMessage('Starting new chat...');
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

      setAdditionalEntries((prev) => [...prev, toolEntry]);
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
    setAdditionalEntries((prev) => [...prev, adminEntry]);
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
    const task = { ...newTask, id: Date.now() };
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
              {currentTimeline && (
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
              )}
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
        {currentTimeline && (
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
        )}
      </motion.div>

      {/* Main Content Area */}
      <motion.div className="flex-1 flex flex-col min-w-0" layout transition={springConfig.smooth}>
        {/* Top Bar */}
        <motion.div
          className="bg-base-100 border-b border-base-300 sticky top-0 z-30"
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
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <motion.h1
                    className="font-semibold text-base-content truncate"
                    key={currentTimeline?.name || 'new-chat'}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springConfig.gentle}
                  >
                    {agentLoading ? 'Loading...' : currentTimeline?.name || 'New Chat'}
                  </motion.h1>
                  {currentTimeline && (
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
                  )}
                </div>
                {currentTimeline && (
                  <motion.div
                    className="text-xs text-base-content/50 font-mono"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 }}
                  >
                    Thread: {currentTimeline.threadId}
                  </motion.div>
                )}
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
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-2 h-2 bg-teal-500 rounded-full"
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.7, 1, 0.7],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
                <span className="text-sm text-base-content/60 hidden sm:inline">Connected</span>
              </div>
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
                  ].map((item, index) => (
                    <motion.button
                      key={item.label}
                      onClick={item.action || (() => handleTriggerTool(item.tool))}
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
          currentAgent={currentTimeline?.agent || 'Claude'}
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

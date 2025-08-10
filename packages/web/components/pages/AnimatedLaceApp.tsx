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
import { SettingsContainer } from '@/components/settings/SettingsContainer';
import { Timeline, RecentFile } from '@/types/design-system';
import { TimelineEntry } from '@/types/web-events';
import type { Task } from '@/types/core';
import type { ProjectInfo as Project } from '@/types/core';
import { asThreadId } from '@/types/core';
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

interface AnimatedLaceAppProps {
  initialProjects?: Project[];
  initialCurrentProject?: Project;
  initialTimelines?: Timeline[];
  initialCurrentTimeline?: Timeline;
  initialTasks?: Task[];
  initialRecentFiles?: RecentFile[];
}

export function AnimatedLaceApp({
  initialProjects = [],
  initialCurrentProject,
  initialTimelines = [],
  initialCurrentTimeline,
  initialTasks = [],
  initialRecentFiles = []
}: AnimatedLaceAppProps = {}) {
  // UI State
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);
  const [showQuickActions, setShowQuickActions] = useState(false);
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
  const [currentProject, setCurrentProject] = useState<Project>(
    initialCurrentProject || {
      id: "1",
      name: 'AI Research',
      description: 'AI Research Project',
      workingDirectory: '/projects/ai-research',
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    }
  );

  const [projects] = useState<Project[]>(initialProjects);

  const [currentTimeline, setCurrentTimeline] = useState<Timeline>(
    initialCurrentTimeline || { id: 1, name: 'Main Dev', agent: 'Claude' }
  );

  const [timelines, setTimelines] = useState<Timeline[]>(initialTimelines);

  const [recentFiles] = useState<RecentFile[]>(initialRecentFiles);

  const [activeTasks] = useState<Task[]>(initialTasks);

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
    // Theme is now managed by SettingsContainer
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

  // Theme change handling is now managed by SettingsContainer

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
        result: {
          content: [{ type: 'text' as const, text: `${toolName} completed successfully` }],
          status: 'completed' as const,
        },
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
              <SettingsContainer>
                {({ onOpenSettings }) => (
                  <MobileSidebar
                    isOpen={showMobileNav}
                    onClose={() => setShowMobileNav(false)}
                    onSettingsClick={onOpenSettings}
                  >
                <div className="p-4">
                  <h2 className="text-lg font-semibold mb-4">Demo Content</h2>
                  <p className="text-sm text-base-content/70">
                    This is a demo version of the mobile sidebar.
                  </p>
                </div>
                  </MobileSidebar>
                )}
              </SettingsContainer>
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
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <Sidebar
              isOpen={showDesktopSidebar}
              onToggle={() => setShowDesktopSidebar(!showDesktopSidebar)}
              onSettingsClick={onOpenSettings}
            >
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Demo Sidebar</h2>
            <p className="text-sm text-base-content/70 mb-4">
              This is a demo version of the desktop sidebar.
            </p>
            <div className="space-y-2">
              <div className="p-2 rounded bg-base-200">
                Project: {currentProject.name}
              </div>
              <div className="p-2 rounded bg-base-200">
                Timeline: {currentTimeline.name}
              </div>
              <div className="p-2 rounded bg-base-200">
                Tasks: {activeTasks.length}
              </div>
            </div>
          </div>
            </Sidebar>
          )}
        </SettingsContainer>
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

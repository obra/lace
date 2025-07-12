'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSearch, 
  faTerminal, 
  faTasks, 
  faFolder, 
  faFolderOpen, 
  faComments,
  faPlus,
  faCog,
  faFileCode
} from '~/lib/fontawesome';
import { 
  ChevronDownIcon, 
  ChevronRightIcon, 
  ChevronLeftIcon 
} from '~/lib/heroicons';
import { Timeline, Project, Task, RecentFile } from '~/types';
import { ThemeSelector } from '~/components/ui/ThemeSelector';
import { AccountDropdown } from '~/components/ui/AccountDropdown';
import { 
  fadeInLeft,
  fadeInUp,
  staggerContainer,
  staggerItem,
  buttonTap,
  hoverLift,
  springConfig,
  scaleIn,
  popIn
} from '~/lib/animations';

interface AnimatedSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  currentProject: Project;
  projects: Project[];
  currentTimeline: Timeline;
  timelines: Timeline[];
  activeTasks: Task[];
  recentFiles: RecentFile[];
  currentTheme: string;
  onProjectChange: (project: Project) => void;
  onTimelineChange: (timeline: Timeline) => void;
  onNewTimeline: () => void;
  onOpenTask: (task: Task) => void;
  onOpenFile: (file: RecentFile) => void;
  onTriggerTool: (tool: string) => void;
  onOpenTaskBoard: () => void;
  onOpenFileManager: () => void;
  onOpenRulesFile: () => void;
  onThemeChange: (theme: string) => void;
}

export function AnimatedSidebar({
  isOpen,
  onToggle,
  currentProject,
  projects,
  currentTimeline,
  timelines,
  activeTasks,
  recentFiles,
  currentTheme,
  onProjectChange,
  onTimelineChange,
  onNewTimeline,
  onOpenTask,
  onOpenFile,
  onTriggerTool,
  onOpenTaskBoard,
  onOpenFileManager,
  onOpenRulesFile,
  onThemeChange,
}: AnimatedSidebarProps) {
  const [conversationsExpanded, setConversationsExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  const quickActions = [
    { icon: faSearch, tool: 'file-find', title: 'Find Files', color: 'text-blue-500' },
    { icon: faTerminal, tool: 'bash', title: 'Terminal', color: 'text-green-500' },
    { icon: faTasks, action: onOpenTaskBoard, title: 'Tasks', color: 'text-purple-500' },
    { icon: faFolder, action: onOpenFileManager, title: 'Files', color: 'text-orange-500' },
  ];

  if (!isOpen) {
    // Animated collapsed sidebar
    return (
      <motion.div 
        className="hidden lg:flex bg-base-100 border-r border-base-300 flex-col relative w-16"
        initial={{ width: 350 }}
        animate={{ width: 64 }}
        transition={springConfig.smooth}
      >
        <motion.div 
          className="flex flex-col items-center py-4 space-y-6"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Logo */}
          <motion.div 
            className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-lg overflow-hidden relative"
            variants={popIn}
            whileHover={{ 
              scale: 1.1,
              rotate: 5,
              transition: springConfig.bouncy 
            }}
            {...buttonTap}
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"
              animate={{
                opacity: [0.2, 0.4, 0.2],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            <span className="text-primary-content font-bold text-lg relative z-10">L</span>
          </motion.div>

          {/* Quick Actions */}
          <motion.div 
            className="flex flex-col gap-4"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
          >
            {quickActions.map((action, index) => (
              <motion.button
                key={action.title}
                onClick={action.action || (() => onTriggerTool(action.tool!))}
                className="p-2 hover:bg-base-200 rounded-lg transition-colors group relative"
                title={action.title}
                variants={staggerItem}
                whileHover={{ 
                  scale: 1.1,
                  backgroundColor: "rgba(0,0,0,0.05)",
                  transition: springConfig.snappy 
                }}
                {...buttonTap}
              >
                <motion.div
                  initial={{ rotate: 0 }}
                  whileHover={{ rotate: 10 }}
                  transition={springConfig.gentle}
                >
                  <FontAwesomeIcon 
                    icon={action.icon} 
                    className={`w-5 h-5 ${action.color} group-hover:scale-110 transition-all`} 
                  />
                </motion.div>
                
                {/* Tooltip */}
                <motion.div
                  className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-base-content text-base-100 text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50"
                  initial={{ x: -10, opacity: 0 }}
                  whileHover={{ x: 0, opacity: 1 }}
                  transition={springConfig.gentle}
                >
                  {action.title}
                </motion.div>
              </motion.button>
            ))}
          </motion.div>
        </motion.div>

        {/* Toggle Button */}
        <motion.button
          onClick={onToggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
          whileHover={{ 
            scale: 1.1,
            boxShadow: "0 4px 15px rgba(0,0,0,0.1)",
            transition: springConfig.snappy 
          }}
          {...buttonTap}
        >
          <motion.div
            animate={{ rotate: 0 }}
            whileHover={{ rotate: 180 }}
            transition={springConfig.gentle}
          >
            <ChevronRightIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors" />
          </motion.div>
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="hidden lg:flex bg-base-100 border-r border-base-300 flex-col relative w-[350px]"
      initial={{ width: 64 }}
      animate={{ width: 350 }}
      transition={springConfig.smooth}
    >
      <motion.div 
        className="flex flex-col h-full"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Header */}
        <motion.div 
          className="p-4 border-b border-base-300"
          variants={fadeInUp}
        >
          <div className="flex items-center justify-between">
            <motion.div 
              className="flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              transition={springConfig.gentle}
            >
              <motion.div 
                className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg overflow-hidden relative"
                whileHover={{ 
                  rotate: 360,
                  transition: { duration: 0.8, ease: "easeInOut" }
                }}
              >
                <motion.div 
                  className="absolute inset-0 opacity-20"
                  animate={{
                    background: [
                      "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)",
                      "repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)",
                      "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)"
                    ]
                  }}
                  transition={{ duration: 4, repeat: Infinity }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div 
                    className="w-5 h-5 border-2 border-white/30 rounded transform rotate-45"
                    animate={{ rotate: [45, 225, 45] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div 
                    className="absolute w-3 h-3 border border-white/20 rounded transform rotate-45"
                    animate={{ rotate: [45, -135, 45] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
              </motion.div>
              <motion.h1 
                className="font-semibold text-base-content"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, ...springConfig.gentle }}
              >
                Lace
              </motion.h1>
            </motion.div>
          </div>
        </motion.div>

        {/* Project Selector */}
        <motion.div 
          className="p-4 border-b border-base-300"
          variants={fadeInUp}
        >
          <motion.div 
            className="dropdown w-full"
            whileHover={{ scale: 1.01 }}
            transition={springConfig.gentle}
          >
            <motion.div 
              tabIndex={0} 
              role="button" 
              className="btn btn-ghost justify-between w-full"
              {...hoverLift}
            >
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: [0, 10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <FontAwesomeIcon icon={faFolderOpen} className="w-4 h-4 text-teal-600" />
                </motion.div>
                <span className="truncate">{currentProject.name}</span>
              </div>
              <motion.div
                animate={{ rotate: [0, 180, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <ChevronDownIcon className="w-4 h-4" />
              </motion.div>
            </motion.div>
            <motion.ul
              tabIndex={0}
              className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              {projects.map((project, index) => (
                <motion.li 
                  key={project.id}
                  variants={staggerItem}
                  whileHover={{ x: 5 }}
                  transition={springConfig.gentle}
                >
                  <motion.a 
                    onClick={() => onProjectChange(project)}
                    {...buttonTap}
                  >
                    {project.name}
                  </motion.a>
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>
        </motion.div>

        {/* Content */}
        <motion.div 
          className="flex-1 overflow-y-auto"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Conversations */}
          <motion.div className="p-4" variants={staggerItem}>
            <motion.button
              onClick={() => setConversationsExpanded(!conversationsExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
              {...hoverLift}
              whileHover={{ x: 2 }}
            >
              <span className="text-sm font-medium text-base-content">Agent Chats</span>
              <motion.div
                animate={{ rotate: conversationsExpanded ? 0 : -90 }}
                transition={springConfig.gentle}
              >
                <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
              </motion.div>
            </motion.button>

            <AnimatePresence>
              {conversationsExpanded && (
                <motion.div 
                  className="mt-2 space-y-1"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springConfig.gentle}
                >
                  {/* Current Timeline */}
                  <motion.div 
                    className="p-3 bg-teal-500/10 border border-teal-500/30 rounded-lg text-sm"
                    variants={scaleIn}
                    {...hoverLift}
                  >
                    <div className="flex items-center gap-2">
                      <motion.div 
                        className="w-2 h-2 bg-teal-500 rounded-full"
                        animate={{ 
                          scale: [1, 1.2, 1],
                          opacity: [0.7, 1, 0.7]
                        }}
                        transition={{ 
                          duration: 2, 
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                      />
                      <span>{currentTimeline.name}</span>
                      <motion.span
                        className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                          currentTimeline.agent === 'Claude'
                            ? 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                            : currentTimeline.agent === 'Gemini'
                              ? 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-base-content/10 text-base-content/60'
                        }`}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, ...springConfig.bouncy }}
                      >
                        {currentTimeline.agent}
                      </motion.span>
                    </div>
                  </motion.div>

                  {/* Other Timelines */}
                  <motion.div
                    variants={staggerContainer}
                    initial="initial"
                    animate="animate"
                  >
                    {timelines.map((timeline, index) => (
                      <motion.button
                        key={timeline.id}
                        onClick={() => onTimelineChange(timeline)}
                        className="w-full text-left p-3 hover:bg-base-200 rounded-lg text-sm text-base-content/80 transition-colors"
                        variants={staggerItem}
                        {...hoverLift}
                        whileHover={{ x: 5 }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <motion.div
                              whileHover={{ rotate: 360 }}
                              transition={{ duration: 0.5 }}
                            >
                              <FontAwesomeIcon icon={faComments} className="w-4 h-4 text-base-content/40" />
                            </motion.div>
                            <span className="truncate">{timeline.name}</span>
                          </div>
                          <motion.span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              timeline.agent === 'Claude'
                                ? 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                                : timeline.agent === 'GPT-4'
                                  ? 'bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                  : timeline.agent === 'Gemini'
                                    ? 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                    : 'bg-base-content/10 text-base-content/60'
                            }`}
                            whileHover={{ scale: 1.05 }}
                          >
                            {timeline.agent}
                          </motion.span>
                        </div>
                      </motion.button>
                    ))}
                  </motion.div>

                  {/* New Timeline Button */}
                  <motion.button
                    onClick={onNewTimeline}
                    className="w-full p-3 border border-dashed border-base-300 rounded-lg text-sm text-center hover:bg-base-200 transition-colors"
                    whileHover={{ 
                      borderColor: "rgb(var(--primary))",
                      backgroundColor: "rgba(var(--primary), 0.05)",
                      scale: 1.02
                    }}
                    {...buttonTap}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <motion.div
                        whileHover={{ rotate: 90 }}
                        transition={springConfig.snappy}
                      >
                        <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                      </motion.div>
                      New Timeline
                    </div>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Tasks */}
          <motion.div className="p-4 border-t border-base-300" variants={staggerItem}>
            <motion.button
              onClick={() => setTasksExpanded(!tasksExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
              {...hoverLift}
              whileHover={{ x: 2 }}
            >
              <span className="text-sm font-medium text-base-content">Tasks</span>
              <div className="flex items-center gap-2">
                <motion.span 
                  className="badge badge-sm bg-teal-500 text-white border-0"
                  animate={{ 
                    scale: [1, 1.1, 1],
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  {activeTasks.length}
                </motion.span>
                <motion.div
                  animate={{ rotate: tasksExpanded ? 0 : -90 }}
                  transition={springConfig.gentle}
                >
                  <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
                </motion.div>
              </div>
            </motion.button>

            <AnimatePresence>
              {tasksExpanded && (
                <motion.div 
                  className="mt-2 space-y-2"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springConfig.gentle}
                >
                  <motion.div
                    variants={staggerContainer}
                    initial="initial"
                    animate="animate"
                  >
                    {activeTasks.slice(0, 3).map((task, index) => (
                      <motion.div
                        key={task.id}
                        className="task-card p-3 bg-base-200 rounded-lg border border-base-300 hover:shadow-sm transition-all cursor-pointer"
                        onClick={() => onOpenTask(task)}
                        variants={staggerItem}
                        {...hoverLift}
                        whileHover={{ 
                          x: 5,
                          backgroundColor: "rgba(var(--primary), 0.05)"
                        }}
                        {...buttonTap}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <motion.h4 
                              className="text-sm font-medium text-base-content truncate"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: index * 0.1 }}
                            >
                              {task.title}
                            </motion.h4>
                            <motion.p 
                              className="text-xs text-base-content/60 mt-1"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: index * 0.1 + 0.1 }}
                            >
                              {task.description}
                            </motion.p>
                            <motion.div 
                              className="flex items-center gap-2 mt-2"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.1 + 0.2 }}
                            >
                              <motion.span
                                className={`text-xs px-1.5 py-0.5 rounded ${
                                  task.priority === 'high'
                                    ? 'bg-red-900/20 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                    : task.priority === 'medium'
                                      ? 'bg-yellow-900/20 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400'
                                      : 'bg-base-content/10 text-base-content/60'
                                }`}
                                whileHover={{ scale: 1.05 }}
                              >
                                {task.priority}
                              </motion.span>
                              <span className="text-xs text-base-content/50">{task.assignee}</span>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                  
                  <motion.button 
                    className="w-full p-2 text-xs text-base-content/60 hover:text-base-content hover:bg-base-200 rounded transition-colors"
                    whileHover={{ 
                      scale: 1.02,
                      backgroundColor: "rgba(var(--primary), 0.05)"
                    }}
                    {...buttonTap}
                  >
                    View All Tasks
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Files */}
          <motion.div className="p-4 border-t border-base-300" variants={staggerItem}>
            <motion.button
              onClick={() => setFilesExpanded(!filesExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
              {...hoverLift}
              whileHover={{ x: 2 }}
            >
              <span className="text-sm font-medium text-base-content">Files</span>
              <motion.div
                animate={{ rotate: filesExpanded ? 0 : -90 }}
                transition={springConfig.gentle}
              >
                <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
              </motion.div>
            </motion.button>

            <AnimatePresence>
              {filesExpanded && (
                <motion.div 
                  className="mt-2 space-y-1 max-h-64 overflow-y-auto"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springConfig.gentle}
                >
                  <motion.div
                    variants={staggerContainer}
                    initial="initial"
                    animate="animate"
                  >
                    {recentFiles.map((file, index) => (
                      <motion.button
                        key={file.path}
                        className="w-full text-left p-3 hover:bg-base-200 rounded-lg text-sm text-base-content/80 flex items-center transition-colors group"
                        onClick={() => onOpenFile(file)}
                        variants={staggerItem}
                        {...hoverLift}
                        whileHover={{ x: 5 }}
                      >
                        <motion.div
                          whileHover={{ scale: 1.2, rotate: 10 }}
                          transition={springConfig.gentle}
                        >
                          <FontAwesomeIcon 
                            icon={faFileCode} 
                            className="w-4 h-4 mr-2 text-base-content/40 group-hover:text-teal-600 transition-colors" 
                          />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <motion.div 
                            className="truncate"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            {file.name}
                          </motion.div>
                          <motion.div 
                            className="text-xs text-base-content/50 truncate"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: index * 0.05 + 0.1 }}
                          >
                            {file.path}
                          </motion.div>
                        </div>
                      </motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Settings */}
          <motion.div className="p-4 border-t border-base-300" variants={staggerItem}>
            <motion.button
              onClick={() => setSettingsExpanded(!settingsExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
              {...hoverLift}
              whileHover={{ x: 2 }}
            >
              <span className="text-sm font-medium text-base-content">Settings</span>
              <motion.div
                animate={{ rotate: settingsExpanded ? 0 : -90 }}
                transition={springConfig.gentle}
              >
                <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
              </motion.div>
            </motion.button>

            <AnimatePresence>
              {settingsExpanded && (
                <motion.div 
                  className="mt-2 space-y-4"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springConfig.gentle}
                >
                  <motion.div 
                    className="p-4 bg-base-200 rounded-lg space-y-4"
                    variants={scaleIn}
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                    >
                      <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
                    </motion.div>

                    <motion.div 
                      className="pt-2 border-t border-base-300"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      <motion.button
                        onClick={onOpenRulesFile}
                        className="w-full p-2 text-sm text-center border border-base-300 rounded hover:bg-base-300 transition-colors"
                        {...hoverLift}
                        whileHover={{ 
                          borderColor: "rgb(var(--primary))",
                          backgroundColor: "rgba(var(--primary), 0.05)"
                        }}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <motion.div
                            whileHover={{ rotate: 180 }}
                            transition={springConfig.gentle}
                          >
                            <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                          </motion.div>
                          Edit Rules
                        </div>
                      </motion.button>
                    </motion.div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        {/* Account Section */}
        <motion.div
          variants={fadeInUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.3 }}
        >
          <AccountDropdown />
        </motion.div>
      </motion.div>

      {/* Toggle Button */}
      <motion.button
        onClick={onToggle}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
        whileHover={{ 
          scale: 1.1,
          boxShadow: "0 4px 15px rgba(0,0,0,0.1)",
          transition: springConfig.snappy 
        }}
        {...buttonTap}
      >
        <motion.div
          animate={{ rotate: 0 }}
          whileHover={{ rotate: -180 }}
          transition={springConfig.gentle}
        >
          <ChevronLeftIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors" />
        </motion.div>
      </motion.button>
    </motion.div>
  );
}
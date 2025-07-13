// ABOUTME: Animated mobile sidebar with sophisticated animations using Framer Motion
// ABOUTME: Provides comprehensive mobile navigation with project/timeline switching and tool access

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSearch, 
  faTerminal, 
  faTasks, 
  faFolder
} from '~/interfaces/web/lib/fontawesome';
import { ChevronLeftIcon } from '~/interfaces/web/lib/heroicons';
import { Timeline, Project, Task } from '~/interfaces/web/types';
import { 
  fadeInLeft,
  fadeInUp,
  staggerContainer,
  staggerItem,
  buttonTap,
  hoverLift,
  springConfig,
  scaleIn,
  popIn,
  sidebarVariants,
  modalOverlay
} from '~/interfaces/web/lib/animations';

interface AnimatedMobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: Project;
  projects: Project[];
  currentTimeline: Timeline;
  timelines: Timeline[];
  activeTasks: Task[];
  currentTheme: string;
  availableThemes: Array<{
    name: string;
    colors: { primary: string; secondary: string; accent: string };
  }>;
  onProjectChange: (project: Project) => void;
  onTimelineChange: (timeline: Timeline) => void;
  onThemeChange: (theme: string) => void;
  onTriggerTool: (tool: string) => void;
  onOpenTaskBoard: () => void;
  onOpenFileManager: () => void;
  onOpenTaskDetail: (task: Task) => void;
}

export function AnimatedMobileSidebar({
  isOpen,
  onClose,
  currentProject,
  projects,
  currentTimeline,
  timelines,
  activeTasks,
  currentTheme,
  availableThemes,
  onProjectChange,
  onTimelineChange,
  onThemeChange,
  onTriggerTool,
  onOpenTaskBoard,
  onOpenFileManager,
  onOpenTaskDetail,
}: AnimatedMobileSidebarProps) {
  const quickActions = [
    { 
      icon: faSearch, 
      tool: 'file-find', 
      label: 'Find', 
      color: 'text-blue-500',
      action: () => {
        onTriggerTool('file-find');
        onClose();
      }
    },
    { 
      icon: faTerminal, 
      tool: 'bash', 
      label: 'Run', 
      color: 'text-green-500',
      action: () => {
        onTriggerTool('bash');
        onClose();
      }
    },
    { 
      icon: faTasks, 
      tool: null, 
      label: 'Tasks', 
      color: 'text-purple-500',
      action: () => {
        onOpenTaskBoard();
        onClose();
      }
    },
    { 
      icon: faFolder, 
      tool: null, 
      label: 'Files', 
      color: 'text-orange-500',
      action: () => {
        onOpenFileManager();
        onClose();
      }
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Animated Overlay */}
          <motion.div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden" 
            onClick={onClose}
            variants={modalOverlay}
            initial="initial"
            animate="animate"
            exit="exit"
          />

          {/* Animated Sidebar */}
          <motion.div 
            className="fixed left-0 top-0 h-full w-80 bg-base-100 border-r border-base-300 z-50 lg:hidden overflow-y-auto"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={springConfig.smooth}
          >
            {/* Header */}
            <motion.div 
              className="sticky top-0 bg-base-100 border-b border-base-300 p-4 flex items-center justify-between"
              variants={fadeInUp}
              initial="initial"
              animate="animate"
              transition={{ delay: 0.1 }}
            >
              <motion.div 
                className="flex items-center gap-3"
                whileHover={{ scale: 1.02 }}
                transition={springConfig.gentle}
              >
                <motion.div 
                  className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center overflow-hidden relative shadow-lg"
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
              
              <motion.button 
                onClick={onClose} 
                className="p-2 hover:bg-base-200 rounded-lg transition-colors group"
                whileHover={{ 
                  scale: 1.1,
                  backgroundColor: "rgba(var(--primary), 0.1)",
                  transition: springConfig.snappy 
                }}
                {...buttonTap}
              >
                <motion.div
                  animate={{ rotate: 0 }}
                  whileHover={{ rotate: -180, x: -4 }}
                  transition={springConfig.gentle}
                >
                  <ChevronLeftIcon className="w-6 h-6 text-base-content/60 group-hover:text-base-content transition-colors" />
                </motion.div>
              </motion.button>
            </motion.div>

            {/* Content */}
            <motion.div 
              className="p-4 space-y-6"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              {/* Project Quick Switcher */}
              <motion.div variants={staggerItem}>
                <motion.label 
                  className="text-sm font-medium text-base-content/70 mb-2 block"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  Project
                </motion.label>
                <motion.select
                  className="select select-bordered w-full"
                  value={currentProject.id}
                  onChange={(e) => {
                    const project = projects.find((p) => p.id === parseInt(e.target.value));
                    if (project) onProjectChange(project);
                  }}
                  whileFocus={{ 
                    scale: 1.02,
                    boxShadow: "0 4px 20px rgba(var(--primary), 0.2)",
                    transition: springConfig.gentle 
                  }}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </motion.select>
              </motion.div>

              {/* Timeline Quick Switcher */}
              <motion.div variants={staggerItem}>
                <motion.label 
                  className="text-sm font-medium text-base-content/70 mb-2 block"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  Timeline
                </motion.label>
                <motion.select
                  className="select select-bordered w-full"
                  value={currentTimeline.id}
                  onChange={(e) => {
                    const timeline = [currentTimeline, ...timelines].find(
                      (t) => t.id === parseInt(e.target.value)
                    );
                    if (timeline) onTimelineChange(timeline);
                  }}
                  whileFocus={{ 
                    scale: 1.02,
                    boxShadow: "0 4px 20px rgba(var(--primary), 0.2)",
                    transition: springConfig.gentle 
                  }}
                >
                  <option value={currentTimeline.id}>
                    {currentTimeline.name} ({currentTimeline.agent})
                  </option>
                  {timelines.map((timeline) => (
                    <option key={timeline.id} value={timeline.id}>
                      {timeline.name} ({timeline.agent})
                    </option>
                  ))}
                </motion.select>
              </motion.div>

              {/* Quick Actions */}
              <motion.div variants={staggerItem}>
                <motion.label 
                  className="text-sm font-medium text-base-content/70 mb-2 block"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  Quick Actions
                </motion.label>
                <motion.div 
                  className="grid grid-cols-2 gap-2"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {quickActions.map((action, index) => (
                    <motion.button
                      key={action.label}
                      onClick={action.action}
                      className="btn btn-sm btn-outline relative overflow-hidden group"
                      variants={staggerItem}
                      whileHover={{ 
                        scale: 1.05,
                        borderColor: "rgb(var(--primary))",
                        backgroundColor: "rgba(var(--primary), 0.05)",
                        transition: springConfig.snappy 
                      }}
                      {...buttonTap}
                    >
                      <motion.div
                        className="flex items-center gap-1"
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: index * 0.05 + 0.3 }}
                      >
                        <motion.div
                          whileHover={{ rotate: 10, scale: 1.1 }}
                          transition={springConfig.gentle}
                        >
                          <FontAwesomeIcon 
                            icon={action.icon} 
                            className={`w-4 h-4 ${action.color} group-hover:scale-110 transition-all`} 
                          />
                        </motion.div>
                        <span>{action.label}</span>
                      </motion.div>

                      {/* Ripple effect */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                        initial={{ x: '-100%' }}
                        whileHover={{ x: '100%' }}
                        transition={{ duration: 0.6 }}
                      />
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>

              {/* Active Tasks Preview */}
              <motion.div variants={staggerItem}>
                <motion.div 
                  className="flex items-center justify-between mb-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <label className="text-sm font-medium text-base-content/70">Active Tasks</label>
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
                </motion.div>
                <motion.div 
                  className="space-y-2"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {activeTasks.slice(0, 3).map((task, index) => (
                    <motion.div
                      key={task.id}
                      className="p-3 bg-base-200 rounded-lg border border-base-300 cursor-pointer group"
                      onClick={() => {
                        onOpenTaskDetail(task);
                        onClose();
                      }}
                      variants={staggerItem}
                      {...hoverLift}
                      whileHover={{ 
                        x: 5,
                        backgroundColor: "rgba(var(--primary), 0.05)",
                        borderColor: "rgba(var(--primary), 0.3)",
                        transition: springConfig.snappy
                      }}
                      {...buttonTap}
                    >
                      <motion.h4 
                        className="text-sm font-medium truncate group-hover:text-primary transition-colors"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.1 + 0.4 }}
                      >
                        {task.title}
                      </motion.h4>
                      <motion.div 
                        className="flex items-center gap-2 mt-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 + 0.5 }}
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
                          transition={springConfig.gentle}
                        >
                          {task.priority}
                        </motion.span>
                        <span className="text-xs text-base-content/50">{task.assignee}</span>
                      </motion.div>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>

              {/* Theme Selector */}
              <motion.div variants={staggerItem}>
                <motion.label 
                  className="text-sm font-medium text-base-content/70 mb-2 block"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  Theme
                </motion.label>
                <motion.div 
                  className="grid grid-cols-3 gap-2"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {availableThemes.slice(0, 6).map((theme, index) => (
                    <motion.button
                      key={theme.name}
                      onClick={() => onThemeChange(theme.name)}
                      className={`relative p-3 rounded-lg border-2 transition-all group ${
                        currentTheme === theme.name ? 'border-primary' : 'border-base-300'
                      }`}
                      variants={staggerItem}
                      whileHover={{ 
                        scale: 1.05,
                        borderColor: "rgb(var(--primary))",
                        boxShadow: "0 4px 15px rgba(var(--primary), 0.2)",
                        transition: springConfig.snappy 
                      }}
                      {...buttonTap}
                    >
                      <motion.div 
                        className="w-full h-6 rounded flex overflow-hidden"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.05 + 0.4, ...springConfig.bouncy }}
                      >
                        <motion.div 
                          className="flex-1" 
                          style={{ backgroundColor: theme.colors.primary }}
                          whileHover={{ scale: 1.1 }}
                          transition={springConfig.gentle}
                        />
                        <motion.div
                          className="flex-1"
                          style={{ backgroundColor: theme.colors.secondary }}
                          whileHover={{ scale: 1.1 }}
                          transition={{ ...springConfig.gentle, delay: 0.05 }}
                        />
                        <motion.div 
                          className="flex-1" 
                          style={{ backgroundColor: theme.colors.accent }}
                          whileHover={{ scale: 1.1 }}
                          transition={{ ...springConfig.gentle, delay: 0.1 }}
                        />
                      </motion.div>
                      <motion.span 
                        className="text-xs text-center block mt-1 capitalize group-hover:text-primary transition-colors"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.05 + 0.5 }}
                      >
                        {theme.name}
                      </motion.span>

                      {/* Selection indicator */}
                      {currentTheme === theme.name && (
                        <motion.div
                          className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={springConfig.bouncy}
                        >
                          <motion.div
                            className="w-2 h-2 bg-primary-content rounded-full"
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          />
                        </motion.div>
                      )}
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
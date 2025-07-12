'use client';

import { useState } from 'react';
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

interface SidebarProps {
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

export function Sidebar({
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
}: SidebarProps) {
  const [conversationsExpanded, setConversationsExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  if (!isOpen) {
    // Collapsed sidebar
    return (
      <div className="hidden lg:flex bg-base-100 border-r border-base-300 flex-col relative transition-all duration-300 w-16">
        <div className="flex flex-col items-center py-4 space-y-6">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-lg">
            <span className="text-primary-content font-bold text-lg">L</span>
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={() => onTriggerTool('file-find')}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              title="Find Files"
            >
              <FontAwesomeIcon icon={faSearch} className="w-5 h-5 text-base-content/60" />
            </button>
            <button
              onClick={() => onTriggerTool('bash')}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              title="Terminal"
            >
              <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-base-content/60" />
            </button>
            <button
              onClick={onOpenTaskBoard}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              title="Tasks"
            >
              <FontAwesomeIcon icon={faTasks} className="w-5 h-5 text-base-content/60" />
            </button>
            <button
              onClick={onOpenFileManager}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              title="Files"
            >
              <FontAwesomeIcon icon={faFolder} className="w-5 h-5 text-base-content/60" />
            </button>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
        >
          <ChevronRightIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors" />
        </button>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex bg-base-100 border-r border-base-300 flex-col relative transition-all duration-300 w-[350px]">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-base-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg overflow-hidden relative">
                <div className="absolute inset-0 opacity-20">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px), repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)`,
                    }}
                  ></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 rounded transform rotate-45"></div>
                  <div className="absolute w-3 h-3 border border-white/20 rounded transform rotate-45"></div>
                </div>
              </div>
              <h1 className="font-semibold text-base-content">Lace</h1>
            </div>
          </div>
        </div>

        {/* Project Selector */}
        <div className="p-4 border-b border-base-300">
          <div className="dropdown w-full">
            <div tabIndex={0} role="button" className="btn btn-ghost justify-between w-full">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faFolderOpen} className="w-4 h-4 text-teal-600" />
                <span className="truncate">{currentProject.name}</span>
              </div>
              <ChevronDownIcon className="w-4 h-4" />
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full"
            >
              {projects.map((project) => (
                <li key={project.id}>
                  <a onClick={() => onProjectChange(project)}>{project.name}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Conversations */}
          <div className="p-4">
            <button
              onClick={() => setConversationsExpanded(!conversationsExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
            >
              <span className="text-sm font-medium text-base-content">Agent Chats</span>
              {conversationsExpanded ? (
                <ChevronDownIcon className="w-4 h-4 transition-transform text-base-content/60" />
              ) : (
                <ChevronRightIcon className="w-4 h-4 transition-transform text-base-content/60" />
              )}
            </button>

            {conversationsExpanded && (
              <div className="mt-2 space-y-1">
                <div className="p-3 bg-teal-500/10 border border-teal-500/30 rounded-lg text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                    <span>{currentTimeline.name}</span>
                    <span
                      className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
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
                {timelines.map((timeline) => (
                  <button
                    key={timeline.id}
                    onClick={() => onTimelineChange(timeline)}
                    className="w-full text-left p-3 hover:bg-base-200 rounded-lg text-sm text-base-content/80 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faComments} className="w-4 h-4 text-base-content/40" />
                        <span className="truncate">{timeline.name}</span>
                      </div>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          timeline.agent === 'Claude'
                            ? 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                            : timeline.agent === 'GPT-4'
                              ? 'bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                              : timeline.agent === 'Gemini'
                                ? 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-base-content/10 text-base-content/60'
                        }`}
                      >
                        {timeline.agent}
                      </span>
                    </div>
                  </button>
                ))}
                <button
                  onClick={onNewTimeline}
                  className="w-full p-3 border border-base-300 rounded-lg text-sm text-center hover:bg-base-200 transition-colors"
                >
                  <div className="flex items-center justify-center gap-2">
                    <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                    New Timeline
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Tasks */}
          <div className="p-4 border-t border-base-300">
            <button
              onClick={() => setTasksExpanded(!tasksExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
            >
              <span className="text-sm font-medium text-base-content">Tasks</span>
              <div className="flex items-center gap-2">
                <span className="badge badge-sm bg-teal-500 text-white border-0">
                  {activeTasks.length}
                </span>
                {tasksExpanded ? (
                  <ChevronDownIcon className="w-4 h-4 transition-transform text-base-content/60" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 transition-transform text-base-content/60" />
                )}
              </div>
            </button>

            {tasksExpanded && (
              <div className="mt-2 space-y-2">
                {activeTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="task-card p-3 bg-base-200 rounded-lg border border-base-300 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => onOpenTask(task)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-base-content truncate">
                          {task.title}
                        </h4>
                        <p className="text-xs text-base-content/60 mt-1">{task.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              task.priority === 'high'
                                ? 'bg-red-900/20 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                : task.priority === 'medium'
                                  ? 'bg-yellow-900/20 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  : 'bg-base-content/10 text-base-content/60'
                            }`}
                          >
                            {task.priority}
                          </span>
                          <span className="text-xs text-base-content/50">{task.assignee}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button className="w-full p-2 text-xs text-base-content/60 hover:text-base-content hover:bg-base-200 rounded transition-colors">
                  View All Tasks
                </button>
              </div>
            )}
          </div>

          {/* Files */}
          <div className="p-4 border-t border-base-300">
            <button
              onClick={() => setFilesExpanded(!filesExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
            >
              <span className="text-sm font-medium text-base-content">Files</span>
              {filesExpanded ? (
                <ChevronDownIcon className="w-4 h-4 transition-transform text-base-content/60" />
              ) : (
                <ChevronRightIcon className="w-4 h-4 transition-transform text-base-content/60" />
              )}
            </button>

            {filesExpanded && (
              <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                {recentFiles.map((file) => (
                  <button
                    key={file.path}
                    className="w-full text-left p-3 hover:bg-base-200 rounded-lg text-sm text-base-content/80 flex items-center transition-colors group"
                    onClick={() => onOpenFile(file)}
                  >
                    <FontAwesomeIcon icon={faFileCode} className="w-4 h-4 mr-2 text-base-content/40 group-hover:text-teal-600" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{file.name}</div>
                      <div className="text-xs text-base-content/50 truncate">{file.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="p-4 border-t border-base-300">
            <button
              onClick={() => setSettingsExpanded(!settingsExpanded)}
              className="flex items-center justify-between w-full text-left p-3 hover:bg-base-200 rounded-lg transition-colors"
            >
              <span className="text-sm font-medium text-base-content">Settings</span>
              {settingsExpanded ? (
                <ChevronDownIcon className="w-4 h-4 transition-transform text-base-content/60" />
              ) : (
                <ChevronRightIcon className="w-4 h-4 transition-transform text-base-content/60" />
              )}
            </button>

            {settingsExpanded && (
              <div className="mt-2 space-y-4">
                <div className="p-4 bg-base-200 rounded-lg space-y-4">
                  <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />

                  <div className="pt-2 border-t border-base-300">
                    <button
                      onClick={onOpenRulesFile}
                      className="w-full p-2 text-sm text-center border border-base-300 rounded hover:bg-base-300 transition-colors"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                        Edit Rules
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Account Section */}
        <AccountDropdown />
      </div>

      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
      >
        <ChevronLeftIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors" />
      </button>
    </div>
  );
}

// ABOUTME: Mobile sidebar component with project/timeline switchers and tool shortcuts
// ABOUTME: Slide-out overlay design optimized for touch interaction on mobile devices

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSearch, 
  faTerminal, 
  faTasks, 
  faFolder,
  faChevronLeft
} from '~/interfaces/web/lib/fontawesome';
import { Timeline, Project, Task } from '~/interfaces/web/types';

interface MobileSidebarProps {
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

export function MobileSidebar({
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
}: MobileSidebarProps) {
  if (!isOpen) return null;

  return (
    <React.Fragment>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />

      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-80 bg-base-100 border-r border-base-300 z-50 lg:hidden overflow-y-auto transform transition-all duration-300 ease-out animate-slide-in-left">
        {/* Header */}
        <div className="sticky top-0 bg-base-100 border-b border-base-300 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center overflow-hidden relative">
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
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-base-200 rounded-lg transition-colors group"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="w-6 h-6 transition-transform group-hover:-translate-x-1" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Project Quick Switcher */}
          <div>
            <label className="text-sm font-medium text-base-content/70 mb-2 block">Project</label>
            <select
              className="select select-bordered w-full"
              value={currentProject.id}
              onChange={(e) => {
                const project = projects.find((p) => p.id === parseInt(e.target.value));
                if (project) onProjectChange(project);
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Timeline Quick Switcher */}
          <div>
            <label className="text-sm font-medium text-base-content/70 mb-2 block">Timeline</label>
            <select
              className="select select-bordered w-full"
              value={currentTimeline.id}
              onChange={(e) => {
                const timeline = [currentTimeline, ...timelines].find(
                  (t) => t.id === parseInt(e.target.value)
                );
                if (timeline) onTimelineChange(timeline);
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
            </select>
          </div>

          {/* Quick Actions */}
          <div>
            <label className="text-sm font-medium text-base-content/70 mb-2 block">
              Quick Actions
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  onTriggerTool('file-find');
                  onClose();
                }}
                className="btn btn-sm btn-outline"
              >
                <FontAwesomeIcon icon={faSearch} className="w-4 h-4 mr-1" />
                Find
              </button>
              <button
                onClick={() => {
                  onTriggerTool('bash');
                  onClose();
                }}
                className="btn btn-sm btn-outline"
              >
                <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 mr-1" />
                Run
              </button>
              <button
                onClick={() => {
                  onOpenTaskBoard();
                  onClose();
                }}
                className="btn btn-sm btn-outline"
              >
                <FontAwesomeIcon icon={faTasks} className="w-4 h-4 mr-1" />
                Tasks
              </button>
              <button
                onClick={() => {
                  onOpenFileManager();
                  onClose();
                }}
                className="btn btn-sm btn-outline"
              >
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4 mr-1" />
                Files
              </button>
            </div>
          </div>

          {/* Active Tasks Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-base-content/70">Active Tasks</label>
              <span className="badge badge-sm bg-teal-500 text-white border-0">
                {activeTasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {activeTasks.slice(0, 3).map((task) => (
                <div
                  key={task.id}
                  className="p-3 bg-base-200 rounded-lg border border-base-300 cursor-pointer"
                  onClick={() => {
                    onOpenTaskDetail(task);
                    onClose();
                  }}
                >
                  <h4 className="text-sm font-medium truncate">{task.title}</h4>
                  <div className="flex items-center gap-2 mt-1">
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
              ))}
            </div>
          </div>

          {/* Theme Selector */}
          <div>
            <label className="text-sm font-medium text-base-content/70 mb-2 block">Theme</label>
            <div className="grid grid-cols-3 gap-2">
              {availableThemes.slice(0, 6).map((theme) => (
                <button
                  key={theme.name}
                  onClick={() => onThemeChange(theme.name)}
                  className={`relative p-3 rounded-lg border-2 transition-all ${
                    currentTheme === theme.name ? 'border-primary' : 'border-base-300'
                  }`}
                >
                  <div className="w-full h-6 rounded flex overflow-hidden">
                    <div className="flex-1" style={{ backgroundColor: theme.colors.primary }}></div>
                    <div
                      className="flex-1"
                      style={{ backgroundColor: theme.colors.secondary }}
                    ></div>
                    <div className="flex-1" style={{ backgroundColor: theme.colors.accent }}></div>
                  </div>
                  <span className="text-xs text-center block mt-1 capitalize">{theme.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}
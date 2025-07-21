// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faFolder, faComments, faRobot, faPlus } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { TimelineView } from '@/components/timeline/TimelineView';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';
import { useTheme } from '@/components/providers/ThemeProvider';
import type {
  Session,
  ThreadId,
  SessionEvent,
  ToolApprovalRequestData,
  ApprovalDecision,
  Agent,
  SessionsResponse,
  SessionResponse,
  ProjectInfo,
} from '@/types/api';
import { isApiError } from '@/types/api';
import { convertSessionEventsToTimeline } from '@/lib/timeline-converter';
import { getAllEventTypes } from '@/types/events';

export function LaceApp() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // UI State (from AnimatedLaceApp but remove demo data)
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  // Business Logic State (from current app/page.tsx)
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<ThreadId | null>(null);
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<Session | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<ThreadId | undefined>(undefined);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequestData | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  // Convert SessionEvents to TimelineEntries for the design system
  const timelineEntries = useMemo(() => {
    const entries = convertSessionEventsToTimeline(events, {
      agents: selectedSessionDetails?.agents || [],
      selectedAgent,
    });
    
    return entries;
  }, [events, selectedSessionDetails?.agents, selectedAgent]);

  // Project loading function
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      const data: unknown = await res.json();
      
      // Type guard for API response
      if (typeof data === 'object' && data !== null && 'projects' in data) {
        const projectsData = data as { projects: ProjectInfo[] };
        setProjects(projectsData.projects);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
    setLoadingProjects(false);
  }, []);

  const loadSessions = useCallback(async () => {
    if (!selectedProject) {
      setSessions([]);
      return;
    }

    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load sessions:', data.error);
        return;
      }

      const sessionsData = data as SessionsResponse;
      setSessions(sessionsData.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, [selectedProject]);

  // Load projects on mount
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadSessionDetails = useCallback(async (sessionId: ThreadId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load session details:', data.error);
        return;
      }

      const sessionResponse = data as SessionResponse;
      setSelectedSessionDetails(sessionResponse.session);
    } catch (error) {
      console.error('Failed to load session details:', error);
    }
  }, []);

  // Load sessions when project is selected
  useEffect(() => {
    void loadSessions();
  }, [selectedProject, loadSessions]);

  // Load session details when session is selected
  useEffect(() => {
    if (!selectedSession) {
      setSelectedSessionDetails(null);
      return;
    }
    void loadSessionDetails(selectedSession);
  }, [selectedSession, loadSessionDetails]);

  // Handle project selection
  const handleProjectSelect = (project: { id: string }) => {
    setSelectedProject(project.id);
    // Clear session selection when switching projects
    setSelectedSession(null);
    setSelectedAgent(undefined);
    setEvents([]);
  };

  // Connect to SSE when agent selected
  useEffect(() => {
    if (!selectedAgent) {
      setEvents([]);
      return;
    }

    // Clear events when switching agents
    setEvents([]);

    // Load conversation history for the selected agent
    void loadConversationHistory(selectedAgent);

    const eventSource = new EventSource(`/api/sessions/${selectedAgent}/events/stream`);

    // Store event listeners for cleanup
    const eventListeners = new Map<string, (event: MessageEvent) => void>();

    // Listen to all event types
    const eventTypes = getAllEventTypes();

    eventTypes.forEach((eventType) => {
      const listener = (event: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(String(event.data));

          // Type guard for event structure
          if (typeof data === 'object' && data !== null && 'type' in data) {
            const eventData = data as { type: string; data: unknown; timestamp?: string | Date };

            // Handle approval requests separately
            if (eventData.type === 'TOOL_APPROVAL_REQUEST') {
              setApprovalRequest(eventData.data as ToolApprovalRequestData);
            } else {
              // Convert timestamp from string to Date if needed
              const timestamp = eventData.timestamp 
                ? (typeof eventData.timestamp === 'string' ? new Date(eventData.timestamp) : eventData.timestamp)
                : new Date();

              // Create the session event with proper type narrowing
              const sessionEvent = {
                ...eventData,
                threadId: selectedAgent as ThreadId,
                timestamp
              } as SessionEvent;

              setEvents((prev) => [...prev, sessionEvent]);
            }
          }
        } catch (error) {
          console.error('Failed to parse event:', error);
        }
      };

      eventListeners.set(eventType, listener);
      eventSource.addEventListener(eventType, listener);
    });

    const connectionListener = (_event: Event) => {
      const connectionEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedAgent as ThreadId,
        timestamp: new Date(),
        data: { content: 'Connected to agent stream' },
      };
      setEvents((prev) => [...prev, connectionEvent]);
    };

    eventSource.addEventListener('connection', connectionListener);

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      const errorEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedAgent as ThreadId,
        timestamp: new Date(),
        data: { content: 'Connection lost' },
      };
      setEvents((prev) => [...prev, errorEvent]);
    };

    return () => {
      // Remove all event listeners before closing
      eventListeners.forEach((listener, eventType) => {
        eventSource.removeEventListener(eventType, listener);
      });
      eventSource.removeEventListener('connection', connectionListener);
      eventSource.close();
    };
  }, [selectedAgent, loadSessionDetails]);

  async function loadConversationHistory(sessionId: ThreadId) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/history`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load conversation history:', data.error);
        return;
      }

      const historyData = data as { events: Array<SessionEvent & { timestamp: string }> };
      
      // Convert string timestamps to Date objects
      const eventsWithDateTimestamps: SessionEvent[] = (historyData.events || []).map(event => ({
        ...event,
        timestamp: new Date(event.timestamp)
      }));
      
      setEvents(eventsWithDateTimestamps);
    } catch (error) {
      console.error('Failed to load conversation history:', error);
    }
  }

  async function sendMessage() {
    if (!selectedAgent || !message.trim()) return;

    setSendingMessage(true);
    try {
      const res = await fetch(`/api/threads/${selectedAgent}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (res.ok) {
        setMessage('');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
    setSendingMessage(false);
  }

  // Session creation function
  const createSession = async () => {
    if (!selectedProject || !sessionName.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName.trim() }),
      });
      
      if (res.ok) {
        setSessionName('');
        setCreatingSession(false);
        // Reload sessions to show the new one
        void loadSessions();
      } else {
        console.error('Failed to create session');
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
    setLoading(false);
  };

  const cancelSessionCreation = () => {
    setCreatingSession(false);
    setSessionName('');
  };

  // Handle session selection - auto-select coordinator agent
  const handleSessionSelect = (sessionId: string) => {
    const threadId = sessionId as ThreadId;
    setSelectedSession(threadId);
    // Coordinator agent shares the session's threadId
    setSelectedAgent(threadId);
    setEvents([]);
  };

  // Handle agent selection within a session
  const handleAgentSelect = (agentThreadId: string) => {
    setSelectedAgent(agentThreadId as ThreadId);
    setEvents([]);
  };

  // Convert projects to format expected by Sidebar
  const currentProject = selectedProject 
    ? projects.find(p => p.id === selectedProject) || { id: '', name: 'Unknown', workingDirectory: '/' }
    : { id: '', name: 'No project selected', workingDirectory: '/' };

  const projectsForSidebar = projects.map(p => ({
    id: p.id,
    name: p.name,
    workingDirectory: p.workingDirectory,
    description: p.description,
    isArchived: false,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    sessionCount: 0,
  }));

  // These timeline variables are no longer needed with the new composable sidebar

  return (
    <motion.div
      className="flex h-screen bg-base-200 text-base-content font-sans overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Mobile Sidebar - copy structure from AnimatedLaceApp */}
      <AnimatePresence>
        {showMobileNav && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <MobileSidebar
              isOpen={showMobileNav}
              onClose={() => setShowMobileNav(false)}
              currentTheme={theme}
              onThemeChange={setTheme}
            >
              {/* Projects Section - Always show, collapsed when project selected */}
              <SidebarSection 
                title="Projects" 
                icon={faFolder}
                defaultCollapsed={!!selectedProject}
                collapsible={true}
              >
                {projectsForSidebar.map((project) => (
                  <SidebarItem
                    key={project.id}
                    active={selectedProject === project.id}
                    onClick={() => {
                      handleProjectSelect(project);
                      setShowMobileNav(false); // Close mobile nav after selection
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                        <span>{project.name}</span>
                      </div>
                      {project.sessionCount ? (
                        <span className="text-xs text-base-content/40">
                          {project.sessionCount}
                        </span>
                      ) : null}
                    </div>
                  </SidebarItem>
                ))}
              </SidebarSection>

              {/* Sessions Section - Show when project selected, collapsed when session selected */}
              {selectedProject && (
                <SidebarSection 
                  title="Sessions" 
                  icon={faComments}
                  defaultCollapsed={!!selectedSession}
                  collapsible={true}
                >
                  {sessions.map((session) => (
                    <SidebarItem
                      key={session.id}
                      active={selectedSession === session.id}
                      onClick={() => {
                        handleSessionSelect(session.id);
                        setShowMobileNav(false);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faComments} className="w-4 h-4" />
                          <span>{session.name}</span>
                        </div>
                        <span className="text-xs text-base-content/40">
                          {session.agents?.length || 0} agents
                        </span>
                      </div>
                    </SidebarItem>
                  ))}
                  <SidebarButton onClick={() => {
                    setCreatingSession(true);
                    setShowMobileNav(false);
                  }}>
                    <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                    New Session
                  </SidebarButton>
                </SidebarSection>
              )}

              {/* Agents Section - Show when session selected, stay open */}
              {selectedSession && selectedSessionDetails && (
                <SidebarSection 
                  title="Agents" 
                  icon={faRobot}
                  defaultCollapsed={false}
                  collapsible={true}
                >
                  {selectedSessionDetails.agents?.map((agent) => (
                    <SidebarItem
                      key={agent.threadId}
                      active={selectedAgent === agent.threadId}
                      onClick={() => {
                        handleAgentSelect(agent.threadId);
                        setShowMobileNav(false);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
                          <span>{agent.name}</span>
                        </div>
                        <span className="text-xs text-base-content/40">
                          {agent.provider}
                        </span>
                      </div>
                    </SidebarItem>
                  )) || []}
                  <SidebarButton 
                    variant="secondary" 
                    onClick={() => {
                      const name = prompt('Enter agent name:');
                      if (name) {
                        // TODO: Implement agent spawning
                        console.log('Would spawn agent:', name, 'in session:', selectedSession);
                      }
                    }}
                  >
                    <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                    New Agent
                  </SidebarButton>
                </SidebarSection>
              )}
            </MobileSidebar>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar - copy structure from AnimatedLaceApp */}
      <motion.div
        initial={{ x: showDesktopSidebar ? 0 : -320 }}
        animate={{ x: showDesktopSidebar ? 0 : -320 }}
        className="hidden lg:block"
      >
        <Sidebar
          isOpen={showDesktopSidebar}
          onToggle={() => setShowDesktopSidebar(!showDesktopSidebar)}
          currentTheme={theme}
          onThemeChange={setTheme}
        >
          {/* Projects Section - Always show, collapsed when project selected */}
          <SidebarSection 
            title="Projects" 
            icon={faFolder} 
            defaultCollapsed={!!selectedProject}
            collapsible={true}
          >
            {projectsForSidebar.map((project) => (
              <SidebarItem
                key={project.id}
                active={selectedProject === project.id}
                onClick={() => handleProjectSelect(project)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                    <span>{project.name}</span>
                  </div>
                  {project.sessionCount ? (
                    <span className="text-xs text-base-content/40">
                      {project.sessionCount}
                    </span>
                  ) : null}
                </div>
              </SidebarItem>
            ))}
          </SidebarSection>

          {/* Sessions Section - Show when project selected, collapsed when session selected */}
          {selectedProject && (
            <SidebarSection 
              title="Sessions" 
              icon={faComments}
              defaultCollapsed={!!selectedSession}
              collapsible={true}
            >
              {sessions.map((session) => (
                <SidebarItem
                  key={session.id}
                  active={selectedSession === session.id}
                  onClick={() => handleSessionSelect(session.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faComments} className="w-4 h-4" />
                      <span>{session.name}</span>
                    </div>
                    <span className="text-xs text-base-content/40">
                      {session.agents?.length || 0} agents
                    </span>
                  </div>
                </SidebarItem>
              ))}
              <SidebarButton onClick={() => setCreatingSession(true)}>
                <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                New Session
              </SidebarButton>
            </SidebarSection>
          )}

          {/* Agents Section - Show when session selected, stay open */}
          {selectedSession && selectedSessionDetails && (
            <SidebarSection 
              title="Agents" 
              icon={faRobot}
              defaultCollapsed={false}
              collapsible={true}
            >
              {selectedSessionDetails.agents?.map((agent) => (
                <SidebarItem
                  key={agent.threadId}
                  active={selectedAgent === agent.threadId}
                  onClick={() => handleAgentSelect(agent.threadId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
                      <span>{agent.name}</span>
                    </div>
                    <span className="text-xs text-base-content/40">
                      {agent.provider}
                    </span>
                  </div>
                </SidebarItem>
              )) || []}
              <SidebarButton 
                variant="secondary" 
                onClick={() => {
                  const name = prompt('Enter agent name:');
                  if (name) {
                    // TODO: Implement agent spawning
                    console.log('Would spawn agent:', name, 'in session:', selectedSession);
                  }
                }}
              >
                <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                New Agent
              </SidebarButton>
            </SidebarSection>
          )}
        </Sidebar>
      </motion.div>

      {/* Main Content - copy structure from AnimatedLaceApp */}
      <motion.div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <motion.div className="bg-transparent sticky top-0 z-30">
          <motion.div className="flex items-center justify-between p-4 lg:px-6">
            <motion.div className="flex items-center gap-3">
              <motion.button
                onClick={() => setShowMobileNav(true)}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">
                  {selectedProject ? currentProject.name : 'Select a Project'}
                </h1>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Content Area */}
        <div className="flex-1 flex items-center justify-center text-base-content p-6">
          {loadingProjects ? (
            <div className="flex items-center gap-2">
              <div className="loading loading-spinner loading-md"></div>
              <span>Loading projects...</span>
            </div>
          ) : selectedProject ? (
            creatingSession ? (
              // Session creation form
              <div className="w-full max-w-md">
                <div className="bg-base-100 rounded-lg shadow-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Create New Session</h2>
                  <p className="text-base-content/60 mb-6">
                    Create a new session in <strong>{currentProject.name}</strong>
                  </p>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="label">
                        <span className="label-text">Session Name</span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        value={sessionName}
                        onChange={(e) => setSessionName(e.target.value)}
                        placeholder="Enter session name..."
                        autoFocus
                      />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                      <button 
                        className="btn btn-primary flex-1"
                        onClick={createSession}
                        disabled={!sessionName.trim() || loading}
                      >
                        {loading ? (
                          <>
                            <div className="loading loading-spinner loading-sm"></div>
                            Creating...
                          </>
                        ) : (
                          'Create Session'
                        )}
                      </button>
                      <button 
                        className="btn btn-ghost flex-1"
                        onClick={cancelSessionCreation}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedAgent ? (
              <div className="text-center space-y-2">
                <h2 className="text-lg font-medium">
                  Agent: {selectedSessionDetails?.agents?.find(a => a.threadId === selectedAgent)?.name || 'Unknown Agent'}
                </h2>
                <p className="text-base-content/60">Conversation and tools will be shown here</p>
                <div className="text-sm text-base-content/40">
                  Agent ID: {selectedAgent}
                </div>
              </div>
            ) : selectedSession ? (
              <div className="text-center space-y-2">
                <h2 className="text-lg font-medium">Session: {sessions.find(s => s.id === selectedSession)?.name}</h2>
                <p className="text-base-content/60">Select an agent from the sidebar to continue</p>
                <div className="text-sm text-base-content/40">
                  {selectedSessionDetails?.agents?.length || 0} agent{(selectedSessionDetails?.agents?.length || 0) !== 1 ? 's' : ''} available
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center space-y-2">
                <h2 className="text-lg font-medium">Project: {currentProject.name}</h2>
                <p className="text-base-content/60">No sessions found</p>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => setCreatingSession(true)}
                >
                  Create Session
                </button>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <h2 className="text-lg font-medium">Project: {currentProject.name}</h2>
                <p className="text-base-content/60">Select a session from the sidebar to continue</p>
                <div className="text-sm text-base-content/40">
                  {sessions.length} session{sessions.length !== 1 ? 's' : ''} available
                </div>
              </div>
            )
          ) : projects.length === 0 ? (
            <div className="text-center space-y-2">
              <h2 className="text-lg font-medium">No Projects Found</h2>
              <p className="text-base-content/60">Create a project to get started</p>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <h2 className="text-lg font-medium">Select a Project</h2>
              <p className="text-base-content/60">Choose a project from the sidebar to continue</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faFolder, faComments, faRobot, faPlus, faCog } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { TimelineView } from '@/components/timeline/TimelineView';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
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
  ProviderInfo,
  ProvidersResponse,
  CreateAgentRequest,
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
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
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

  // Provider loading function
  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await fetch('/api/providers');
      const data: unknown = await res.json();
      
      if (isApiError(data)) {
        console.error('Failed to load providers:', data.error);
        return;
      }

      const providersData = data as ProvidersResponse;
      setProviders(providersData.providers || []);
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
    setLoadingProviders(false);
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

  // Load projects and providers on mount
  useEffect(() => {
    void loadProjects();
    void loadProviders();
  }, [loadProjects, loadProviders]);

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

    // Load conversation history for the session (contains all agent events)
    void loadConversationHistory(selectedSession);

    const eventSource = new EventSource(`/api/sessions/${selectedSession}/events/stream`);

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
  }, [selectedAgent, selectedSession]);

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

  // Handle tool approval decision
  const handleApprovalDecision = async (decision: ApprovalDecision) => {
    if (!approvalRequest) return;

    try {
      const res = await fetch(`/api/approvals/${approvalRequest.requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (res.ok) {
        setApprovalRequest(null);
      } else {
        console.error('Failed to submit approval decision');
      }
    } catch (error) {
      console.error('Failed to submit approval decision:', error);
    }
  };

  // Handle approval timeout
  const handleApprovalTimeout = () => {
    void handleApprovalDecision(ApprovalDecision.DENY);
  };

  // Session creation function with configuration
  const handleSessionCreate = async (sessionData: { 
    name: string; 
    description?: string; 
    configuration?: Record<string, unknown> 
  }) => {
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      });
      
      if (res.ok) {
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

  // Agent creation function
  const handleAgentCreate = async (sessionId: string, agentData: CreateAgentRequest) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });
      
      if (res.ok) {
        // Reload session details to show the new agent
        void loadSessionDetails(sessionId as ThreadId);
      } else {
        console.error('Failed to create agent');
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
    setLoading(false);
  };

  // Legacy session creation (for backward compatibility)
  const createSession = async () => {
    if (!selectedProject || !sessionName.trim()) return;
    
    await handleSessionCreate({ name: sessionName.trim() });
    setSessionName('');
    setCreatingSession(false);
  };

  const cancelSessionCreation = () => {
    setCreatingSession(false);
    setSessionName('');
  };

  // Handle session selection - load session details but don't auto-select agent
  const handleSessionSelect = (sessionId: string) => {
    const threadId = sessionId as ThreadId;
    setSelectedSession(threadId);
    // Don't automatically select an agent - let user choose
    setSelectedAgent(undefined);
    setEvents([]);
  };

  // Handle agent selection within a session
  const handleAgentSelect = (agentThreadId: string) => {
    setSelectedAgent(agentThreadId as ThreadId);
    setEvents([]);
  };

  // Handle project updates (archive/unarchive/edit)
  const handleProjectUpdate = async (projectId: string, updates: { isArchived?: boolean; name?: string; description?: string; workingDirectory?: string; configuration?: Record<string, unknown> }) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      
      if (res.ok) {
        // Reload projects to reflect the changes
        void loadProjects();
      } else {
        console.error('Failed to update project');
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
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
    isArchived: p.isArchived || false,
    createdAt: new Date(p.createdAt),
    lastUsedAt: new Date(p.lastUsedAt),
    sessionCount: p.sessionCount || 0,
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
              {/* Current Project - Show only when project selected */}
              {selectedProject && (
                <SidebarSection 
                  title="Current Project" 
                  icon={faFolder}
                  defaultCollapsed={false}
                  collapsible={false}
                >
                  <div className="px-3 py-2 bg-base-50 rounded border border-base-200">
                    <div className="flex items-center gap-2 mb-1">
                      <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                      <span className="font-medium text-base-content truncate">
                        {currentProject.name}
                      </span>
                    </div>
                    <div className="text-xs text-base-content/60 truncate">
                      {currentProject.description}
                    </div>
                    <div className="text-xs text-base-content/50 mt-1">
                      {sessions.length} sessions
                    </div>
                  </div>
                  
                  {/* Switch Project Button */}
                  <SidebarButton
                    onClick={() => {
                      setSelectedProject(null);
                      setSelectedSession(null);
                      setSelectedAgent(undefined);
                      setEvents([]);
                      setShowMobileNav(false);
                    }}
                    variant="ghost"
                  >
                    <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                    Switch Project
                  </SidebarButton>
                </SidebarSection>
              )}

              {/* Session Management - Show session context and agent selection */}
              {selectedSessionDetails && (
                <SidebarSection 
                  title="Current Session" 
                  icon={faComments}
                  defaultCollapsed={false}
                  collapsible={false}
                >
                  {/* Session Info */}
                  <div className="px-3 py-2 bg-base-50 rounded border border-base-200 mb-2">
                    <div className="text-sm font-medium text-base-content truncate">
                      {selectedSessionDetails.name}
                    </div>
                    <div className="text-xs text-base-content/60">
                      {selectedSessionDetails.agents?.length || 0} agents available
                    </div>
                  </div>

                  {/* Back to Session Config */}
                  <SidebarButton
                    onClick={() => {
                      setSelectedAgent(undefined);
                      setEvents([]);
                      setShowMobileNav(false);
                    }}
                    variant="ghost"
                  >
                    <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                    Configure Session
                  </SidebarButton>

                  {/* Agent Selection */}
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
                          <FontAwesomeIcon 
                            icon={faRobot} 
                            className={`w-4 h-4 ${
                              selectedAgent === agent.threadId ? 'text-primary' : 'text-base-content/60'
                            }`} 
                          />
                          <span className="font-medium">{agent.name}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-base-content/60">
                            {agent.provider}
                          </span>
                          <span className={`text-xs badge badge-xs ${
                            agent.status === 'idle' ? 'badge-success' :
                            agent.status === 'busy' ? 'badge-warning' :
                            'badge-neutral'
                          }`}>
                            {agent.status}
                          </span>
                        </div>
                      </div>
                    </SidebarItem>
                  )) || []}
                </SidebarSection>
              )}
            </MobileSidebar>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block flex-shrink-0">
        <Sidebar
          isOpen={showDesktopSidebar}
          onToggle={() => setShowDesktopSidebar(!showDesktopSidebar)}
          currentTheme={theme}
          onThemeChange={setTheme}
        >
          {/* Current Project - Show only when project selected */}
          {selectedProject && (
            <SidebarSection 
              title="Current Project" 
              icon={faFolder} 
              defaultCollapsed={false}
              collapsible={false}
            >
              <div className="px-3 py-2 bg-base-50 rounded border border-base-200">
                <div className="flex items-center gap-2 mb-1">
                  <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                  <span className="font-medium text-base-content truncate">
                    {currentProject.name}
                  </span>
                </div>
                <div className="text-xs text-base-content/60 truncate">
                  {currentProject.description}
                </div>
                <div className="text-xs text-base-content/50 mt-1">
                  {sessions.length} sessions
                </div>
              </div>
              
              {/* Switch Project Button */}
              <SidebarButton
                onClick={() => {
                  setSelectedProject(null);
                  setSelectedSession(null);
                  setSelectedAgent(undefined);
                  setEvents([]);
                }}
                variant="ghost"
              >
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
                Switch Project
              </SidebarButton>
            </SidebarSection>
          )}

          {/* Session Management - Show session context and agent selection */}
          {selectedSessionDetails && (
            <SidebarSection 
              title="Current Session" 
              icon={faComments}
              defaultCollapsed={false}
              collapsible={false}
            >
              {/* Session Info */}
              <div className="px-3 py-2 bg-base-50 rounded border border-base-200 mb-2">
                <div className="text-sm font-medium text-base-content truncate">
                  {selectedSessionDetails.name}
                </div>
                <div className="text-xs text-base-content/60">
                  {selectedSessionDetails.agents?.length || 0} agents available
                </div>
              </div>

              {/* Back to Session Config */}
              <SidebarButton
                onClick={() => {
                  setSelectedAgent(undefined);
                  setEvents([]);
                }}
                variant="ghost"
              >
                <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                Configure Session
              </SidebarButton>

              {/* Agent Selection */}
              {selectedSessionDetails.agents?.map((agent) => (
                <SidebarItem
                  key={agent.threadId}
                  active={selectedAgent === agent.threadId}
                  onClick={() => handleAgentSelect(agent.threadId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon 
                        icon={faRobot} 
                        className={`w-4 h-4 ${
                          selectedAgent === agent.threadId ? 'text-primary' : 'text-base-content/60'
                        }`} 
                      />
                      <span className="font-medium">{agent.name}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-base-content/60">
                        {agent.provider}
                      </span>
                      <span className={`text-xs badge badge-xs ${
                        agent.status === 'idle' ? 'badge-success' :
                        agent.status === 'busy' ? 'badge-warning' :
                        'badge-neutral'
                      }`}>
                        {agent.status}
                      </span>
                    </div>
                  </div>
                </SidebarItem>
              )) || []}
            </SidebarSection>
          )}
        </Sidebar>
      </div>

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
        <div className="flex-1 flex flex-col min-h-0 text-base-content">
          {loadingProjects || loadingProviders ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="flex items-center gap-2">
                <div className="loading loading-spinner loading-md"></div>
                <span>Loading...</span>
              </div>
            </div>
          ) : selectedProject ? (
            selectedAgent ? (
              <div className="flex-1 flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
                {/* Conversation Display */}
                <div style={{ height: 'calc(100% - 80px)' }}>
                  <TimelineView
                    entries={timelineEntries}
                    isTyping={sendingMessage}
                    currentAgent={selectedSessionDetails?.agents?.find(a => a.threadId === selectedAgent)?.name || 'Agent'}
                  />
                </div>

                {/* Chat Input */}
                <motion.div
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="flex-shrink-0 bg-base-200 border-t border-base-300 p-4"
                >
                  <EnhancedChatInput
                    value={message}
                    onChange={setMessage}
                    onSubmit={sendMessage}
                    disabled={sendingMessage}
                    isListening={false}
                    onStartVoice={() => {}}
                    onStopVoice={() => {}}
                    placeholder={`Message ${selectedSessionDetails?.agents?.find(a => a.threadId === selectedAgent)?.name || 'agent'}...`}
                  />
                </motion.div>
              </div>
            ) : (
              /* Session Configuration Panel - Main UI for session/agent management */
              <div className="flex-1 p-6">
                <SessionConfigPanel
                  selectedProject={currentProject}
                  sessions={sessions}
                  selectedSession={selectedSessionDetails}
                  providers={providers}
                  onSessionCreate={handleSessionCreate}
                  onSessionSelect={(session) => handleSessionSelect(session.id)}
                  onAgentCreate={handleAgentCreate}
                  loading={loading}
                />
              </div>
            )
          ) : projects.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-medium">No Projects Found</h2>
                <p className="text-base-content/60">Create a project to get started</p>
              </div>
            </div>
          ) : (
            /* Project Selection Panel - When no project selected */
            <div className="flex-1 p-6 min-h-0">
              <ProjectSelectorPanel
                projects={projectsForSidebar}
                selectedProject={currentProject.id ? currentProject : null}
                providers={providers}
                onProjectSelect={handleProjectSelect}
                onProjectUpdate={handleProjectUpdate}
                loading={loadingProjects}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {approvalRequest && (
        <ToolApprovalModal
          request={approvalRequest}
          onDecision={handleApprovalDecision}
          onTimeout={handleApprovalTimeout}
        />
      )}
    </motion.div>
  );
}
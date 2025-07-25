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
  Agent,
  SessionsResponse,
  SessionResponse,
  ProjectInfo,
  ProviderInfo,
  ProvidersResponse,
  CreateAgentRequest,
} from '@/types/api';
import { isApiError, ApprovalDecision } from '@/types/api';
import { convertSessionEventsToTimeline } from '@/lib/timeline-converter';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useSessionEvents } from '@/hooks/useSessionEvents';

export function LaceApp() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // Hash-based routing state (replaces selectedProject, selectedSession, selectedAgent)
  const {
    project: selectedProject,
    session: selectedSession,
    agent: selectedAgent,
    setProject: setSelectedProject,
    setSession: setSelectedSession,
    setAgent: setSelectedAgent,
    isHydrated: urlStateHydrated,
  } = useHashRouter();

  // UI State (from AnimatedLaceApp but remove demo data)
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);
  

  // Business Logic State (from current app/page.tsx)
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<Session | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  // Use session events hook for event management
  const {
    filteredEvents: events,
    pendingApprovals,
    loadingHistory,
    connected,
    clearApprovalRequest,
  } = useSessionEvents(selectedSession, selectedAgent);

  // Convert SessionEvents to TimelineEntries for the design system
  const timelineEntries = useMemo(() => {
    const entries = convertSessionEventsToTimeline(events, {
      agents: selectedSessionDetails?.agents || [],
      selectedAgent: selectedAgent || undefined,
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
    // Hash router automatically clears session/agent when project changes
    setSelectedProject(project.id);
  };


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
  const handleApprovalDecision = async (toolCallId: string, decision: ApprovalDecision) => {
    if (!selectedAgent) return;

    try {
      const res = await fetch(`/api/threads/${selectedAgent}/approvals/${toolCallId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (res.ok) {
        clearApprovalRequest();
      } else {
        console.error('Failed to submit approval decision');
      }
    } catch (error) {
      console.error('Failed to submit approval decision:', error);
    }
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
    // Hash router automatically clears agent when session changes
    setSelectedSession(sessionId as ThreadId);
  };

  // Handle agent selection within a session
  const handleAgentSelect = (agentThreadId: string) => {
    setSelectedAgent(agentThreadId as ThreadId);
  };

  // Handle agent updates - refresh session details to show updated agent info
  const handleAgentUpdate = async () => {
    if (selectedSession) {
      await loadSessionDetails(selectedSession);
    }
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
  // If selectedProject ID doesn't match any actual project, clear the selection
  const foundProject = selectedProject ? projects.find(p => p.id === selectedProject) : null;
  const currentProject = foundProject || { 
    id: '', 
    name: 'No project selected', 
    description: 'Select a project to get started',
    workingDirectory: '/',
    isArchived: false,
    createdAt: new Date(),
    lastUsedAt: new Date()
  };
  
  // Clear invalid project selection from URL  
  // useEffect(() => {
  //   // Clear any project ID that doesn't match loaded projects after loading is complete
  //   // This handles invalid URLs gracefully by falling back to project selection
  //   if (selectedProject && 
  //       !loadingProjects && 
  //       projects.length > 0 && 
  //       !foundProject) {
  //     console.log('Clearing invalid project ID from URL:', selectedProject);
  //     setSelectedProject(null, true); // Use replaceState to avoid polluting history
  //   }
  // }, [selectedProject, projects, foundProject, setSelectedProject, loadingProjects]);

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

  // Wait for URL state hydration before rendering to avoid hydration mismatches
  if (!urlStateHydrated) {
    return (
      <div className="flex h-screen bg-base-200 text-base-content font-sans items-center justify-center">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

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
                        <span className={`text-xs badge badge-xs ${
                          agent.status === 'idle' ? 'badge-success' :
                          (agent.status === 'thinking' || agent.status === 'tool_execution' || agent.status === 'streaming') ? 'badge-warning' :
                          'badge-neutral'
                        }`}>
                          {agent.status}
                        </span>
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
                    <span className={`text-xs badge badge-xs ${
                      agent.status === 'idle' ? 'badge-success' :
                      (agent.status === 'thinking' || agent.status === 'tool_execution' || agent.status === 'streaming') ? 'badge-warning' :
                      'badge-neutral'
                    }`}>
                      {agent.status}
                    </span>
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
                  {selectedAgent && selectedSessionDetails?.agents ? 
                    (() => {
                      const currentAgent = selectedSessionDetails.agents.find(a => a.threadId === selectedAgent);
                      return currentAgent ? `${currentAgent.name} - ${currentAgent.model}` : (selectedProject ? currentProject.name : 'Select a Project');
                    })() :
                    (selectedProject ? currentProject.name : 'Select a Project')
                  }
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
          ) : selectedProject && foundProject ? (
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
                  onAgentSelect={handleAgentSelect}
                  onAgentUpdate={handleAgentUpdate}
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
            /* Project Selection Panel - When no project selected or invalid project ID */
            <div className="flex-1 p-6 min-h-0">
              <ProjectSelectorPanel
                projects={projectsForSidebar}
                selectedProject={currentProject.id ? currentProject : null}
                providers={providers}
                onProjectSelect={handleProjectSelect}
                onProjectCreate={loadProjects}
                onProjectUpdate={handleProjectUpdate}
                loading={loadingProjects}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {pendingApprovals.length > 0 && (
        <ToolApprovalModal
          approvals={pendingApprovals}
          onDecision={handleApprovalDecision}
        />
      )}
    </motion.div>
  );
}
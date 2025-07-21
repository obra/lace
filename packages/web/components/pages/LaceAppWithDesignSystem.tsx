// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';
import { Sidebar } from '@/components/layout/Sidebar';
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

export function LaceAppWithDesignSystem() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // UI State (from AnimatedLaceApp but remove demo data)
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  // Business Logic State (from current app/page.tsx)
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<ThreadId | null>(null);
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<Session | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<ThreadId | undefined>(undefined);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequestData | null>(null);

  // Convert SessionEvents to TimelineEntries for the design system
  const timelineEntries = useMemo(() => {
    const entries = convertSessionEventsToTimeline(events, {
      agents: selectedSessionDetails?.agents || [],
      selectedAgent,
    });
    
    return entries;
  }, [events, selectedSessionDetails?.agents, selectedAgent]);

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

  // Load sessions when project is selected
  useEffect(() => {
    void loadSessions();
  }, [selectedProject, loadSessions]);

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

  // Connect to SSE when session selected
  useEffect(() => {
    if (!selectedSession) {
      setSelectedSessionDetails(null);
      return;
    }

    // Clear events when switching sessions
    setEvents([]);
    setSelectedAgent(undefined);

    // Load full session details and conversation history
    void loadSessionDetails(selectedSession);
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
                threadId: selectedSession as ThreadId,
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
        threadId: selectedSession as ThreadId,
        timestamp: new Date(),
        data: { content: 'Connected to session stream' },
      };
      setEvents((prev) => [...prev, connectionEvent]);
    };

    eventSource.addEventListener('connection', connectionListener);

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      const errorEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedSession as ThreadId,
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
  }, [selectedSession, loadSessionDetails]);

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
              // TODO: Pass real props instead of demo data
              currentProject={{ id: '1', name: 'Loading...', workingDirectory: '/' }}
              projects={[]}
              currentTimeline={{ id: 1, name: 'Main', agent: 'Claude' }}
              timelines={[]}
              activeTasks={[]}
              currentTheme={theme}
              availableThemes={[
                { name: 'light', colors: { primary: '#570DF8', secondary: '#F000B8', accent: '#37CDBE' } },
                { name: 'dark', colors: { primary: '#661AE6', secondary: '#D926AA', accent: '#1FB2A5' } },
              ]}
              onProjectChange={() => {}}
              onTimelineChange={() => {}}
              onThemeChange={setTheme}
              onTriggerTool={() => {}}
              onOpenTaskBoard={() => {}}
              onOpenFileManager={() => {}}
              onOpenTaskDetail={() => {}}
            />
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
          // TODO: Pass real props instead of demo data
          currentProject={{ id: '1', name: 'Loading...', workingDirectory: '/' }}
          projects={[]}
          currentTimeline={{ id: 1, name: 'Main', agent: 'Claude' }}
          timelines={[]}
          activeTasks={[]}
          recentFiles={[]}
          currentTheme={theme}
          onProjectChange={() => {}}
          onTimelineChange={() => {}}
          onNewTimeline={() => {}}
          onOpenTask={() => {}}
          onOpenFile={() => {}}
          onTriggerTool={() => {}}
          onOpenTaskBoard={() => {}}
          onOpenFileManager={() => {}}
          onOpenRulesFile={() => {}}
          onThemeChange={setTheme}
        />
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
                  {selectedSession ? 'Session Active' : 'No Session'}
                </h1>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Content Area - TODO: Replace with actual business logic */}
        <div className="flex-1 flex items-center justify-center text-base-content">
          <p>TODO: Add real project/session/agent management here</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
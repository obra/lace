// Tool Execution Timeline Component for Lace Web Companion
// Displays real-time tool call execution with status, timing, and results

const { useState, useEffect, useRef } = React;

function ToolsTimeline({ socket, currentSession }) {
  const [toolEvents, setToolEvents] = useState([]);
  const [filters, setFilters] = useState({
    toolType: '',
    status: '',
    timeRange: '1h'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [toolSummary, setToolSummary] = useState({});
  const timelineEndRef = useRef(null);

  // Fetch tool summary on component mount
  useEffect(() => {
    fetchToolSummary();
  }, []);

  // Fetch tool events when session changes
  useEffect(() => {
    if (currentSession) {
      fetchToolEvents(currentSession);
    } else {
      setToolEvents([]);
    }
  }, [currentSession]);

  // Listen for real-time tool events via activity stream
  useEffect(() => {
    if (!socket) return;

    const handleActivity = (event) => {
      if (event.event_type.startsWith('tool_')) {
        try {
          const eventData = JSON.parse(event.data);
          setToolEvents(prev => {
            const newEvent = {
              id: `${event.timestamp}-${event.event_type}`,
              timestamp: event.timestamp,
              sessionId: event.local_session_id,
              type: event.event_type,
              data: eventData
            };

            // Prevent duplicates and maintain chronological order
            const existing = prev.find(e => e.id === newEvent.id);
            if (existing) return prev;

            return [...prev, newEvent]
              .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
              .slice(0, 200); // Keep last 200 events
          });
        } catch (e) {
          console.error('Failed to parse tool event data:', e);
        }
      }
    };

    socket.on('activity', handleActivity);
    return () => socket.off('activity', handleActivity);
  }, [socket]);

  const fetchToolSummary = async () => {
    try {
      const response = await fetch('/api/tools/summary?hours=24');
      if (response.ok) {
        const data = await response.json();
        setToolSummary(data);
      }
    } catch (error) {
      console.error('Failed to fetch tool summary:', error);
    }
  };

  const fetchToolEvents = async (sessionId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/tools`);
      if (response.ok) {
        const data = await response.json();
        setToolEvents(data);
      }
    } catch (error) {
      console.error('Failed to fetch tool events:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Group related tool events (start -> complete)
  const groupedEvents = groupToolEvents(toolEvents);

  // Apply filters
  const filteredEvents = applyFilters(groupedEvents, filters);

  function groupToolEvents(events) {
    const groups = new Map();
    
    events.forEach(event => {
      if (event.type === 'tool_execution_start') {
        const key = `${event.timestamp}-${event.data.tool}-${event.data.method}`;
        groups.set(key, {
          id: key,
          tool: event.data.tool,
          method: event.data.method,
          params: event.data.params,
          startTime: event.timestamp,
          sessionId: event.sessionId,
          status: 'running',
          duration: null,
          result: null,
          error: null
        });
      } else if (event.type === 'tool_execution_complete') {
        // Find matching start event
        const matchingKey = Array.from(groups.keys()).find(key => {
          const group = groups.get(key);
          return group.status === 'running' && 
                 Math.abs(new Date(event.timestamp) - new Date(group.startTime)) < 30000; // Within 30 seconds
        });
        
        if (matchingKey) {
          const group = groups.get(matchingKey);
          group.status = event.data.success ? 'completed' : 'failed';
          group.duration = event.data.duration_ms;
          group.result = event.data.result;
          group.error = event.data.error;
          group.endTime = event.timestamp;
        }
      } else if (event.type === 'tool_approval_request') {
        const key = `${event.timestamp}-${event.data.tool}-${event.data.method}-approval`;
        groups.set(key, {
          id: key,
          tool: event.data.tool,
          method: event.data.method,
          params: event.data.params,
          startTime: event.timestamp,
          sessionId: event.sessionId,
          status: 'pending_approval',
          riskLevel: event.data.risk_level,
          duration: null,
          result: null,
          error: null
        });
      } else if (event.type === 'tool_approval_decision') {
        // Update pending approval with decision
        const pendingKey = Array.from(groups.keys()).find(key => {
          const group = groups.get(key);
          return group.status === 'pending_approval';
        });
        
        if (pendingKey) {
          const group = groups.get(pendingKey);
          group.status = event.data.approved ? 'approved' : 'denied';
          group.userDecision = event.data.user_decision;
          group.modifiedParams = event.data.modified_params;
        }
      }
    });

    return Array.from(groups.values())
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  }

  function applyFilters(events, filters) {
    return events.filter(event => {
      // Tool type filter
      if (filters.toolType && event.tool !== filters.toolType) {
        return false;
      }

      // Status filter
      if (filters.status && event.status !== filters.status) {
        return false;
      }

      // Time range filter
      if (filters.timeRange) {
        const now = new Date();
        const eventTime = new Date(event.startTime);
        const hoursDiff = (now - eventTime) / (1000 * 60 * 60);
        
        switch (filters.timeRange) {
          case '1h':
            if (hoursDiff > 1) return false;
            break;
          case '6h':
            if (hoursDiff > 6) return false;
            break;
          case '24h':
            if (hoursDiff > 24) return false;
            break;
        }
      }

      return true;
    });
  }

  const getToolIcon = (toolName) => {
    switch (toolName) {
      case 'shell': return '🔧';
      case 'file': return '📁';
      case 'javascript': return '⚡';
      case 'search': return '🔍';
      default: return '🛠️';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_approval': return '#f59e0b';
      case 'approved': return '#10b981';
      case 'denied': return '#ef4444';
      case 'running': return '#3b82f6';
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'pending_approval': return 'Pending Approval';
      case 'approved': return 'Approved';
      case 'denied': return 'Denied';
      case 'running': return 'Running';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return 'Unknown';
    }
  };

  const formatDuration = (durationMs) => {
    if (!durationMs) return 'N/A';
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(2)}s`;
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const truncateText = (text, maxLength = 100) => {
    if (!text || typeof text !== 'string') return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return React.createElement('div', { className: 'tools-timeline' },
    // Header with filters
    React.createElement('div', { className: 'tools-header' },
      React.createElement('h2', null, 'Tool Execution Timeline'),
      React.createElement('div', { className: 'tools-filters' },
        React.createElement('select', {
          value: filters.toolType,
          onChange: (e) => setFilters(prev => ({ ...prev, toolType: e.target.value })),
          className: 'filter-select'
        },
          React.createElement('option', { value: '' }, 'All Tools'),
          React.createElement('option', { value: 'shell' }, 'Shell'),
          React.createElement('option', { value: 'file' }, 'File'),
          React.createElement('option', { value: 'javascript' }, 'JavaScript'),
          React.createElement('option', { value: 'search' }, 'Search')
        ),
        React.createElement('select', {
          value: filters.status,
          onChange: (e) => setFilters(prev => ({ ...prev, status: e.target.value })),
          className: 'filter-select'
        },
          React.createElement('option', { value: '' }, 'All Status'),
          React.createElement('option', { value: 'pending_approval' }, 'Pending Approval'),
          React.createElement('option', { value: 'running' }, 'Running'),
          React.createElement('option', { value: 'completed' }, 'Completed'),
          React.createElement('option', { value: 'failed' }, 'Failed'),
          React.createElement('option', { value: 'denied' }, 'Denied')
        ),
        React.createElement('select', {
          value: filters.timeRange,
          onChange: (e) => setFilters(prev => ({ ...prev, timeRange: e.target.value })),
          className: 'filter-select'
        },
          React.createElement('option', { value: '1h' }, 'Last Hour'),
          React.createElement('option', { value: '6h' }, 'Last 6 Hours'),
          React.createElement('option', { value: '24h' }, 'Last 24 Hours'),
          React.createElement('option', { value: '' }, 'All Time')
        )
      )
    ),

    // Stats summary
    React.createElement('div', { className: 'tools-stats' },
      React.createElement('div', { className: 'stat' },
        React.createElement('strong', null, filteredEvents.length),
        React.createElement('span', null, ' total calls')
      ),
      React.createElement('div', { className: 'stat' },
        React.createElement('strong', null, filteredEvents.filter(e => e.status === 'completed').length),
        React.createElement('span', null, ' completed')
      ),
      React.createElement('div', { className: 'stat' },
        React.createElement('strong', null, filteredEvents.filter(e => e.status === 'failed').length),
        React.createElement('span', null, ' failed')
      ),
      React.createElement('div', { className: 'stat' },
        React.createElement('strong', null, filteredEvents.filter(e => e.status === 'running').length),
        React.createElement('span', null, ' running')
      ),
      Object.keys(toolSummary).length > 0 && React.createElement('div', { className: 'stat' },
        React.createElement('strong', null, Object.keys(toolSummary).length),
        React.createElement('span', null, ' tool types')
      )
    ),

    // Timeline list
    React.createElement('div', { className: 'timeline-container' },
      isLoading && React.createElement('div', { className: 'loading-indicator' },
        'Loading tool events...'
      ),
      
      !currentSession && !isLoading && React.createElement('div', { className: 'no-session' },
        React.createElement('p', null, 'Select a session to view tool execution timeline')
      ),

      currentSession && filteredEvents.length === 0 && !isLoading ? 
        React.createElement('div', { className: 'no-events' },
          React.createElement('p', null, 'No tool executions found for this session')
        ) :
        filteredEvents.map(event => 
          React.createElement('div', { 
            key: event.id,
            className: 'timeline-event'
          },
            React.createElement('div', { className: 'event-header' },
              React.createElement('div', { className: 'event-title' },
                React.createElement('span', { className: 'tool-icon' }, getToolIcon(event.tool)),
                React.createElement('span', { className: 'tool-name' }, `${event.tool}.${event.method}`),
                React.createElement('span', { 
                  className: 'event-status',
                  style: { color: getStatusColor(event.status) }
                }, getStatusLabel(event.status))
              ),
              React.createElement('div', { className: 'event-meta' },
                React.createElement('span', { className: 'event-time' }, formatTimestamp(event.startTime)),
                event.duration && React.createElement('span', { className: 'event-duration' }, formatDuration(event.duration))
              )
            ),

            React.createElement('div', { className: 'event-content' },
              // Parameters
              event.params && React.createElement('details', { className: 'event-details' },
                React.createElement('summary', null, 'Parameters'),
                React.createElement('pre', { className: 'event-code' },
                  JSON.stringify(event.params, null, 2)
                )
              ),

              // Result or Error
              event.result && React.createElement('details', { className: 'event-details' },
                React.createElement('summary', null, 'Result'),
                React.createElement('pre', { className: 'event-code' },
                  typeof event.result === 'string' ? 
                    truncateText(event.result, 500) :
                    JSON.stringify(event.result, null, 2)
                )
              ),

              event.error && React.createElement('div', { className: 'event-error' },
                React.createElement('strong', null, 'Error: '),
                React.createElement('span', null, event.error)
              ),

              // Risk level for approval events
              event.riskLevel && React.createElement('div', { className: 'event-risk' },
                React.createElement('strong', null, 'Risk Level: '),
                React.createElement('span', { 
                  className: `risk-${event.riskLevel}` 
                }, event.riskLevel)
              ),

              // Session info
              event.sessionId && React.createElement('div', { className: 'event-session' },
                React.createElement('small', null, 'Session: ', event.sessionId)
              )
            )
          )
        ),
      
      React.createElement('div', { ref: timelineEndRef })
    )
  );
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ToolsTimeline;
} else {
  window.ToolsTimeline = ToolsTimeline;
}
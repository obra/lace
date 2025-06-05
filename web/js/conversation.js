// Conversation View Component for Lace Web Companion
// Displays real-time conversation log with token usage and cost tracking

const { useState, useEffect, useRef } = React;

function ConversationView({ socket, currentSession, onSessionChange }) {
  const [messages, setMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionStats, setSessionStats] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  // Fetch available sessions
  useEffect(() => {
    fetchSessions();
  }, []);

  // Fetch messages when session changes
  useEffect(() => {
    if (currentSession) {
      fetchMessages(currentSession);
      fetchSessionStats(currentSession);
    } else {
      setMessages([]);
      setSessionStats(null);
    }
  }, [currentSession]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Listen for real-time message updates via activity events
  useEffect(() => {
    if (!socket) return;

    const handleActivity = (event) => {
      if (event.event_type === 'conversation_message' && 
          event.local_session_id === currentSession) {
        try {
          const messageData = JSON.parse(event.data);
          setMessages(prev => {
            // Check if message already exists
            const exists = prev.find(m => 
              m.timestamp === messageData.timestamp && 
              m.role === messageData.role &&
              m.content === messageData.content
            );
            if (exists) return prev;
            
            return [...prev, messageData];
          });
        } catch (e) {
          console.error('Failed to parse message data:', e);
        }
      }
    };

    socket.on('activity', handleActivity);
    return () => socket.off('activity', handleActivity);
  }, [socket, currentSession]);

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  };

  const fetchMessages = async (sessionId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSessionStats = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/stats`);
      if (response.ok) {
        const data = await response.json();
        setSessionStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch session stats:', error);
    }
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
    setAutoScroll(isAtBottom);
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'user': return '#4ade80';
      case 'assistant': return '#60a5fa';
      case 'system': return '#9ca3af';
      default: return '#e2e8f0';
    }
  };

  const calculateTokenCost = (tokens) => {
    // Rough cost estimation - adjust based on actual model pricing
    const costPerToken = 0.000003; // ~$3 per 1M tokens for Claude
    return tokens * costPerToken;
  };

  const formatCost = (cost) => {
    return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(3)}`;
  };

  return React.createElement('div', { className: 'conversation-view' },
    // Header with session selector and stats
    React.createElement('div', { className: 'conversation-header' },
      React.createElement('div', { className: 'session-selector' },
        React.createElement('select', {
          value: currentSession || '',
          onChange: (e) => {
            const sessionId = e.target.value;
            if (sessionId && onSessionChange) {
              onSessionChange(sessionId);
            }
          },
          style: {
            padding: '0.5rem',
            backgroundColor: '#334155',
            color: '#e2e8f0',
            border: '1px solid #475569',
            borderRadius: '4px'
          }
        },
          React.createElement('option', { value: '' }, 'Select Session...'),
          sessions.map(session => 
            React.createElement('option', { key: session.id, value: session.id },
              `${session.id} (${new Date(session.last_active).toLocaleDateString()})`
            )
          )
        )
      ),
      sessionStats && React.createElement('div', { className: 'session-stats' },
        React.createElement('div', { className: 'stat' },
          React.createElement('strong', null, sessionStats.messageCount),
          React.createElement('span', null, ' messages')
        ),
        sessionStats.tokenStats.total_tokens > 0 && React.createElement('div', { className: 'stat' },
          React.createElement('strong', null, sessionStats.tokenStats.total_tokens?.toLocaleString() || '0'),
          React.createElement('span', null, ' tokens')
        ),
        sessionStats.tokenStats.total_tokens > 0 && React.createElement('div', { className: 'stat' },
          React.createElement('strong', null, formatCost(calculateTokenCost(sessionStats.tokenStats.total_tokens))),
          React.createElement('span', null, ' estimated cost')
        )
      )
    ),

    // Auto-scroll toggle
    React.createElement('div', { className: 'conversation-controls' },
      React.createElement('label', { className: 'auto-scroll-toggle' },
        React.createElement('input', {
          type: 'checkbox',
          checked: autoScroll,
          onChange: (e) => setAutoScroll(e.target.checked)
        }),
        React.createElement('span', null, ' Auto-scroll to latest')
      )
    ),

    // Messages container
    React.createElement('div', { 
      className: 'messages-container',
      ref: containerRef,
      onScroll: handleScroll
    },
      isLoading && React.createElement('div', { className: 'loading-indicator' },
        'Loading messages...'
      ),
      
      !currentSession && !isLoading && React.createElement('div', { className: 'no-session' },
        React.createElement('p', null, 'Select a session to view conversation history')
      ),

      currentSession && messages.length === 0 && !isLoading && 
        React.createElement('div', { className: 'no-messages' },
          React.createElement('p', null, 'No messages in this session yet')
        ),

      messages.map((message, index) => 
        React.createElement('div', { 
          key: `${message.timestamp}-${index}`,
          className: 'message'
        },
          React.createElement('div', { className: 'message-header' },
            React.createElement('span', { 
              className: 'message-role',
              style: { color: getRoleColor(message.role) }
            }, message.role),
            React.createElement('span', { className: 'message-time' },
              formatTimestamp(message.timestamp)
            ),
            message.generation !== undefined && React.createElement('span', { className: 'message-generation' },
              `Gen: ${message.generation}`
            )
          ),
          React.createElement('div', { className: 'message-content' },
            message.content
          ),
          message.context_size && React.createElement('div', { className: 'message-meta' },
            React.createElement('span', { className: 'token-count' },
              `${message.context_size} tokens`
            ),
            React.createElement('span', { className: 'cost-estimate' },
              formatCost(calculateTokenCost(message.context_size))
            )
          ),
          message.tool_calls && message.tool_calls !== 'null' && 
            React.createElement('div', { className: 'tool-calls' },
              React.createElement('details', null,
                React.createElement('summary', null, 'Tool Calls'),
                React.createElement('pre', null, 
                  JSON.stringify(JSON.parse(message.tool_calls), null, 2)
                )
              )
            )
        )
      ),
      
      React.createElement('div', { ref: messagesEndRef })
    )
  );
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConversationView;
} else {
  window.ConversationView = ConversationView;
}
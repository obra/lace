// ABOUTME: Main React application for Lace Web Companion
// ABOUTME: Implements split-pane layout with conversation view and activity dashboard tabs

const { useState, useEffect, useCallback } = React;

function App() {
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [socket, setSocket] = useState(null);
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({});
  const [currentSession, setCurrentSession] = useState(null);
  const [activeTab, setActiveTab] = useState('tools');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to Lace server');
      setConnectionStatus('connected');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from Lace server');
      setConnectionStatus('disconnected');
    });

    newSocket.on('activity', (event) => {
      console.log('Received activity event:', event);
      setEvents(prev => {
        // Prevent duplicates and maintain chronological order
        const existing = prev.find(e => 
          e.timestamp === event.timestamp && 
          e.event_type === event.event_type &&
          e.local_session_id === event.local_session_id
        );
        
        if (existing) return prev;
        
        return [event, ...prev].slice(0, 100); // Keep last 100 events
      });
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const applyFilters = (newFilters) => {
    if (socket && socket.connected) {
      socket.emit('filter-activity', newFilters);
      setFilters(newFilters);
    }
  };

  const subscribeToSession = (sessionId) => {
    if (socket && socket.connected) {
      socket.emit('subscribe-session', sessionId);
      setCurrentSession(sessionId);
    }
  };

  const handleSessionChange = (sessionId) => {
    subscribeToSession(sessionId);
  };

  const unsubscribeFromSession = () => {
    if (socket && socket.connected) {
      socket.emit('unsubscribe-session');
      setCurrentSession(null);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'status-connected';
      case 'disconnected': return 'status-disconnected';
      default: return 'status-connecting';
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'conversation':
        return React.createElement(ConversationView, { 
          socket: socket, 
          currentSession: currentSession,
          onSessionChange: handleSessionChange
        });
      case 'activity':
        return React.createElement('div', { style: { padding: '2rem' } },
          React.createElement('h2', null, 'Activity Stream'),
          React.createElement('p', null, `Received ${events.length} events`),
          React.createElement('div', { style: { marginTop: '1rem', maxHeight: '500px', overflow: 'auto' } },
            events.length === 0 ? 
              React.createElement('p', { style: { color: '#9ca3af' } }, 'No events received yet...') :
              events.map((event, index) => 
                React.createElement('div', { 
                  key: `${event.timestamp}-${index}`, 
                  style: { 
                    padding: '0.75rem', 
                    marginBottom: '0.5rem', 
                    backgroundColor: '#2d3748', 
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    borderLeft: `3px solid ${getEventTypeColor(event.event_type)}`
                  } 
                },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' } },
                    React.createElement('strong', { style: { color: getEventTypeColor(event.event_type) } }, event.event_type),
                    React.createElement('small', { style: { color: '#9ca3af' } }, new Date(event.timestamp).toLocaleTimeString())
                  ),
                  React.createElement('div', { style: { fontSize: '0.8rem', color: '#cbd5e0' } },
                    'Session: ', React.createElement('code', null, event.local_session_id || 'unknown')
                  ),
                  event.model_session_id && React.createElement('div', { style: { fontSize: '0.8rem', color: '#cbd5e0' } },
                    'Model Session: ', React.createElement('code', null, event.model_session_id)
                  )
                )
              )
          )
        );
      case 'tools':
        return React.createElement(ToolsTimeline, { 
          socket: socket, 
          currentSession: currentSession 
        });
      case 'agents':
        return React.createElement(AgentsDashboard, { 
          socket: socket, 
          currentSession: currentSession 
        });
      case 'files':
        return React.createElement(FileBrowser, { 
          socket: socket, 
          currentSession: currentSession 
        });
      default:
        return React.createElement('div', null, 'Unknown tab');
    }
  };

  return React.createElement('div', { className: 'app' },
    React.createElement('header', { className: 'app-header' },
      React.createElement('h1', null, '🧵 Lace Web Companion'),
      React.createElement('div', { className: getStatusColor() },
        connectionStatus === 'connected' ? '● Connected' : 
        connectionStatus === 'disconnected' ? '● Disconnected' : 
        '● Connecting...'
      )
    ),
    React.createElement('main', { className: 'app-main' },
      React.createElement('div', { className: 'app-sidebar' },
        React.createElement('div', { style: { padding: '1rem' } },
          React.createElement('h3', null, 'Navigation'),
          React.createElement('div', { className: 'tab-nav' },
            ['conversation', 'activity', 'tools', 'agents', 'files'].map(tab =>
              React.createElement('button', {
                key: tab,
                className: `tab-button ${activeTab === tab ? 'active' : ''}`,
                onClick: () => setActiveTab(tab)
              }, tab.charAt(0).toUpperCase() + tab.slice(1))
            )
          ),
          
          activeTab === 'activity' && React.createElement('div', { style: { marginTop: '2rem' } },
            React.createElement('h4', null, 'Activity Filters'),
            React.createElement('div', { style: { marginBottom: '1rem' } },
              React.createElement('label', null, 'Event Type:'),
              React.createElement('select', {
                value: filters.eventType || '',
                onChange: (e) => applyFilters({ ...filters, eventType: e.target.value || undefined }),
                style: { width: '100%', marginTop: '0.25rem', padding: '0.25rem' }
              },
                React.createElement('option', { value: '' }, 'All Events'),
                React.createElement('option', { value: 'user_input' }, 'User Input'),
                React.createElement('option', { value: 'agent_response' }, 'Agent Response'),
                React.createElement('option', { value: 'tool_call' }, 'Tool Call'),
                React.createElement('option', { value: 'model_call' }, 'Model Call')
              )
            ),
            React.createElement('div', { style: { marginBottom: '1rem' } },
              React.createElement('label', null, 'Session ID:'),
              React.createElement('input', {
                type: 'text',
                value: filters.sessionId || '',
                onChange: (e) => applyFilters({ ...filters, sessionId: e.target.value || undefined }),
                placeholder: 'Filter by session...',
                style: { width: '100%', marginTop: '0.25rem', padding: '0.25rem' }
              })
            )
          ),
          
          currentSession && React.createElement('div', { style: { marginTop: '2rem' } },
            React.createElement('h4', null, 'Current Session'),
            React.createElement('p', { style: { fontSize: '0.8rem', wordBreak: 'break-all' } }, currentSession),
            React.createElement('button', {
              onClick: unsubscribeFromSession,
              style: { padding: '0.25rem 0.5rem', marginTop: '0.5rem' }
            }, 'Unsubscribe')
          )
        )
      ),
      React.createElement('div', { className: 'app-content' },
        renderTabContent()
      )
    )
  );

  function getEventTypeColor(eventType) {
    switch (eventType) {
      case 'user_input': return '#4ade80';
      case 'agent_response': return '#60a5fa';
      case 'tool_call': return '#f59e0b';
      case 'model_call': return '#a78bfa';
      default: return '#9ca3af';
    }
  }
}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
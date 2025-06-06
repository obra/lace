// ABOUTME: Main React application for Lace Web Companion
// ABOUTME: Implements split-pane layout with conversation view and activity dashboard tabs

import React, { useState, useEffect, useCallback } from 'react'
import io from 'socket.io-client'
import ConversationView from './conversation.js'
import ToolsTimeline from './tools.js'
import AgentsDashboard from './agents.js'
import FileBrowser from './files.js'

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Ctrl/Cmd + number keys for tab switching
      if ((event.ctrlKey || event.metaKey)) {
        switch (event.key) {
          case '1':
            event.preventDefault();
            setActiveTab('conversation');
            break;
          case '2':
            event.preventDefault();
            setActiveTab('tools');
            break;
          case '3':
            event.preventDefault();
            setActiveTab('agents');
            break;
          case '4':
            event.preventDefault();
            setActiveTab('files');
            break;
          case 'r':
            event.preventDefault();
            window.location.reload();
            break;
          case 'l':
            event.preventDefault();
            setLeftPaneVisible(!leftPaneVisible);
            break;
          case 'k':
            event.preventDefault();
            setRightPaneVisible(!rightPaneVisible);
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [leftPaneVisible, rightPaneVisible]);

  useEffect(() => {
    // Initialize socket connection
    setIsLoading(true);
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to Lace server');
      setConnectionStatus('connected');
      setIsLoading(false);
      setError(null);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from Lace server');
      setConnectionStatus('disconnected');
      setError('Connection lost. Attempting to reconnect...');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('disconnected');
      setError('Failed to connect to server');
      setIsLoading(false);
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

  const renderRightPaneContent = () => {
    switch (activeTab) {
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
      case 'activity':
        return React.createElement('div', { className: 'activity-stream' },
          React.createElement('div', { className: 'activity-header' },
            React.createElement('h2', null, 'Activity Stream'),
            React.createElement('div', { className: 'activity-stats' },
              React.createElement('span', { className: 'event-count' }, `${events.length} events`)
            )
          ),
          React.createElement('div', { className: 'activity-content' },
            events.length === 0 ? 
              React.createElement('div', { className: 'no-events' }, 'No events received yet...') :
              events.map((event, index) => 
                React.createElement('div', { 
                  key: `${event.timestamp}-${index}`, 
                  className: 'activity-event',
                  'data-event-type': event.event_type
                },
                  React.createElement('div', { className: 'event-header' },
                    React.createElement('span', { 
                      className: 'event-type',
                      style: { color: getEventTypeColor(event.event_type) }
                    }, event.event_type),
                    React.createElement('span', { className: 'event-time' }, 
                      new Date(event.timestamp).toLocaleTimeString()
                    )
                  ),
                  React.createElement('div', { className: 'event-details' },
                    React.createElement('div', { className: 'session-info' },
                      'Session: ', React.createElement('code', null, event.local_session_id || 'unknown')
                    ),
                    event.model_session_id && React.createElement('div', { className: 'model-session-info' },
                      'Model Session: ', React.createElement('code', null, event.model_session_id)
                    )
                  )
                )
              )
          )
        );
      default:
        return React.createElement('div', { className: 'unknown-tab' }, 
          React.createElement('p', null, 'Unknown tab selected')
        );
    }
  };

  // Error notification component
  const renderError = () => {
    if (!error) return null;
    return React.createElement('div', { className: 'error-notification' },
      React.createElement('span', { className: 'error-icon' }, '⚠️'),
      React.createElement('span', { className: 'error-message' }, error),
      React.createElement('button', { 
        className: 'error-dismiss',
        onClick: () => setError(null)
      }, '×')
    );
  };

  // Loading overlay component
  const renderLoadingOverlay = () => {
    if (!isLoading) return null;
    return React.createElement('div', { className: 'loading-overlay' },
      React.createElement('div', { className: 'loading-spinner' }),
      React.createElement('p', null, 'Connecting to Lace server...')
    );
  };

  return React.createElement('div', { className: 'app' },
    // Header with connection status and controls
    React.createElement('header', { className: 'app-header' },
      React.createElement('div', { className: 'header-left' },
        React.createElement('h1', null, '🧵 Lace Web Companion'),
        React.createElement('div', { className: `connection-status ${getStatusColor()}` },
          React.createElement('span', { className: 'status-indicator' }),
          React.createElement('span', { className: 'status-text' },
            connectionStatus === 'connected' ? 'Connected' : 
            connectionStatus === 'disconnected' ? 'Disconnected' : 
            'Connecting...'
          )
        )
      ),
      React.createElement('div', { className: 'header-right' },
        // Pane visibility toggles
        React.createElement('div', { className: 'pane-controls' },
          React.createElement('button', {
            className: `pane-toggle ${leftPaneVisible ? 'active' : ''}`,
            onClick: () => setLeftPaneVisible(!leftPaneVisible),
            title: 'Toggle conversation pane (Ctrl+L)'
          }, '📄'),
          React.createElement('button', {
            className: `pane-toggle ${rightPaneVisible ? 'active' : ''}`,
            onClick: () => setRightPaneVisible(!rightPaneVisible),
            title: 'Toggle activity pane (Ctrl+K)'
          }, '📊')
        ),
        // Keyboard shortcuts help
        React.createElement('div', { className: 'keyboard-shortcuts' },
          React.createElement('span', { className: 'shortcuts-text' }, 'Ctrl+1-4: Tabs • Ctrl+R: Refresh • Ctrl+L/K: Toggle Panes')
        )
      )
    ),

    // Error notifications
    renderError(),
    
    // Loading overlay
    renderLoadingOverlay(),

    // Main split-pane layout
    React.createElement('main', { className: 'app-main split-pane-layout' },
      // Left pane - Conversation view
      leftPaneVisible && React.createElement('div', { className: 'left-pane conversation-pane' },
        React.createElement('div', { className: 'pane-header' },
          React.createElement('h2', null, 'Conversation'),
          currentSession && React.createElement('div', { className: 'current-session-info' },
            React.createElement('span', { className: 'session-label' }, 'Session:'),
            React.createElement('code', { className: 'session-id' }, currentSession),
            React.createElement('button', {
              className: 'session-clear',
              onClick: unsubscribeFromSession,
              title: 'Clear session'
            }, '×')
          )
        ),
        React.createElement('div', { className: 'pane-content' },
          React.createElement(ConversationView, { 
            socket: socket, 
            currentSession: currentSession,
            onSessionChange: handleSessionChange
          })
        )
      ),

      // Splitter
      (leftPaneVisible && rightPaneVisible) && React.createElement('div', { className: 'pane-splitter' }),

      // Right pane - Activity dashboard with tabs
      rightPaneVisible && React.createElement('div', { className: 'right-pane activity-pane' },
        React.createElement('div', { className: 'pane-header' },
          React.createElement('div', { className: 'activity-tabs' },
            ['tools', 'agents', 'files', 'activity'].map(tab =>
              React.createElement('button', {
                key: tab,
                className: `tab-button ${activeTab === tab ? 'active' : ''}`,
                onClick: () => setActiveTab(tab),
                title: `Switch to ${tab} view (Ctrl+${['tools', 'agents', 'files', 'activity'].indexOf(tab) + 1})`
              }, 
                React.createElement('span', { className: 'tab-icon' }, getTabIcon(tab)),
                React.createElement('span', { className: 'tab-label' }, tab.charAt(0).toUpperCase() + tab.slice(1))
              )
            )
          ),
          // Activity filters for activity tab
          activeTab === 'activity' && React.createElement('div', { className: 'activity-filters' },
            React.createElement('select', {
              value: filters.eventType || '',
              onChange: (e) => applyFilters({ ...filters, eventType: e.target.value || undefined }),
              className: 'filter-select'
            },
              React.createElement('option', { value: '' }, 'All Events'),
              React.createElement('option', { value: 'user_input' }, 'User Input'),
              React.createElement('option', { value: 'agent_response' }, 'Agent Response'),
              React.createElement('option', { value: 'tool_call' }, 'Tool Call'),
              React.createElement('option', { value: 'model_call' }, 'Model Call')
            )
          )
        ),
        React.createElement('div', { className: 'pane-content' },
          renderRightPaneContent()
        )
      )
    )
  );

  // Helper function for tab icons
  function getTabIcon(tab) {
    switch (tab) {
      case 'tools': return '🔧';
      case 'agents': return '🤖';
      case 'files': return '📁';
      case 'activity': return '📈';
      default: return '📄';
    }
  }

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

export default App
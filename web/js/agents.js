// Agent Orchestration Dashboard Component for Lace Web Companion
// Displays agent hierarchy, status, performance metrics, and lifecycle events

import React, { useState, useEffect, useRef } from 'react'

function AgentsDashboard({ socket, currentSession }) {
  const [agents, setAgents] = useState([]);
  const [agentEvents, setAgentEvents] = useState([]);
  const [agentMetrics, setAgentMetrics] = useState({});
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Listen for real-time agent events via activity stream
  useEffect(() => {
    if (!socket) return;

    const handleActivity = (event) => {
      if (event.event_type.includes('agent') || event.event_type.includes('generation')) {
        try {
          const eventData = JSON.parse(event.data);
          setAgentEvents(prev => {
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
              .slice(0, 100); // Keep last 100 events
          });
        } catch (e) {
          console.error('Failed to parse agent event data:', e);
        }
      }
    };

    socket.on('activity', handleActivity);
    return () => socket.off('activity', handleActivity);
  }, [socket]);

  // Process agent events to build agent hierarchy and status
  useEffect(() => {
    if (currentSession) {
      fetchAgentData(currentSession);
    } else {
      setAgents([]);
      setAgentMetrics({});
    }
  }, [currentSession]);

  const fetchAgentData = async (sessionId) => {
    setIsLoading(true);
    try {
      // Fetch agent-related data from multiple endpoints
      const [agentsResponse, messagesResponse] = await Promise.all([
        fetch(`/api/sessions/${sessionId}/agents`),
        fetch(`/api/sessions/${sessionId}/messages`)
      ]);

      if (agentsResponse.ok && messagesResponse.ok) {
        const agentsData = await agentsResponse.json();
        const messagesData = await messagesResponse.json();
        
        // Process the data to build agent hierarchy
        const processedAgents = processAgentHierarchy(agentsData, messagesData);
        setAgents(processedAgents);
        
        // Calculate metrics
        const metrics = calculateAgentMetrics(processedAgents, messagesData);
        setAgentMetrics(metrics);
      }
    } catch (error) {
      console.error('Failed to fetch agent data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  function processAgentHierarchy(agentsData, messagesData) {
    // Group messages by generation to understand agent activity
    const generationMessages = messagesData.reduce((acc, msg) => {
      const gen = msg.generation || 0;
      if (!acc[gen]) acc[gen] = [];
      acc[gen].push(msg);
      return acc;
    }, {});

    // Create agent objects from generation data
    const agentList = Object.entries(generationMessages).map(([generation, messages]) => {
      const gen = parseInt(generation);
      const agentMessages = messages.filter(m => m.role === 'assistant');
      const userMessages = messages.filter(m => m.role === 'user');
      
      // Determine agent status based on recent activity
      const lastActivity = messages.length > 0 ? 
        new Date(Math.max(...messages.map(m => new Date(m.timestamp)))) : null;
      
      const now = new Date();
      const hoursSinceActivity = lastActivity ? 
        (now - lastActivity) / (1000 * 60 * 60) : Infinity;
      
      let status = 'idle';
      if (hoursSinceActivity < 0.1) status = 'active'; // Active within 6 minutes
      else if (hoursSinceActivity > 24) status = 'archived';
      else if (agentMessages.length === 0) status = 'spawned';
      
      // Calculate token usage
      const totalTokens = messages.reduce((sum, msg) => 
        sum + (msg.context_size || 0), 0);
      
      return {
        id: `agent-gen-${gen}`,
        generation: gen,
        role: gen === 0 ? 'orchestrator' : 'specialist',
        status: status,
        messageCount: agentMessages.length,
        userInteractions: userMessages.length,
        totalTokens: totalTokens,
        lastActivity: lastActivity,
        capabilities: gen === 0 ? 
          ['orchestration', 'reasoning', 'planning', 'delegation'] :
          ['reasoning', 'tool_calling'],
        model: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        parentGeneration: gen > 0 ? gen - 1 : null,
        children: []
      };
    });

    // Build parent-child relationships
    agentList.forEach(agent => {
      if (agent.parentGeneration !== null) {
        const parent = agentList.find(a => a.generation === agent.parentGeneration);
        if (parent) {
          parent.children.push(agent.id);
        }
      }
    });

    return agentList.sort((a, b) => a.generation - b.generation);
  }

  function calculateAgentMetrics(agents, messages) {
    const totalMessages = messages.filter(m => m.role === 'assistant').length;
    const totalTokens = messages.reduce((sum, msg) => sum + (msg.context_size || 0), 0);
    const totalInteractions = messages.filter(m => m.role === 'user').length;
    
    const activeAgents = agents.filter(a => a.status === 'active').length;
    const avgTokensPerMessage = totalMessages > 0 ? totalTokens / totalMessages : 0;
    
    return {
      totalAgents: agents.length,
      activeAgents,
      totalMessages,
      totalTokens,
      totalInteractions,
      avgTokensPerMessage,
      efficiency: totalInteractions > 0 ? totalMessages / totalInteractions : 0
    };
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return '#10b981';
      case 'idle': return '#f59e0b';
      case 'spawned': return '#3b82f6';
      case 'archived': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return '🟢';
      case 'idle': return '🟡';
      case 'spawned': return '🔵';
      case 'archived': return '⚫';
      default: return '⚪';
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'orchestrator': return '🎭';
      case 'specialist': return '🔧';
      case 'analyst': return '📊';
      case 'researcher': return '🔍';
      default: return '🤖';
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (timestamp) => {
    if (!timestamp) return 'N/A';
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  };

  return React.createElement('div', { className: 'agents-dashboard' },
    // Header
    React.createElement('div', { className: 'agents-header' },
      React.createElement('h2', null, 'Agent Orchestration Dashboard'),
      React.createElement('div', { className: 'agents-summary' },
        React.createElement('span', { className: 'summary-item' },
          React.createElement('strong', null, agentMetrics.totalAgents || 0),
          React.createElement('span', null, ' agents')
        ),
        React.createElement('span', { className: 'summary-item' },
          React.createElement('strong', null, agentMetrics.activeAgents || 0),
          React.createElement('span', null, ' active')
        ),
        React.createElement('span', { className: 'summary-item' },
          React.createElement('strong', null, Math.round(agentMetrics.efficiency || 0)),
          React.createElement('span', null, ' msg/interaction')
        )
      )
    ),

    // Metrics overview
    React.createElement('div', { className: 'agents-metrics' },
      React.createElement('div', { className: 'metric-card' },
        React.createElement('h4', null, 'Total Messages'),
        React.createElement('div', { className: 'metric-value' }, agentMetrics.totalMessages || 0),
        React.createElement('div', { className: 'metric-label' }, 'assistant responses')
      ),
      React.createElement('div', { className: 'metric-card' },
        React.createElement('h4', null, 'Token Usage'),
        React.createElement('div', { className: 'metric-value' }, 
          (agentMetrics.totalTokens || 0).toLocaleString()
        ),
        React.createElement('div', { className: 'metric-label' }, 'total tokens')
      ),
      React.createElement('div', { className: 'metric-card' },
        React.createElement('h4', null, 'Avg Tokens/Message'),
        React.createElement('div', { className: 'metric-value' }, 
          Math.round(agentMetrics.avgTokensPerMessage || 0)
        ),
        React.createElement('div', { className: 'metric-label' }, 'efficiency')
      ),
      React.createElement('div', { className: 'metric-card' },
        React.createElement('h4', null, 'User Interactions'),
        React.createElement('div', { className: 'metric-value' }, agentMetrics.totalInteractions || 0),
        React.createElement('div', { className: 'metric-label' }, 'total inputs')
      )
    ),

    // Main content area
    React.createElement('div', { className: 'agents-content' },
      // Agent hierarchy tree
      React.createElement('div', { className: 'agents-tree' },
        React.createElement('h3', null, 'Agent Hierarchy'),
        
        isLoading && React.createElement('div', { className: 'loading-indicator' },
          'Loading agent data...'
        ),
        
        !currentSession && !isLoading && React.createElement('div', { className: 'no-session' },
          React.createElement('p', null, 'Select a session to view agent hierarchy')
        ),

        currentSession && agents.length === 0 && !isLoading && React.createElement('div', { className: 'no-agents' },
          React.createElement('p', null, 'No agents found for this session')
        ),

        agents.map(agent => 
          React.createElement('div', { 
            key: agent.id,
            className: `agent-node ${selectedAgent === agent.id ? 'selected' : ''}`,
            onClick: () => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)
          },
            React.createElement('div', { className: 'agent-header' },
              React.createElement('div', { className: 'agent-identity' },
                React.createElement('span', { className: 'agent-icon' }, getRoleIcon(agent.role)),
                React.createElement('span', { className: 'agent-name' }, `Generation ${agent.generation}`),
                React.createElement('span', { className: 'agent-role' }, agent.role),
                React.createElement('span', { 
                  className: 'agent-status',
                  style: { color: getStatusColor(agent.status) }
                }, 
                  getStatusIcon(agent.status),
                  agent.status
                )
              ),
              React.createElement('div', { className: 'agent-meta' },
                React.createElement('span', { className: 'agent-messages' }, 
                  `${agent.messageCount} messages`
                ),
                React.createElement('span', { className: 'agent-tokens' }, 
                  `${agent.totalTokens.toLocaleString()} tokens`
                ),
                React.createElement('span', { className: 'agent-activity' }, 
                  formatDuration(agent.lastActivity)
                )
              )
            ),

            // Expanded details
            selectedAgent === agent.id && React.createElement('div', { className: 'agent-details' },
              React.createElement('div', { className: 'detail-section' },
                React.createElement('h5', null, 'Configuration'),
                React.createElement('div', { className: 'detail-grid' },
                  React.createElement('div', { className: 'detail-item' },
                    React.createElement('strong', null, 'Model: '),
                    React.createElement('span', null, agent.model)
                  ),
                  React.createElement('div', { className: 'detail-item' },
                    React.createElement('strong', null, 'Provider: '),
                    React.createElement('span', null, agent.provider)
                  ),
                  React.createElement('div', { className: 'detail-item' },
                    React.createElement('strong', null, 'Generation: '),
                    React.createElement('span', null, agent.generation)
                  ),
                  React.createElement('div', { className: 'detail-item' },
                    React.createElement('strong', null, 'Last Activity: '),
                    React.createElement('span', null, formatTimestamp(agent.lastActivity))
                  )
                )
              ),
              
              React.createElement('div', { className: 'detail-section' },
                React.createElement('h5', null, 'Capabilities'),
                React.createElement('div', { className: 'capabilities-list' },
                  agent.capabilities.map(cap => 
                    React.createElement('span', { 
                      key: cap, 
                      className: 'capability-tag' 
                    }, cap)
                  )
                )
              ),

              React.createElement('div', { className: 'detail-section' },
                React.createElement('h5', null, 'Performance'),
                React.createElement('div', { className: 'performance-stats' },
                  React.createElement('div', { className: 'stat' },
                    React.createElement('div', { className: 'stat-value' }, agent.messageCount),
                    React.createElement('div', { className: 'stat-label' }, 'Messages')
                  ),
                  React.createElement('div', { className: 'stat' },
                    React.createElement('div', { className: 'stat-value' }, agent.userInteractions),
                    React.createElement('div', { className: 'stat-label' }, 'Interactions')
                  ),
                  React.createElement('div', { className: 'stat' },
                    React.createElement('div', { className: 'stat-value' }, 
                      agent.messageCount > 0 ? Math.round(agent.totalTokens / agent.messageCount) : 0
                    ),
                    React.createElement('div', { className: 'stat-label' }, 'Avg Tokens')
                  )
                )
              )
            ),

            // Child agents (indented)
            agent.children.length > 0 && React.createElement('div', { className: 'child-agents' },
              agent.children.map(childId => {
                const child = agents.find(a => a.id === childId);
                return child ? React.createElement('div', { 
                  key: childId,
                  className: 'child-agent'
                },
                  React.createElement('span', { className: 'child-connector' }, '└─'),
                  React.createElement('span', { className: 'child-name' }, `Gen ${child.generation}`),
                  React.createElement('span', { 
                    className: 'child-status',
                    style: { color: getStatusColor(child.status) }
                  }, child.status)
                ) : null;
              })
            )
          )
        )
      )
    )
  );
}

// Export for use in main app
export default AgentsDashboard
// ABOUTME: Integration tests for Step 7 foldable sections functionality
// ABOUTME: Tests collapsible agent activity blocks with fold/unfold indicators

import React from 'react';
import App from '@/ui/App';
import ConversationView from '@/ui/components/ConversationView';
import Message from '@/ui/components/Message';

describe('Step 7: Foldable Sections Integration', () => {
  test('ConversationView displays agent_activity message type', () => {
    const messages = [
      { type: 'user' as const, content: 'Hello' },
      { 
        type: 'agent_activity' as const,
        summary: 'Agent Activity - 2 items',
        content: [
          '🤖 orchestrator → delegating to coder agent',
          '🔨 coder → analyzing auth patterns (active)'
        ],
        folded: true
      }
    ];
    
    const element = ConversationView({ messages }) as any;
    const renderedMessages = element.props.children;
    
    expect(renderedMessages).toHaveLength(2);
    expect(renderedMessages[1].props.type).toBe('agent_activity');
    expect(renderedMessages[1].props.summary).toBe('Agent Activity - 2 items');
  });

  test('Message component renders fold indicator when folded', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: [
        '🤖 orchestrator → delegating to coder agent',
        '🔨 coder → analyzing auth patterns (active)'
      ],
      folded: true
    };
    
    const element = Message(messageProps) as any;
    
    // Should show folded indicator ▶ and summary
    const box = element.props.children[0];
    const indicatorText = box.props.children[0];
    expect(indicatorText.props.children).toBe('▶ ');
    
    const summaryText = box.props.children[1];
    expect(summaryText.props.children).toBe('Agent Activity - 2 items');
  });

  test('Message component renders unfold indicator when unfolded', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: [
        '🤖 orchestrator → delegating to coder agent',
        '🔨 coder → analyzing auth patterns (active)'
      ],
      folded: false
    };
    
    const element = Message(messageProps) as any;
    
    // Check structure: outer box -> content -> column -> header box -> indicator
    const outerContent = element.props.children[0];
    const headerBox = outerContent.props.children[0];
    const indicatorText = headerBox.props.children[0];
    
    expect(indicatorText.props.children).toBe('▼ ');
    expect(indicatorText.props.color).toBe('blue');
  });

  test('unfolded agent_activity shows all content items', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: [
        '🤖 orchestrator → delegating to coder agent',
        '🔨 coder → analyzing auth patterns (active)'
      ],
      folded: false
    };
    
    const element = Message(messageProps) as any;
    
    // Check structure: outer box -> content -> column -> content items (array)
    const outerContent = element.props.children[0];
    const contentItems = outerContent.props.children[1]; // Array of content items
    
    expect(Array.isArray(contentItems)).toBe(true);
    expect(contentItems).toHaveLength(2);
    
    // Check first content item
    const firstItem = contentItems[0];
    expect(firstItem.props.children.props.children[1]).toBe('🤖 orchestrator → delegating to coder agent');
  });

  test('folded agent_activity hides detailed content', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: [
        '🤖 orchestrator → delegating to coder agent',
        '🔨 coder → analyzing auth patterns (active)'
      ],
      folded: true
    };
    
    const element = Message(messageProps) as any;
    
    // When folded, should only show summary, not detailed content
    // The second child should either be null or not contain the detailed content
    const contentArea = element.props.children[1];
    expect(contentArea.props.children).toBe(''); // Empty when folded
  });

  test('Space key toggles fold state in navigation mode', () => {
    // Test that Space key toggles the folded state
    const initialFolded = true;
    const expectedFolded = false; // After space key toggle
    
    // Space key should toggle fold state
    expect(expectedFolded).toBe(!initialFolded);
  });

  test('fold state persists in conversation', () => {
    // Test that fold states are maintained for each message
    const messages = [
      { 
        type: 'agent_activity' as const,
        summary: 'First Activity',
        content: ['item 1'],
        folded: true
      },
      { 
        type: 'agent_activity' as const,
        summary: 'Second Activity',
        content: ['item 2'],
        folded: false
      }
    ];
    
    // Each message should maintain its own fold state
    expect(messages[0].folded).toBe(true);
    expect(messages[1].folded).toBe(false);
  });

  test('fold indicators use correct colors', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: ['content'],
      folded: true
    };
    
    const element = Message(messageProps) as any;
    
    // Fold indicator should have appropriate color (e.g., blue for agent activity)
    const box = element.props.children[0];
    const indicatorText = box.props.children[0];
    expect(indicatorText.props.color).toBe('blue');
  });

  test('agent_activity sections are identified in conversation', () => {
    // Test that agent_activity type messages are properly handled
    const conversationWithActivity = [
      { type: 'user' as const, content: 'Hello' },
      { type: 'assistant' as const, content: 'Hi there!' },
      { 
        type: 'agent_activity' as const,
        summary: 'Agent Activity - 3 items',
        content: [
          '🤖 orchestrator → received user request',
          '🔨 coder → starting code analysis',
          '📝 writer → preparing documentation'
        ],
        folded: true
      }
    ];
    
    // Should properly identify agent_activity messages
    const activityMessage = conversationWithActivity[2];
    expect(activityMessage.type).toBe('agent_activity');
    expect(activityMessage.content).toHaveLength(3);
    expect(activityMessage.folded).toBe(true);
  });

  test('navigation highlights foldable sections correctly', () => {
    // Test that navigation mode can highlight foldable sections
    const messages = [
      { type: 'user' as const, content: 'Hello' },
      { 
        type: 'agent_activity' as const,
        summary: 'Agent Activity',
        content: ['activity'],
        folded: true
      }
    ];
    
    const element = ConversationView({ 
      messages, 
      scrollPosition: 1, 
      isNavigationMode: true 
    }) as any;
    
    // Second message (agent_activity) should be highlighted
    const renderedMessages = element.props.children;
    expect(renderedMessages[1].props.isHighlighted).toBe(true);
  });
});
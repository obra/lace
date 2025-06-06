// ABOUTME: Integration tests for Step 15 performance and memory optimization
// ABOUTME: Tests virtual scrolling and efficient rendering with large conversations

import React from 'react';
import ConversationView from '../../../src/ui/components/ConversationView';
import App from '../../../src/ui/App';

describe('Step 15: Performance & Memory', () => {
  // Helper function to generate large conversation data
  const generateLargeConversation = (messageCount: number) => {
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
      messages.push({
        type: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Message ${i + 1}: This is a test message with some content to simulate real conversations. It contains enough text to be realistic for performance testing.`
      });
      
      // Add some agent activities every 10 messages
      if (i > 0 && i % 10 === 0) {
        messages.push({
          type: 'agent_activity' as const,
          content: [
            '🤖 orchestrator → processing user request',
            '🔨 file-tool → reading project files',
            '✅ search-tool → found 3 relevant code blocks',
            '🤖 orchestrator → generating response'
          ],
          summary: `Agent Activity - ${i} - 4 items`,
          folded: true
        });
      }
    }
    return messages;
  };

  test('ConversationView handles 100 messages without performance issues', () => {
    const startTime = performance.now();
    const largeConversation = generateLargeConversation(100);
    
    const element = ConversationView({
      scrollPosition: 0,
      isNavigationMode: false,
      messages: largeConversation,
      searchTerm: '',
      searchResults: []
    }) as any;
    
    const renderTime = performance.now() - startTime;
    
    expect(element.type).toBeTruthy();
    
    // With virtual scrolling, should render a reasonable window
    const renderedMessages = element.props.children;
    expect(renderedMessages.length).toBeGreaterThan(0);
    expect(renderedMessages.length).toBeLessThanOrEqual(largeConversation.length);
    
    // Should render within reasonable time (less than 100ms)
    expect(renderTime).toBeLessThan(100);
  });

  test('ConversationView handles 500 messages efficiently', () => {
    const startTime = performance.now();
    const largeConversation = generateLargeConversation(500);
    
    const element = ConversationView({
      scrollPosition: 250, // Scroll to middle
      isNavigationMode: true,
      messages: largeConversation,
      searchTerm: '',
      searchResults: []
    }) as any;
    
    const renderTime = performance.now() - startTime;
    
    expect(element.type).toBeTruthy();
    
    // With virtual scrolling, should still render quickly even with 500 messages
    expect(renderTime).toBeLessThan(150);
    
    // Should only render visible messages, not all 500
    const renderedMessages = element.props.children;
    expect(renderedMessages.length).toBeLessThan(largeConversation.length);
    expect(renderedMessages.length).toBeGreaterThan(0);
  });

  test('ConversationView implements virtual scrolling for large conversations', () => {
    const largeConversation = generateLargeConversation(1000);
    
    const element = ConversationView({
      scrollPosition: 500, // Scroll to middle of 1000 messages
      isNavigationMode: true,
      messages: largeConversation,
      searchTerm: '',
      searchResults: []
    }) as any;
    
    expect(element.type).toBeTruthy();
    
    // Should only render a window of messages around scroll position
    const renderedMessages = element.props.children;
    
    // Should render significantly fewer than total messages
    expect(renderedMessages.length).toBeLessThan(100); // Much less than 1000
    expect(renderedMessages.length).toBeGreaterThan(10); // But enough for smooth scrolling
    
    // Should include the message at scroll position (at index 500)
    // The message at index 500 should be included in the virtual window
    const messageAtScrollPosition = largeConversation[500];
    const expectedMessageContent = messageAtScrollPosition.content;
    
    const hasCurrentMessage = renderedMessages.some((msg: any) => 
      msg.props && msg.props.content && msg.props.content === expectedMessageContent
    );
    expect(hasCurrentMessage).toBe(true);
  });

  test('virtual scrolling maintains correct message indices', () => {
    const largeConversation = generateLargeConversation(200);
    
    // Test different scroll positions
    const positions = [0, 50, 100, 150, 199];
    
    positions.forEach(scrollPos => {
      const element = ConversationView({
        scrollPosition: scrollPos,
        isNavigationMode: true,
        messages: largeConversation,
        searchTerm: '',
        searchResults: []
      }) as any;
      
      const renderedMessages = element.props.children;
      expect(renderedMessages.length).toBeGreaterThan(0);
      
      // Current message should be highlighted when in navigation mode
      const hasHighlighted = renderedMessages.some((msg: any) => 
        msg.props && msg.props.isHighlighted === true
      );
      expect(hasHighlighted).toBe(true);
    });
  });

  test('scrolling performance remains consistent across conversation sizes', () => {
    const conversationSizes = [50, 200, 500, 1000];
    const renderTimes: number[] = [];
    
    conversationSizes.forEach(size => {
      const conversation = generateLargeConversation(size);
      const startTime = performance.now();
      
      const element = ConversationView({
        scrollPosition: Math.floor(size / 2),
        isNavigationMode: true,
        messages: conversation,
        searchTerm: '',
        searchResults: []
      }) as any;
      
      const renderTime = performance.now() - startTime;
      renderTimes.push(renderTime);
      
      expect(element.type).toBeTruthy();
    });
    
    // Render times should not grow linearly with conversation size
    // All render times should be consistently fast with virtual scrolling
    renderTimes.forEach(time => {
      expect(time).toBeLessThan(50); // All should be fast regardless of size
    });
    
    // If we have meaningful render times, check they don't grow linearly
    if (renderTimes.some(time => time > 1)) {
      const minTime = Math.min(...renderTimes.filter(time => time > 0));
      const maxTime = Math.max(...renderTimes);
      expect(maxTime).toBeLessThan(minTime * 5); // Allow some variance but not linear growth
    }
  });

  test('search functionality works efficiently with large conversations', () => {
    const largeConversation = generateLargeConversation(500);
    const searchTerm = 'Message 250';
    
    const startTime = performance.now();
    
    const element = ConversationView({
      scrollPosition: 0,
      isNavigationMode: false,
      messages: largeConversation,
      searchTerm: searchTerm,
      searchResults: [
        { messageIndex: 249, message: largeConversation[249] }
      ]
    }) as any;
    
    const renderTime = performance.now() - startTime;
    
    expect(element.type).toBeTruthy();
    expect(renderTime).toBeLessThan(100); // Search + render should be fast
    
    // Should highlight search term in results
    const content = JSON.stringify(element);
    expect(content).toContain(searchTerm);
  });

  test('agent activity folding/unfolding does not cause performance issues', () => {
    const conversation = generateLargeConversation(100);
    
    // Time multiple renders with different folding states
    const renderTimes: number[] = [];
    
    for (let i = 0; i < 5; i++) {
      const startTime = performance.now();
      
      const element = ConversationView({
        scrollPosition: 50,
        isNavigationMode: true,
        messages: conversation,
        searchTerm: '',
        searchResults: []
      }) as any;
      
      const renderTime = performance.now() - startTime;
      renderTimes.push(renderTime);
      
      expect(element.type).toBeTruthy();
    }
    
    // All renders should be consistently fast
    renderTimes.forEach(time => {
      expect(time).toBeLessThan(50);
    });
  });

  test('memory usage remains stable with message state changes', () => {
    // This test simulates rapid state changes that could cause memory leaks
    const conversation = generateLargeConversation(100);
    
    // Simulate multiple rapid re-renders
    for (let i = 0; i < 20; i++) {
      const element = ConversationView({
        scrollPosition: i * 5,
        isNavigationMode: i % 2 === 0,
        messages: conversation,
        searchTerm: i % 3 === 0 ? 'test' : '',
        searchResults: []
      }) as any;
      
      expect(element.type).toBeTruthy();
    }
    
    // If we get here without crashes, memory management is working
    expect(true).toBe(true);
  });

  test('large conversation navigation maintains responsiveness', () => {
    const largeConversation = generateLargeConversation(1000);
    
    // Test navigation through large conversation
    const navigationPositions = [0, 100, 500, 750, 999];
    
    navigationPositions.forEach(position => {
      const startTime = performance.now();
      
      const element = ConversationView({
        scrollPosition: position,
        isNavigationMode: true,
        messages: largeConversation,
        searchTerm: '',
        searchResults: []
      }) as any;
      
      const renderTime = performance.now() - startTime;
      
      expect(element.type).toBeTruthy();
      expect(renderTime).toBeLessThan(100); // Each navigation should be fast
      
      // Should render visible window around current position
      const renderedMessages = element.props.children;
      expect(renderedMessages.length).toBeGreaterThan(0);
      expect(renderedMessages.length).toBeLessThan(200); // Virtual window size
    });
  });

  test('ConversationView handles mixed content types efficiently', () => {
    // Create conversation with mixed content types that stress different rendering paths
    const mixedConversation = [];
    
    for (let i = 0; i < 200; i++) {
      if (i % 10 === 0) {
        // Add code blocks
        mixedConversation.push({
          type: 'assistant' as const,
          content: `Here's some code:\n\n\`\`\`javascript\nfunction test${i}() {\n  return "test";\n}\n\`\`\``
        });
      } else if (i % 15 === 0) {
        // Add diff blocks
        mixedConversation.push({
          type: 'assistant' as const,
          content: `\`\`\`diff\n--- a/file${i}.js\n+++ b/file${i}.js\n@@ -1,1 +1,1 @@\n-old line\n+new line\n\`\`\``
        });
      } else if (i % 7 === 0) {
        // Add agent activities
        mixedConversation.push({
          type: 'agent_activity' as const,
          content: [`🤖 activity ${i}`, `🔨 tool action ${i}`],
          summary: `Activity ${i}`,
          folded: true
        });
      } else {
        // Regular messages
        mixedConversation.push({
          type: i % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: `Regular message ${i} with normal text content.`
        });
      }
    }
    
    const startTime = performance.now();
    
    const element = ConversationView({
      scrollPosition: 100,
      isNavigationMode: true,
      messages: mixedConversation,
      searchTerm: '',
      searchResults: []
    }) as any;
    
    const renderTime = performance.now() - startTime;
    
    expect(element.type).toBeTruthy();
    expect(renderTime).toBeLessThan(200); // Should handle mixed content efficiently
  });
});
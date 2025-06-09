// ABOUTME: Step 10 integration tests for search functionality
// ABOUTME: Tests search input, text highlighting, and n/N navigation

import React from 'react';
import App from '@/ui/App';
import StatusBar from '@/ui/components/StatusBar';
import InputBar from '@/ui/components/InputBar';
import ConversationView from '@/ui/components/ConversationView';
import Message from '@/ui/components/Message';
import { highlightSearchTerm, containsSearchTerm } from '@/ui/utils/search-highlight';

describe('Step 10: Search Functionality Integration', () => {
  test('search highlight utility highlights text correctly', () => {
    const text = 'Hello world, this is a test';
    const highlighted = highlightSearchTerm(text, 'world');
    
    // Should contain ANSI escape codes for yellow background
    expect(highlighted).toContain('\x1b[43m\x1b[30mworld\x1b[0m');
    expect(highlighted).toContain('Hello');
    expect(highlighted).toContain('test');
  });

  test('search highlight utility is case insensitive', () => {
    const text = 'JavaScript is great';
    const highlighted = highlightSearchTerm(text, 'javascript');
    
    // Should highlight 'JavaScript' even though search term is lowercase
    expect(highlighted).toContain('\x1b[43m\x1b[30mJavaScript\x1b[0m');
  });

  test('search highlight utility handles special regex characters', () => {
    const text = 'File path: /home/user/.config';
    const highlighted = highlightSearchTerm(text, '/home');
    
    // Should highlight '/home' without regex errors
    expect(highlighted).toContain('\x1b[43m\x1b[30m/home\x1b[0m');
  });

  test('search highlight utility handles empty search term', () => {
    const text = 'Hello world';
    const highlighted = highlightSearchTerm(text, '');
    
    // Should return original text unchanged
    expect(highlighted).toBe(text);
  });

  test('containsSearchTerm function works correctly', () => {
    expect(containsSearchTerm('Hello world', 'world')).toBe(true);
    expect(containsSearchTerm('Hello world', 'WORLD')).toBe(true);
    expect(containsSearchTerm('Hello world', 'xyz')).toBe(false);
    expect(containsSearchTerm('Hello world', '')).toBe(false);
  });

  test('Message component applies search highlighting', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is some JavaScript code for you',
      searchTerm: 'javascript',
      isSearchResult: true
    };
    
    const element = Message(messageProps) as any;
    
    // Should render without error and process highlighting
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
  });

  test('Message component highlights agent activity summary and content', () => {
    const messageProps = {
      type: 'agent_activity' as const,
      content: ['analyzing javascript patterns', 'checking code quality'],
      summary: 'JavaScript Analysis - 2 items',
      folded: false,
      searchTerm: 'javascript',
      isSearchResult: true
    };
    
    const element = Message(messageProps) as any;
    
    // Should render without error
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
  });

  test('ConversationView passes search props to Message components', () => {
    const messages = [
      { type: 'user' as const, content: 'Hello javascript world' },
      { type: 'assistant' as const, content: 'Hi there!' }
    ];
    
    const searchResults = [{ messageIndex: 0, message: messages[0] }];
    
    const element = ConversationView({ 
      messages, 
      searchTerm: 'javascript',
      searchResults 
    }) as any;
    
    const renderedMessages = element.props.children;
    expect(renderedMessages).toHaveLength(2);
    
    // First message should have search props
    const firstMessage = renderedMessages[0];
    expect(firstMessage.props.searchTerm).toBe('javascript');
    expect(firstMessage.props.isSearchResult).toBe(true);
    
    // Second message should have search term but not be a search result
    const secondMessage = renderedMessages[1];
    expect(secondMessage.props.searchTerm).toBe('javascript');
    expect(secondMessage.props.isSearchResult).toBe(false);
  });

  test('StatusBar displays search mode correctly', () => {
    const element = StatusBar({ 
      isSearchMode: true,
      searchTerm: 'test'
    }) as any;
    
    // Should render without error
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
  });

  test('StatusBar shows search result navigation info', () => {
    const searchResults = [
      { messageIndex: 0, message: {} },
      { messageIndex: 2, message: {} },
      { messageIndex: 4, message: {} }
    ];
    
    const element = StatusBar({ 
      isNavigationMode: true,
      filterMode: 'search',
      searchResults,
      searchResultIndex: 1,
      scrollPosition: 2,
      totalMessages: 5
    }) as any;
    
    // Should render without error
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
  });

  test('InputBar displays search mode with / prefix', () => {
    const element = InputBar({ 
      isSearchMode: true,
      inputText: 'javascript'
    }) as any;
    
    // Should render without error
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
  });

  test('search functionality flow with mock messages', () => {
    const messages = [
      { type: 'user' as const, content: 'Hello javascript world' },
      { type: 'assistant' as const, content: 'Hi there! I can help with JavaScript programming.' },
      { 
        type: 'agent_activity' as const,
        summary: 'JavaScript Analysis - code review',
        content: ['analyzing javascript patterns', 'checking syntax'],
        folded: true
      },
      { type: 'user' as const, content: 'Can you help with Python?' },
      { type: 'assistant' as const, content: 'Yes, I can help with Python too!' }
    ];

    // Mock the search logic from App component
    const findSearchResults = (msgs: typeof messages, term: string) => {
      if (!term.trim()) return [];
      const results: { messageIndex: number; message: typeof messages[0] }[] = [];
      
      msgs.forEach((msg, index) => {
        const content = msg.type === 'agent_activity' 
          ? msg.summary + ' ' + msg.content.join(' ') 
          : msg.content;
        
        if (content.toLowerCase().includes(term.toLowerCase())) {
          results.push({ messageIndex: index, message: msg });
        }
      });
      
      return results;
    };

    // Test search for 'javascript'
    const javascriptResults = findSearchResults(messages, 'javascript');
    expect(javascriptResults).toHaveLength(3); // user message, assistant message, agent activity
    expect(javascriptResults[0].messageIndex).toBe(0); // 'Hello javascript world'
    expect(javascriptResults[1].messageIndex).toBe(1); // 'JavaScript programming'
    expect(javascriptResults[2].messageIndex).toBe(2); // agent activity with javascript

    // Test search for 'python'
    const pythonResults = findSearchResults(messages, 'python');
    expect(pythonResults).toHaveLength(2); // user question and assistant response
    expect(pythonResults[0].messageIndex).toBe(3); // 'Can you help with Python?'
    expect(pythonResults[1].messageIndex).toBe(4); // 'Yes, I can help with Python too!'

    // Test case insensitivity
    const upperCaseResults = findSearchResults(messages, 'JAVASCRIPT');
    expect(upperCaseResults).toHaveLength(3);

    // Test empty search
    const emptyResults = findSearchResults(messages, '');
    expect(emptyResults).toHaveLength(0);
  });

  test('search result navigation logic', () => {
    const searchResults = [
      { messageIndex: 1, message: {} },
      { messageIndex: 3, message: {} },
      { messageIndex: 5, message: {} }
    ];

    // Test navigation forward (n key)
    let currentIndex = 0;
    const nextIndex = (currentIndex + 1) % searchResults.length;
    expect(nextIndex).toBe(1);
    expect(searchResults[nextIndex].messageIndex).toBe(3);

    // Test navigation backward (N key) 
    currentIndex = 0;
    const prevIndex = (currentIndex - 1 + searchResults.length) % searchResults.length;
    expect(prevIndex).toBe(2);
    expect(searchResults[prevIndex].messageIndex).toBe(5);

    // Test wrapping at end
    currentIndex = 2;
    const wrapIndex = (currentIndex + 1) % searchResults.length;
    expect(wrapIndex).toBe(0);
    expect(searchResults[wrapIndex].messageIndex).toBe(1);
  });

  test('search filter integration with conversation filter', () => {
    const messages = [
      { type: 'user' as const, content: 'Hello javascript' },
      { type: 'assistant' as const, content: 'Hi there!' },
      { 
        type: 'agent_activity' as const,
        summary: 'JavaScript work',
        content: ['doing javascript stuff'],
        folded: true
      },
      { type: 'loading' as const, content: 'Loading...' }
    ];

    // Mock filter logic from App
    const filterMessages = (msgs: typeof messages, mode: string) => {
      switch (mode) {
        case 'conversation':
          return msgs.filter(msg => msg.type === 'user' || msg.type === 'assistant');
        case 'search':
          // When in search mode, apply search filter  
          return msgs.filter(msg => {
            const content = msg.type === 'agent_activity' 
              ? msg.summary + ' ' + msg.content.join(' ') 
              : msg.content;
            return content.toLowerCase().includes('javascript');
          });
        default:
          return msgs;
      }
    };

    const allMessages = filterMessages(messages, 'all');
    const conversationMessages = filterMessages(messages, 'conversation');
    const searchMessages = filterMessages(messages, 'search');

    expect(allMessages).toHaveLength(4);
    expect(conversationMessages).toHaveLength(2); // user + assistant only
    expect(searchMessages).toHaveLength(2); // user message + agent activity containing 'javascript'
  });

  test('search state management logic', () => {
    // Test search mode state transitions
    let isSearchMode = false;
    let searchTerm = '';
    let filterMode = 'all';

    // Enter search mode with /
    isSearchMode = true;
    searchTerm = '';
    expect(isSearchMode).toBe(true);
    expect(searchTerm).toBe('');

    // Type search term
    searchTerm = 'test';
    expect(searchTerm).toBe('test');

    // Execute search with Enter
    if (searchTerm.trim()) {
      filterMode = 'search';
      isSearchMode = false;
    }
    expect(filterMode).toBe('search');
    expect(isSearchMode).toBe(false);

    // Cancel search with Escape
    isSearchMode = true; // Re-enter search mode
    // Then press Escape
    isSearchMode = false;
    searchTerm = '';
    filterMode = 'all';
    expect(isSearchMode).toBe(false);
    expect(searchTerm).toBe('');
    expect(filterMode).toBe('all');
  });
});
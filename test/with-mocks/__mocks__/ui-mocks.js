// ABOUTME: Mock factory for UI components, hooks, and interactions
// ABOUTME: Provides standardized mocks for React components, Ink utilities, and user interactions

import { jest } from "@jest/globals";

/**
 * Mock text buffer hook for ShellInput component
 * @param {object} options - Configuration options
 * @returns {Array} Mock hook return value [buffer, operations]
 */
export function createMockUseTextBuffer(options = {}) {
  const {
    initialText = "",
    initialCursorLine = 0,
    initialCursorColumn = 0,
    multiline = false
  } = options;

  const mockBuffer = {
    lines: initialText ? initialText.split('\n') : [""],
    cursorLine: initialCursorLine,
    cursorColumn: initialCursorColumn,
    totalLines: initialText ? initialText.split('\n').length : 1
  };

  const mockOperations = {
    getText: jest.fn(() => mockBuffer.lines.join('\n')),
    setText: jest.fn((text) => {
      mockBuffer.lines = text.split('\n');
      mockBuffer.cursorLine = Math.max(0, Math.min(mockBuffer.lines.length - 1, mockBuffer.cursorLine));
      mockBuffer.cursorColumn = Math.max(0, Math.min(mockBuffer.lines[mockBuffer.cursorLine].length, mockBuffer.cursorColumn));
      mockBuffer.totalLines = mockBuffer.lines.length;
    }),
    insertText: jest.fn((text) => {
      const currentLine = mockBuffer.lines[mockBuffer.cursorLine];
      const before = currentLine.substring(0, mockBuffer.cursorColumn);
      const after = currentLine.substring(mockBuffer.cursorColumn);
      mockBuffer.lines[mockBuffer.cursorLine] = before + text + after;
      mockBuffer.cursorColumn += text.length;
    }),
    deleteText: jest.fn((start, end) => {
      const text = mockBuffer.lines.join('\n');
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newText = before + after;
      mockOperations.setText(newText);
    }),
    moveCursor: jest.fn((line, column) => {
      mockBuffer.cursorLine = Math.max(0, Math.min(mockBuffer.lines.length - 1, line));
      mockBuffer.cursorColumn = Math.max(0, Math.min(mockBuffer.lines[mockBuffer.cursorLine].length, column));
    }),
    insertNewline: jest.fn(() => {
      const currentLine = mockBuffer.lines[mockBuffer.cursorLine];
      const before = currentLine.substring(0, mockBuffer.cursorColumn);
      const after = currentLine.substring(mockBuffer.cursorColumn);
      
      mockBuffer.lines[mockBuffer.cursorLine] = before;
      mockBuffer.lines.splice(mockBuffer.cursorLine + 1, 0, after);
      mockBuffer.cursorLine++;
      mockBuffer.cursorColumn = 0;
      mockBuffer.totalLines++;
    }),
    deleteBackward: jest.fn(() => {
      if (mockBuffer.cursorColumn > 0) {
        const currentLine = mockBuffer.lines[mockBuffer.cursorLine];
        const before = currentLine.substring(0, mockBuffer.cursorColumn - 1);
        const after = currentLine.substring(mockBuffer.cursorColumn);
        mockBuffer.lines[mockBuffer.cursorLine] = before + after;
        mockBuffer.cursorColumn--;
      } else if (mockBuffer.cursorLine > 0) {
        const currentLine = mockBuffer.lines[mockBuffer.cursorLine];
        const previousLine = mockBuffer.lines[mockBuffer.cursorLine - 1];
        mockBuffer.cursorColumn = previousLine.length;
        mockBuffer.lines[mockBuffer.cursorLine - 1] = previousLine + currentLine;
        mockBuffer.lines.splice(mockBuffer.cursorLine, 1);
        mockBuffer.cursorLine--;
        mockBuffer.totalLines--;
      }
    }),
    clear: jest.fn(() => {
      mockBuffer.lines = [""];
      mockBuffer.cursorLine = 0;
      mockBuffer.cursorColumn = 0;
      mockBuffer.totalLines = 1;
    }),
    // Test helpers
    _getBuffer: () => ({ ...mockBuffer }),
    _setBuffer: (newBuffer) => {
      Object.assign(mockBuffer, newBuffer);
    }
  };

  return [mockBuffer, mockOperations];
}

/**
 * Mock Lace UI main interface
 * @param {object} options - Configuration options
 * @returns {object} Mock Lace UI object
 */
export function createMockLaceUI(options = {}) {
  const {
    isRunning = false,
    currentSession = "test-session"
  } = options;

  const callbacks = {
    toolApproval: null,
    userInput: null,
    statusUpdate: null
  };

  return {
    isRunning,
    currentSession,
    uiRef: null,
    commandManager: null,
    
    setToolApprovalUICallback: jest.fn((callback) => {
      callbacks.toolApproval = callback;
    }),
    
    setUserInputCallback: jest.fn((callback) => {
      callbacks.userInput = callback;
    }),
    
    setStatusUpdateCallback: jest.fn((callback) => {
      callbacks.statusUpdate = callback;
    }),
    
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    
    displayMessage: jest.fn((message) => {
      // Simulate message display
    }),
    
    displayError: jest.fn((error) => {
      // Simulate error display
    }),
    
    updateStatus: jest.fn((status) => {
      if (callbacks.statusUpdate) {
        callbacks.statusUpdate(status);
      }
    }),
    
    // Test helpers
    _getCallbacks: () => ({ ...callbacks }),
    _triggerToolApproval: (toolCall) => {
      if (callbacks.toolApproval) {
        return callbacks.toolApproval(toolCall);
      }
      return Promise.resolve(true);
    },
    _triggerUserInput: (prompt) => {
      if (callbacks.userInput) {
        return callbacks.userInput(prompt);
      }
      return Promise.resolve("mock user input");
    }
  };
}

/**
 * Mock Ink rendering utilities
 * @param {object} options - Configuration options
 * @returns {object} Mock Ink utilities
 */
export function createMockInkUtils(options = {}) {
  let lastFrame = "";
  let renderCount = 0;
  
  return {
    render: jest.fn((element) => {
      renderCount++;
      lastFrame = `Mock render ${renderCount}: ${element?.type?.name || 'Component'}`;
      return {
        lastFrame: () => lastFrame,
        unmount: jest.fn(),
        rerender: jest.fn((newElement) => {
          renderCount++;
          lastFrame = `Mock render ${renderCount}: ${newElement?.type?.name || 'Component'}`;
        })
      };
    }),
    
    Box: jest.fn(({ children, ...props }) => ({
      type: 'Box',
      props: { children, ...props }
    })),
    
    Text: jest.fn(({ children, ...props }) => ({
      type: 'Text',
      props: { children, ...props }
    })),
    
    useInput: jest.fn((handler) => {
      // Mock input handler registration
      return handler;
    }),
    
    useStdout: jest.fn(() => ({
      stdout: {
        columns: 80,
        rows: 24,
        write: jest.fn()
      }
    })),
    
    // Test helpers
    _getLastFrame: () => lastFrame,
    _getRenderCount: () => renderCount,
    _resetRenderCount: () => { renderCount = 0; }
  };
}

/**
 * Mock props for common UI components
 */
export const MOCK_COMPONENT_PROPS = {
  ShellInput: {
    value: "",
    placeholder: "Type your message...",
    focusId: "test-input",
    autoFocus: false,
    multiline: false,
    onSubmit: jest.fn(),
    onChange: jest.fn(),
    onCancel: jest.fn()
  },
  
  ConversationView: {
    messages: [],
    isProcessing: false,
    sessionId: "test-session",
    onMessageAction: jest.fn()
  },
  
  Message: {
    role: "user",
    content: "Test message",
    timestamp: new Date().toISOString(),
    isProcessing: false,
    showToolCalls: false
  },
  
  StatusBar: {
    status: "Ready",
    sessionId: "test-session",
    generation: 0,
    contextUsage: { used: 1000, total: 200000, percentage: 0.5 },
    isProcessing: false
  },
  
  ToolApprovalModal: {
    isVisible: false,
    toolCall: null,
    onApprove: jest.fn(),
    onDeny: jest.fn(),
    onCancel: jest.fn()
  }
};

/**
 * Create mock props for a specific component
 * @param {string} componentName - Name of the component
 * @param {object} overrides - Props to override
 * @returns {object} Mock props object
 */
export function createMockComponentProps(componentName, overrides = {}) {
  const baseProps = MOCK_COMPONENT_PROPS[componentName] || {};
  
  return {
    ...baseProps,
    ...overrides
  };
}

/**
 * Mock stream utilities for testing streaming responses
 * @param {object} options - Configuration options
 * @returns {object} Mock stream utilities
 */
export function createMockStreamUtils(options = {}) {
  const {
    chunks = ["Hello", " ", "world", "!"],
    delay = 50,
    shouldError = false
  } = options;
  
  let chunkIndex = 0;
  const subscribers = [];
  
  return {
    createStream: jest.fn(() => ({
      subscribe: jest.fn((callback) => {
        subscribers.push(callback);
        
        const interval = setInterval(() => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            subscribers.forEach(cb => cb({ type: 'chunk', data: chunk }));
          } else {
            clearInterval(interval);
            if (shouldError) {
              subscribers.forEach(cb => cb({ type: 'error', error: new Error('Stream error') }));
            } else {
              subscribers.forEach(cb => cb({ type: 'end' }));
            }
          }
        }, delay);
        
        return {
          unsubscribe: () => {
            clearInterval(interval);
            const index = subscribers.indexOf(callback);
            if (index > -1) subscribers.splice(index, 1);
          }
        };
      })
    })),
    
    // Test helpers
    _getSubscribers: () => [...subscribers],
    _emitChunk: (chunk) => {
      subscribers.forEach(cb => cb({ type: 'chunk', data: chunk }));
    },
    _emitError: (error) => {
      subscribers.forEach(cb => cb({ type: 'error', error }));
    },
    _emitEnd: () => {
      subscribers.forEach(cb => cb({ type: 'end' }));
    }
  };
}

/**
 * Mock keyboard interaction utilities
 * @param {object} options - Configuration options
 * @returns {object} Mock keyboard utilities
 */
export function createMockKeyboardUtils(options = {}) {
  const keyHandlers = new Map();
  
  return {
    registerKeyHandler: jest.fn((key, handler) => {
      keyHandlers.set(key, handler);
    }),
    
    unregisterKeyHandler: jest.fn((key) => {
      keyHandlers.delete(key);
    }),
    
    simulateKeyPress: jest.fn((key, meta = {}) => {
      const handler = keyHandlers.get(key);
      if (handler) {
        handler(key, meta);
      }
    }),
    
    // Common key simulations
    simulateEnter: jest.fn(() => {
      const handler = keyHandlers.get('return');
      if (handler) handler('return', {});
    }),
    
    simulateEscape: jest.fn(() => {
      const handler = keyHandlers.get('escape');
      if (handler) handler('escape', {});
    }),
    
    simulateCtrlC: jest.fn(() => {
      const handler = keyHandlers.get('ctrl+c');
      if (handler) handler('ctrl+c', { ctrl: true });
    }),
    
    // Test helpers
    _getRegisteredHandlers: () => new Map(keyHandlers),
    _clearHandlers: () => keyHandlers.clear()
  };
}

/**
 * Create comprehensive UI test utilities
 * @param {object} options - Configuration options
 * @returns {object} Complete UI testing utilities
 */
export function createUITestUtils(options = {}) {
  return {
    textBuffer: createMockUseTextBuffer(options.textBuffer),
    laceUI: createMockLaceUI(options.laceUI),
    inkUtils: createMockInkUtils(options.inkUtils),
    streamUtils: createMockStreamUtils(options.streamUtils),
    keyboardUtils: createMockKeyboardUtils(options.keyboardUtils),
    
    // Component prop factories
    createProps: (componentName, overrides) => createMockComponentProps(componentName, overrides),
    
    // Common test scenarios
    renderComponent: jest.fn((Component, props = {}) => {
      const mockInk = createMockInkUtils();
      return mockInk.render(Component(props));
    }),
    
    simulateUserInput: jest.fn((input) => {
      // Simulate user typing
      return Promise.resolve(input);
    }),
    
    simulateToolApproval: jest.fn((approve = true) => {
      // Simulate tool approval decision
      return Promise.resolve(approve);
    })
  };
}

/**
 * Common UI test scenarios
 */
export const UI_TEST_SCENARIOS = {
  emptyInput: {
    textBuffer: { initialText: "" },
    expectedBehavior: "should render empty input field"
  },
  
  withText: {
    textBuffer: { initialText: "Hello world" },
    expectedBehavior: "should render with initial text"
  },
  
  multiline: {
    textBuffer: { initialText: "Line 1\nLine 2\nLine 3", multiline: true },
    expectedBehavior: "should handle multiline input"
  },
  
  streamingResponse: {
    streamUtils: { chunks: ["Processing", "...", " Complete!"], delay: 100 },
    expectedBehavior: "should handle streaming text"
  },
  
  errorState: {
    streamUtils: { shouldError: true },
    expectedBehavior: "should handle stream errors"
  },
  
  toolApprovalRequired: {
    laceUI: { isRunning: true },
    expectedBehavior: "should prompt for tool approval"
  }
};

/**
 * Create a jest module mock for useTextBuffer hook
 * @param {object} options - Configuration options for the mock
 * @returns {object} Jest module mock object
 */
export function createUseTextBufferModuleMock(options = {}) {
  const mockHook = createMockUseTextBuffer(options);
  
  return {
    useTextBuffer: jest.fn(() => mockHook)
  };
}
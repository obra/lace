// ABOUTME: Input context provider for managing single useInput hook with routing
// ABOUTME: Enables multiple components to register input handlers with priority and conditions

import React, { createContext, useContext, useCallback, useRef, useEffect, useState } from 'react';
import { useInput } from 'ink';

interface InputHandler {
  id: string;
  priority: number;
  condition: () => boolean;
  handler: (input: string, key: any) => boolean | void; // return true to stop propagation
}

interface InputContextValue {
  registerInputHandler: (id: string, config: Omit<InputHandler, 'id'>) => () => void;
  setInputMode: (mode: string) => void;
  getInputMode: () => string;
}

const InputContext = createContext<InputContextValue | null>(null);

export const useInputContext = () => {
  const context = useContext(InputContext);
  if (!context) {
    throw new Error('useInputContext must be used within an InputProvider');
  }
  return context;
};

interface InputProviderProps {
  children: React.ReactNode;
}

export const InputProvider: React.FC<InputProviderProps> = ({ children }) => {
  const handlersRef = useRef<Map<string, InputHandler>>(new Map());
  const [inputMode, setInputModeState] = useState<string>('normal');

  // Single useInput hook that routes to registered handlers
  useInput((input, key) => {
    const handlers = Array.from(handlersRef.current.values())
      .filter(handler => handler.condition())
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    for (const handler of handlers) {
      try {
        const shouldStop = handler.handler(input, key);
        if (shouldStop === true) {
          break; // Stop propagation
        }
      } catch (error) {
        console.error(`Error in input handler ${handler.id}:`, error);
      }
    }
  });

  const registerInputHandler = useCallback((id: string, config: Omit<InputHandler, 'id'>) => {
    const handler: InputHandler = {
      id,
      ...config
    };

    handlersRef.current.set(id, handler);

    // Return cleanup function
    return () => {
      handlersRef.current.delete(id);
    };
  }, []);

  const setInputMode = useCallback((mode: string) => {
    setInputModeState(mode);
  }, []);

  const getInputMode = useCallback(() => inputMode, [inputMode]);

  const contextValue: InputContextValue = {
    registerInputHandler,
    setInputMode,
    getInputMode
  };

  return (
    <InputContext.Provider value={contextValue}>
      {children}
    </InputContext.Provider>
  );
};
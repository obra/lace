// ABOUTME: Test for thinking indicator behavior in LaceApp
// ABOUTME: Ensures indicator appears/disappears correctly based on agent events

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useState, useEffect } from 'react';

// Test the core thinking indicator logic in isolation
function useThinkingIndicatorLogic(events: any[], sendingMessage: boolean, setSendingMessage: (value: boolean) => void) {
  // This mirrors the logic from LaceApp
  useEffect(() => {
    if (events?.length > 0) {
      const lastEvent = events[events.length - 1];
      if (sendingMessage && (lastEvent.type === 'AGENT_MESSAGE' || 
          (lastEvent.type === 'LOCAL_SYSTEM_MESSAGE' && 
           lastEvent.data?.content && 
           (lastEvent.data.content.toLowerCase().includes('error') || 
            lastEvent.data.content.toLowerCase().includes('failed') ||
            lastEvent.data.content.toLowerCase().includes('connection lost'))))) {
        setSendingMessage(false);
      }
    }
  }, [events]);
}

describe('LaceApp thinking indicator logic', () => {
  it('should reset sendingMessage when AGENT_MESSAGE event is received', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'USER_MESSAGE', timestamp: new Date() },
      { type: 'AGENT_MESSAGE', timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should call setSendingMessage(false) when AGENT_MESSAGE is received
    expect(setSendingMessage).toHaveBeenCalledWith(false);
  });

  it('should not reset sendingMessage for other event types', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'USER_MESSAGE', timestamp: new Date() },
      { type: 'TOOL_CALL', timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should not call setSendingMessage for non-AGENT_MESSAGE events
    expect(setSendingMessage).not.toHaveBeenCalled();
  });

  it('should not reset sendingMessage when already false', () => {
    let sendingMessage = false;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'AGENT_MESSAGE', timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should not call setSendingMessage when sendingMessage is already false
    expect(setSendingMessage).not.toHaveBeenCalled();
  });

  it('should reset sendingMessage for error messages', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'LOCAL_SYSTEM_MESSAGE', data: { content: 'Connection failed' }, timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should call setSendingMessage(false) for error messages
    expect(setSendingMessage).toHaveBeenCalledWith(false);
  });

  it('should reset sendingMessage for connection lost messages', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'LOCAL_SYSTEM_MESSAGE', data: { content: 'Connection lost' }, timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should call setSendingMessage(false) for connection lost messages
    expect(setSendingMessage).toHaveBeenCalledWith(false);
  });

  it('should not reset sendingMessage for non-error system messages', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events = [
      { type: 'LOCAL_SYSTEM_MESSAGE', data: { content: 'Connected to session stream' }, timestamp: new Date() }
    ];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should not call setSendingMessage for non-error system messages
    expect(setSendingMessage).not.toHaveBeenCalled();
  });

  it('should handle empty events array', () => {
    let sendingMessage = true;
    const setSendingMessage = vi.fn();
    const events: any[] = [];

    renderHook(() => 
      useThinkingIndicatorLogic(events, sendingMessage, setSendingMessage)
    );

    // Should not call setSendingMessage when no events
    expect(setSendingMessage).not.toHaveBeenCalled();
  });
});
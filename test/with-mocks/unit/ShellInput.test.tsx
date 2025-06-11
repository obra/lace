// ABOUTME: Unit tests for ShellInput component
// ABOUTME: Tests shell input component structure and basic behavior

import { jest, describe, test, expect } from "@jest/globals";
import React from "react";
import ShellInput from "@/ui/components/ShellInput";
import { Box, Text } from "ink";

// Mock the useTextBuffer hook since it contains complex logic
jest.mock("@/ui/components/useTextBuffer", () => ({
  useTextBuffer: jest.fn(() => [
    {
      lines: [""],
      cursorLine: 0,
      cursorColumn: 0
    },
    {
      getText: jest.fn(() => ""),
      setText: jest.fn(),
      setCursorPosition: jest.fn(),
      insertText: jest.fn(),
      deleteChar: jest.fn(),
      moveCursor: jest.fn(),
      killLine: jest.fn(),
      killLineBackward: jest.fn(),
      addDebug: jest.fn()
    }
  ])
}));

describe("ShellInput Component", () => {
  const defaultProps = {
    value: "",
    placeholder: "Type your message...",
    focusId: "test-input",
    autoFocus: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("user can see shell input structure", () => {
    const element = ShellInput(defaultProps) as any;

    // Should return a Box with column direction
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe("column");
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input with initial value", () => {
    // Mock the useTextBuffer to return initial value
    const mockUseTextBuffer = require("@/ui/components/useTextBuffer").useTextBuffer;
    mockUseTextBuffer.mockReturnValue([
      {
        lines: ["Hello world"],
        cursorLine: 0,
        cursorColumn: 11
      },
      {
        getText: jest.fn(() => "Hello world"),
        setText: jest.fn(),
        setCursorPosition: jest.fn(),
        insertText: jest.fn(),
        deleteChar: jest.fn(),
        moveCursor: jest.fn(),
        killLine: jest.fn(),
        killLineBackward: jest.fn(),
        addDebug: jest.fn()
      }
    ]);

    const element = ShellInput({
      ...defaultProps,
      value: "Hello world"
    }) as any;

    // Should render successfully with content
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see multi-line input structure", () => {
    // Mock multi-line content
    const mockUseTextBuffer = require("@/ui/components/useTextBuffer").useTextBuffer;
    mockUseTextBuffer.mockReturnValue([
      {
        lines: ["Line 1", "Line 2", "Line 3"],
        cursorLine: 1,
        cursorColumn: 4
      },
      {
        getText: jest.fn(() => "Line 1\nLine 2\nLine 3"),
        setText: jest.fn(),
        setCursorPosition: jest.fn(),
        insertText: jest.fn(),
        deleteChar: jest.fn(),
        moveCursor: jest.fn(),
        killLine: jest.fn(),
        killLineBackward: jest.fn(),
        addDebug: jest.fn()
      }
    ]);

    const element = ShellInput(defaultProps) as any;

    // Should handle multi-line content
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input when focused vs unfocused", () => {
    const focusedElement = ShellInput({
      ...defaultProps,
      autoFocus: true
    }) as any;
    
    const unfocusedElement = ShellInput({
      ...defaultProps,
      autoFocus: false
    }) as any;

    // Both should render successfully
    expect(focusedElement.type).toBe(Box);
    expect(unfocusedElement.type).toBe(Box);
    expect(React.isValidElement(focusedElement)).toBe(true);
    expect(React.isValidElement(unfocusedElement)).toBe(true);
  });

  test("user can see input structure with props", () => {
    const element = ShellInput({
      ...defaultProps,
      focusId: "custom-focus",
      autoFocus: true
    }) as any;

    // Should handle additional props
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input without completion manager", () => {
    const element = ShellInput({
      ...defaultProps,
      completionManager: undefined
    }) as any;

    // Should work without completion manager
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input with custom placeholder", () => {
    const element = ShellInput({
      ...defaultProps,
      placeholder: "Enter command..."
    }) as any;

    // Should accept custom placeholder
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input with debug disabled", () => {
    const element = ShellInput({
      ...defaultProps,
      showDebug: false
    }) as any;

    // Should work with debug disabled
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input with history", () => {
    const element = ShellInput({
      ...defaultProps,
      history: ["command1", "command2", "command3"]
    }) as any;

    // Should accept history prop
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see input with callbacks", () => {
    const onSubmit = jest.fn();
    const onChange = jest.fn();

    const element = ShellInput({
      ...defaultProps,
      onSubmit,
      onChange
    }) as any;

    // Should accept callback props
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });
});
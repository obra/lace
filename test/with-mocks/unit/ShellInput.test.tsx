// ABOUTME: Unit tests for ShellInput component
// ABOUTME: Tests shell input component structure and basic behavior

import { jest, describe, test, expect } from "@jest/globals";
import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
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
    const { lastFrame } = renderInkComponent(<ShellInput {...defaultProps} />);
    const output = lastFrame();

    // Should render input with placeholder
    expect(output).toContain("Type your message...");
  });

  test("user can see input with initial value", () => {
    // Mock the useTextBuffer to return initial value
    const mockUseTextBuffer = jest.mocked(jest.requireMock("@/ui/components/useTextBuffer").useTextBuffer);
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

    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        value="Hello world"
      />
    );
    const output = lastFrame();

    // Should render successfully with content
    expect(output).toContain("Hello world");
  });

  test("user can see multi-line input structure", () => {
    // Mock multi-line content
    const mockUseTextBuffer = jest.mocked(jest.requireMock("@/ui/components/useTextBuffer").useTextBuffer);
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

    const { lastFrame } = renderInkComponent(<ShellInput {...defaultProps} />);
    const output = lastFrame();

    // Should handle multi-line content
    expect(output).toContain("Line 1");
    expect(output).toContain("Line 2");
    expect(output).toContain("Line 3");
  });

  test("user can see input when focused vs unfocused", () => {
    const { lastFrame: focusedFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        autoFocus={true}
      />
    );
    
    const { lastFrame: unfocusedFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        autoFocus={false}
      />
    );

    // Both should render successfully
    expect(focusedFrame()).toBeDefined();
    expect(unfocusedFrame()).toBeDefined();
  });

  test("user can see input structure with props", () => {
    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        focusId="custom-focus"
        autoFocus={true}
      />
    );
    const output = lastFrame();

    // Should handle additional props
    expect(output).toBeDefined();
  });

  test("user can see input without completion manager", () => {
    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        completionManager={undefined}
      />
    );
    const output = lastFrame();

    // Should work without completion manager
    expect(output).toBeDefined();
  });

  test("user can see input with custom placeholder", () => {
    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        placeholder="Enter command..."
      />
    );
    const output = lastFrame();

    // Should accept custom placeholder
    expect(output).toContain("Enter command...");
  });

  test("user can see input with debug disabled", () => {
    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        showDebug={false}
      />
    );
    const output = lastFrame();

    // Should work with debug disabled
    expect(output).toBeDefined();
  });

  test("user can see input with history", () => {
    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        history={["command1", "command2", "command3"]}
      />
    );
    const output = lastFrame();

    // Should accept history prop
    expect(output).toBeDefined();
  });

  test("user can see input with callbacks", () => {
    const onSubmit = jest.fn();
    const onChange = jest.fn();

    const { lastFrame } = renderInkComponent(
      <ShellInput
        {...defaultProps}
        onSubmit={onSubmit}
        onChange={onChange}
      />
    );
    const output = lastFrame();

    // Should accept callback props
    expect(output).toBeDefined();
  });
});
// ABOUTME: Unit tests for TextRenderer component
// ABOUTME: Tests text display and cursor positioning behavior

import React from "react";
import TextRenderer from "@/ui/components/TextRenderer";
import { Box, Text } from "ink";

// Mock useRef since it causes issues in unit test environment
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useRef: jest.fn(() => ({ current: "test-id" }))
}));

describe("TextRenderer Component", () => {
  const defaultProps = {
    lines: ["Hello world"],
    cursorLine: 0,
    cursorColumn: 0,
    isFocused: true
  };

  test("user can see text renderer structure", () => {
    const element = TextRenderer(defaultProps) as any;

    // Should return a Box with column direction
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe("column");
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see placeholder when empty and not focused", () => {
    const element = TextRenderer({
      lines: [""],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: false,
      placeholder: "Enter your message..."
    }) as any;

    // When not focused and empty, should show placeholder
    expect(element.type).toBe(Text);
    expect(element.props.color).toBe("dim");
    expect(element.props.children).toBe("Enter your message...");
  });

  test("user can see multi-line content structure", () => {
    const element = TextRenderer({
      lines: ["First line", "Second line", "Third line"],
      cursorLine: 1,
      cursorColumn: 3,
      isFocused: true
    }) as any;

    // Should return Box container
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe("column");
    
    // Should have children for each line
    expect(element.props.children).toBeDefined();
    expect(Array.isArray(element.props.children)).toBe(true);
  });

  test("user can see empty lines handled properly", () => {
    const element = TextRenderer({
      lines: ["Line 1", "", "Line 3"],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: true
    }) as any;

    // Should handle empty lines in multi-line content
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see cursor at different positions", () => {
    // Test cursor at beginning
    const beginElement = TextRenderer({
      lines: ["Hello"],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: true
    }) as any;

    // Test cursor at end
    const endElement = TextRenderer({
      lines: ["Hello"],
      cursorLine: 0,
      cursorColumn: 5,
      isFocused: true
    }) as any;

    // Both should render successfully
    expect(beginElement.type).toBe(Box);
    expect(endElement.type).toBe(Box);
    expect(React.isValidElement(beginElement)).toBe(true);
    expect(React.isValidElement(endElement)).toBe(true);
  });

  test("user can see unfocused text without cursor", () => {
    const element = TextRenderer({
      lines: ["Line one", "Line two"],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: false
    }) as any;

    // Should render unfocused content
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see custom placeholder text", () => {
    const customPlaceholder = "Start typing your code...";
    
    const element = TextRenderer({
      lines: [""],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: false,
      placeholder: customPlaceholder
    }) as any;

    // Should show custom placeholder
    expect(element.type).toBe(Text);
    expect(element.props.children).toBe(customPlaceholder);
  });

  test("user can see long lines displayed properly", () => {
    const longLine = "This is a very long line that might wrap or need special handling in the terminal interface";
    
    const element = TextRenderer({
      lines: [longLine],
      cursorLine: 0,
      cursorColumn: 10,
      isFocused: true
    }) as any;

    // Should handle long lines
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see cursor beyond line length", () => {
    const element = TextRenderer({
      lines: ["Hi"],
      cursorLine: 0,
      cursorColumn: 10, // Way beyond line length
      isFocused: true
    }) as any;

    // Should handle cursor beyond line without crashing
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see default placeholder when none provided", () => {
    const element = TextRenderer({
      lines: [""],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: false
      // No placeholder prop provided
    }) as any;

    // Should show default placeholder
    expect(element.type).toBe(Text);
    expect(element.props.children).toBe("Type your message...");
  });

  test("user can see text content when focused", () => {
    const element = TextRenderer({
      lines: ["Hello world"],
      cursorLine: 0,
      cursorColumn: 5,
      isFocused: true
    }) as any;

    // Should render content when focused
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see empty content when focused", () => {
    const element = TextRenderer({
      lines: [""],
      cursorLine: 0,
      cursorColumn: 0,
      isFocused: true
    }) as any;

    // When focused but empty, should render Box (not placeholder)
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });
});
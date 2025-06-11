// ABOUTME: Unit tests for TextRenderer component
// ABOUTME: Tests text display and cursor positioning behavior

import { jest, describe, test, expect } from "@jest/globals";
import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import TextRenderer from "@/ui/components/TextRenderer";
import { Box, Text } from "ink";

describe("TextRenderer Component", () => {
  const defaultProps = {
    lines: ["Hello world"],
    cursorLine: 0,
    cursorColumn: 0,
    isFocused: true
  };

  test("user can see text renderer structure", () => {
    const { lastFrame } = renderInkComponent(<TextRenderer {...defaultProps} />);
    const output = lastFrame();

    // Should render text content
    expect(output).toContain("Hello world");
  });

  test("user can see placeholder when empty and not focused", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={[""]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={false}
        placeholder="Enter your message..."
      />
    );
    const output = lastFrame();

    // When not focused and empty, should show placeholder
    expect(output).toContain("Enter your message...");
  });

  test("user can see multi-line content structure", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={["First line", "Second line", "Third line"]}
        cursorLine={1}
        cursorColumn={3}
        isFocused={true}
      />
    );
    const output = lastFrame();
    
    // Should display all lines
    expect(output).toContain("First line");
    expect(output).toContain("Second line");
    expect(output).toContain("Third line");
  });

  test("user can see empty lines handled properly", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={["Line 1", "", "Line 3"]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={true}
      />
    );
    const output = lastFrame();

    // Should handle empty lines in multi-line content
    expect(output).toContain("Line 1");
    expect(output).toContain("Line 3");
  });

  test("user can see cursor at different positions", () => {
    // Test cursor at beginning
    const { lastFrame: beginFrame } = renderInkComponent(
      <TextRenderer
        lines={["Hello"]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={true}
      />
    );

    // Test cursor at end
    const { lastFrame: endFrame } = renderInkComponent(
      <TextRenderer
        lines={["Hello"]}
        cursorLine={0}
        cursorColumn={5}
        isFocused={true}
      />
    );

    // Both should render successfully with content
    expect(beginFrame()).toContain("Hello");
    expect(endFrame()).toContain("Hello");
  });

  test("user can see unfocused text without cursor", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={["Line one", "Line two"]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={false}
      />
    );
    const output = lastFrame();

    // Should render unfocused content
    expect(output).toContain("Line one");
    expect(output).toContain("Line two");
  });

  test("user can see custom placeholder text", () => {
    const customPlaceholder = "Start typing your code...";
    
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={[""]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={false}
        placeholder={customPlaceholder}
      />
    );
    const output = lastFrame();

    // Should show custom placeholder
    expect(output).toContain(customPlaceholder);
  });

  test("user can see long lines displayed properly", () => {
    const longLine = "This is a very long line that might wrap or need special handling in the terminal interface";
    
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={[longLine]}
        cursorLine={0}
        cursorColumn={10}
        isFocused={true}
      />
    );
    const output = lastFrame();

    // Should handle long lines
    expect(output).toContain("This is a very long line");
  });

  test("user can see cursor beyond line length", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={["Hi"]}
        cursorLine={0}
        cursorColumn={10} // Way beyond line length
        isFocused={true}
      />
    );
    const output = lastFrame();

    // Should handle cursor beyond line without crashing
    expect(output).toContain("Hi");
  });

  test("user can see default placeholder when none provided", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={[""]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={false}
        // No placeholder prop provided
      />
    );
    const output = lastFrame();

    // Should show default placeholder
    expect(output).toContain("Type your message...");
  });

  test("user can see text content when focused", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={["Hello world"]}
        cursorLine={0}
        cursorColumn={5}
        isFocused={true}
      />
    );
    const output = lastFrame();

    // Should render content when focused
    expect(output).toContain("Hello world");
  });

  test("user can see empty content when focused", () => {
    const { lastFrame } = renderInkComponent(
      <TextRenderer
        lines={[""]}
        cursorLine={0}
        cursorColumn={0}
        isFocused={true}
      />
    );
    const output = lastFrame();

    // When focused but empty, should render successfully (not crash)
    expect(output).toBeDefined();
  });
});
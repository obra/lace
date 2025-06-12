// ABOUTME: Unit tests for Message component
// ABOUTME: Tests message display with user/assistant types and content

import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import Message from "@/ui/components/Message";
import { Box, Text } from "ink";

describe("Message Component", () => {
  test("user can see user message with prefix", () => {
    const { frames } = renderInkComponent(
      <Message type="user" content="Hello world" />
    );
    const output = frames.join('');

    // Should display user prefix and content
    expect(output).toContain(">");
    expect(output).toContain("Hello world");
  });

  test("user can see assistant message with robot prefix", () => {
    const { frames } = renderInkComponent(
      <Message type="assistant" content="Hi there!" />
    );
    const output = frames.join('');

    // Should display robot prefix and content
    expect(output).toContain("🤖");
    expect(output).toContain("Hi there!");
  });

  test("user can see multi-line content", () => {
    const multiLineContent = "Line 1\nLine 2\nLine 3";
    const { frames } = renderInkComponent(
      <Message type="assistant" content={multiLineContent} />
    );
    const output = frames.join('');

    // Should display all lines
    expect(output).toContain("Line 1");
    expect(output).toContain("Line 2");
    expect(output).toContain("Line 3");
  });
});

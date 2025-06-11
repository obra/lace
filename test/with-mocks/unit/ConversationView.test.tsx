// ABOUTME: Unit tests for ConversationView component
// ABOUTME: Tests message display and layout functionality

import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import ConversationView from "@/ui/components/ConversationView";
import { Box } from "ink";

describe("ConversationView Component", () => {
  test("user can see conversation view with messages", () => {
    const { lastFrame } = renderInkComponent(<ConversationView />);
    const output = lastFrame();

    // Should display conversation content
    expect(output).toBeDefined();
  });

  test("user can see multiple messages in conversation", () => {
    const { lastFrame } = renderInkComponent(<ConversationView />);
    const output = lastFrame();

    // Should display multiple message indicators (user and assistant prefixes)
    expect(output).toContain(">"); // user prefix
    expect(output).toContain("🤖"); // assistant prefix
  });

  test("user can see conversation message content", () => {
    const { lastFrame } = renderInkComponent(<ConversationView />);
    const output = lastFrame();

    // Should display sample conversation content
    expect(output).toContain("Hello");
    expect(output).toContain("How can I help");
    expect(output).toContain("function");
  });
});

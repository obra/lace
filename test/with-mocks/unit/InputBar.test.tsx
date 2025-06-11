// ABOUTME: Unit tests for InputBar component
// ABOUTME: Tests actual component behavior and content

import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import InputBar from "@/ui/components/InputBar";
import { Box, Text } from "ink";

describe("InputBar Component", () => {
  test("user can see input bar with prompt", () => {
    const { lastFrame } = renderInkComponent(<InputBar />);
    const output = lastFrame();

    // Should display prompt character
    expect(output).toContain(">");
  });

  test("user can see placeholder text when empty", () => {
    const { lastFrame } = renderInkComponent(<InputBar />);
    const output = lastFrame();

    // Should display placeholder text
    expect(output).toContain("Type your message...");
  });

  test("user can see input bar structure", () => {
    const { lastFrame } = renderInkComponent(<InputBar />);
    const output = lastFrame();

    // Should display basic input bar elements
    expect(output).toContain(">");
    expect(output).toContain("Type your message...");
  });
});

// ABOUTME: Unit tests for StatusBar component
// ABOUTME: Tests actual component behavior and content

import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import StatusBar from "@/ui/components/StatusBar";
import { Box, Text } from "ink";

describe("StatusBar Component", () => {
  test("user can see status bar with app name", () => {
    const { lastFrame } = renderInkComponent(<StatusBar />);
    const output = lastFrame();

    // Should display the app name
    expect(output).toContain("lace-ink");
  });

  test("user can see ready status in normal mode", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar isNavigationMode={false} />
    );
    const output = lastFrame();

    // Should display ready status and navigation hints
    expect(output).toContain("Ready");
    expect(output).toContain("↑/↓ to navigate");
  });

  test("user can see navigation mode with position", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        isNavigationMode={true}
        scrollPosition={2}
        totalMessages={4}
      />
    );
    const output = lastFrame();

    // Should display navigation mode and position
    expect(output).toContain("Nav:");
    expect(output).toContain("Line 3 of 4");
  });

  test("user can see token usage display", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar tokenUsage={{ used: 1200, total: 4000 }} />
    );
    const output = lastFrame();

    // Should display token usage
    expect(output).toContain("Tokens:");
    expect(output).toContain("1.2k");
    expect(output).toContain("4.0k");
  });

  test("user can see model name in wide terminal", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        modelName="claude-3.5-sonnet"
        terminalWidth={120}
      />
    );
    const output = lastFrame();

    // Should display full model name in wide terminal
    expect(output).toContain("claude-3.5-sonnet");
  });

  test("user can see large token numbers formatted correctly", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar tokenUsage={{ used: 15600, total: 128000 }} />
    );
    const output = lastFrame();

    // Should format large numbers with k suffix
    expect(output).toContain("15.6k");
    expect(output).toContain("128.0k");
  });

  test("user can see abbreviated model name in narrow terminal", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        modelName="claude-3.5-sonnet"
        terminalWidth={60}
      />
    );
    const output = lastFrame();

    // Should abbreviate model name in narrow terminal
    expect(output).toContain("claude-3.5");
  });

  test("user can see all information in wide terminal", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        tokenUsage={{ used: 1200, total: 4000 }}
        modelName="claude-3.5-sonnet"
        terminalWidth={120}
      />
    );
    const output = lastFrame();

    // Should show all information in wide terminal
    expect(output).toContain("lace-ink");
    expect(output).toContain("Tokens:");
    expect(output).toContain("claude-3.5-sonnet");
    expect(output).toContain("Ready");
  });

  test("user can see search mode display", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        isSearchMode={true}
        searchResultIndex={2}
        searchResults={5}
      />
    );
    const output = lastFrame();

    // Should display search information
    expect(output).toContain("Search:");
    expect(output).toContain("3 of 5");
  });

  test("user can see minimal display without optional props", () => {
    const { lastFrame } = renderInkComponent(<StatusBar />);
    const output = lastFrame();

    // Should display basic information without crashing
    expect(output).toContain("lace-ink");
    expect(output).toContain("Ready");
  });
});

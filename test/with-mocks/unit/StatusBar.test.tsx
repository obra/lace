// ABOUTME: Unit tests for StatusBar component
// ABOUTME: Tests actual component behavior and content

import React from "react";
import StatusBar from "@/ui/components/StatusBar";
import { Box, Text } from "ink";

describe("StatusBar Component", () => {
  test("renders correct JSX structure with border", () => {
    const element = StatusBar({}) as any;

    // Should return a Box element with border styling
    expect(element.type).toBe(Box);
    expect(element.props.borderStyle).toBe("single");
    expect(element.props.borderTop).toBe(true);
    expect(element.props.borderBottom).toBe(false);
    expect(element.props.borderLeft).toBe(false);
    expect(element.props.borderRight).toBe(false);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("displays app name with correct styling", () => {
    const element = StatusBar({}) as any;
    const children = element.props.children;

    // Find the "lace-ink" text element
    const appNameElement = children.find(
      (child: any) =>
        child.type === Text && child.props.children === "lace-ink",
    );

    expect(appNameElement).toBeTruthy();
    expect(appNameElement.props.color).toBe("cyan");
  });

  test("displays status with correct styling in normal mode", () => {
    const element = StatusBar({ isNavigationMode: false }) as any;
    const children = element.props.children;

    // The last fragment contains Ready and navigation hint
    const fragment = children[children.length - 1];
    const fragmentChildren = fragment.props.children;

    // Find the "Ready" text element
    const statusElement = fragmentChildren.find(
      (child: any) => child.type === Text && child.props.children === "Ready",
    );

    expect(statusElement).toBeTruthy();
    expect(statusElement.props.color).toBe("green");
  });

  test("displays navigation hint in normal mode", () => {
    const element = StatusBar({ isNavigationMode: false }) as any;
    const children = element.props.children;

    // The last fragment contains Ready and navigation hint
    const fragment = children[children.length - 1];
    const fragmentChildren = fragment.props.children;

    // Find the navigation hint text element
    const navElement = fragmentChildren.find(
      (child: any) =>
        child.type === Text &&
        child.props.children === "↑/↓ to navigate, / to search",
    );

    expect(navElement).toBeTruthy();
    expect(navElement.props.color).toBe("dim");
  });

  test("displays navigation mode with position when in nav mode", () => {
    const element = StatusBar({
      isNavigationMode: true,
      scrollPosition: 2,
      totalMessages: 4,
    }) as any;
    const children = element.props.children;

    // The last fragment contains Nav mode info
    const fragment = children[children.length - 1];
    const fragmentChildren = fragment.props.children;

    // Find the "Nav: j/k/c/a" text element (it's an array now)
    const navModeElement = fragmentChildren.find(
      (child: any) =>
        child.type === Text &&
        Array.isArray(child.props.children) &&
        child.props.children[0] === "Nav: j/k/c/a",
    );

    expect(navModeElement).toBeTruthy();
    expect(navModeElement.props.color).toBe("yellow");

    // Find the position text element - it's a string now: "Line 3 of 4"
    const positionElement = fragmentChildren.find(
      (child: any) =>
        child.type === Text && child.props.children === "Line 3 of 4",
    );

    expect(positionElement).toBeTruthy();
    expect(positionElement.props.color).toBe("dim");
  });

  // Stage 11 Tests: Improved Status Bar Features

  test("displays token usage with correct formatting", () => {
    const element = StatusBar({
      tokenUsage: { used: 1200, total: 4000 },
    }) as any;
    const children = element.props.children;

    // Token usage is in a fragment at index 2
    const tokenFragment = children[2];
    expect(tokenFragment).toBeTruthy();
    expect(Array.isArray(tokenFragment.props.children)).toBe(true);

    // The first child of the fragment should be the token text
    const tokenElement = tokenFragment.props.children[0];
    expect(tokenElement.type).toBe(Text);
    expect(tokenElement.props.color).toBe("blue");

    // Check the token format - should be array: ["Tokens: ", "1.2k", "/", "4.0k"]
    const tokenText = tokenElement.props.children;
    expect(Array.isArray(tokenText)).toBe(true);
    expect(tokenText[0]).toBe("Tokens: ");
    expect(tokenText[1]).toBe("1.2k");
    expect(tokenText[2]).toBe("/");
    expect(tokenText[3]).toBe("4.0k");
  });

  test("displays model name with correct styling", () => {
    const element = StatusBar({
      modelName: "claude-3.5-sonnet",
      terminalWidth: 120, // Wide terminal to show full model name
    }) as any;
    const children = element.props.children;

    // Model name should be in a fragment after tokens
    const modelFragment = children.find(
      (child: any) =>
        child &&
        Array.isArray(child.props?.children) &&
        child.props.children.some(
          (subchild: any) =>
            subchild?.type === Text &&
            subchild?.props?.children === "claude-3.5-sonnet",
        ),
    );

    expect(modelFragment).toBeTruthy();
    const modelElement = modelFragment.props.children.find(
      (child: any) =>
        child?.type === Text && child?.props?.children === "claude-3.5-sonnet",
    );
    expect(modelElement.props.color).toBe("green");
  });

  test("formats large token numbers correctly", () => {
    const element = StatusBar({
      tokenUsage: { used: 15600, total: 128000 },
    }) as any;
    const children = element.props.children;

    // Token usage is in a fragment at index 2
    const tokenFragment = children[2];
    const tokenElement = tokenFragment.props.children[0];

    // Check the token format - should be array: ["Tokens: ", "15.6k", "/", "128.0k"]
    const tokenText = tokenElement.props.children;
    expect(tokenText[1]).toBe("15.6k");
    expect(tokenText[3]).toBe("128.0k");
  });

  test("handles responsive layout for narrow terminals", () => {
    const element = StatusBar({
      tokenUsage: { used: 1200, total: 4000 },
      modelName: "claude-3.5-sonnet",
      terminalWidth: 60, // Narrow terminal
    }) as any;
    const children = element.props.children;

    // Model should be abbreviated in narrow terminal
    const modelFragment = children.find(
      (child: any) =>
        child &&
        Array.isArray(child.props?.children) &&
        child.props.children.some(
          (subchild: any) =>
            subchild?.type === Text &&
            subchild?.props?.children === "claude-3.5",
        ),
    );

    expect(modelFragment).toBeTruthy();
  });

  test("shows all status information in wide terminal", () => {
    const element = StatusBar({
      tokenUsage: { used: 1200, total: 4000 },
      modelName: "claude-3.5-sonnet",
      terminalWidth: 120, // Wide terminal
    }) as any;
    const children = element.props.children;

    // Should have token usage
    const tokenFragment = children[2];
    expect(tokenFragment).toBeTruthy();

    // Should have model name
    const modelFragment = children.find(
      (child: any) =>
        child &&
        Array.isArray(child.props?.children) &&
        child.props.children.some(
          (subchild: any) =>
            subchild?.type === Text &&
            subchild?.props?.children === "claude-3.5-sonnet",
        ),
    );
    expect(modelFragment).toBeTruthy();
  });
});

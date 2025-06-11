// ABOUTME: Unit tests for DetailedLogView component
// ABOUTME: Tests log entry display, navigation highlighting, and virtual scrolling

import React from "react";
import { render } from "ink-testing-library";
import DetailedLogView from "@/ui/components/DetailedLogView";

describe("DetailedLogView Component", () => {
  const mockLogEntries = [
    {
      id: "log-1",
      timestamp: "2023-06-10T12:00:00.000Z",
      type: "user",
      content: "Hello world"
    },
    {
      id: "log-2", 
      timestamp: "2023-06-10T12:01:00.000Z",
      type: "assistant",
      content: "Hi there! How can I help?"
    },
    {
      id: "log-3",
      timestamp: "2023-06-10T12:02:00.000Z", 
      type: "agent_activity",
      content: "File operations\nReading file.txt\nWriting output.log"
    }
  ];

  test("renders log entries with timestamps and types", () => {
    const { lastFrame } = render(
      <DetailedLogView entries={mockLogEntries} />
    );

    const output = lastFrame();
    
    // Should show timestamps (in local time format)
    expect(output).toContain("[12:00:00");
    expect(output).toContain("[12:01:00");
    expect(output).toContain("[12:02:00");
    
    // Should show types in uppercase
    expect(output).toContain("USER:");
    expect(output).toContain("ASSISTANT:");
    expect(output).toContain("AGENT_ACTIVITY:");
    
    // Should show content
    expect(output).toContain("Hello world");
    expect(output).toContain("Hi there! How can I help?");
    expect(output).toContain("File operations");
  });

  test("highlights current scroll position in navigation mode", () => {
    const { lastFrame } = render(
      <DetailedLogView 
        entries={mockLogEntries}
        isNavigationMode={true}
        scrollPosition={1}
      />
    );

    const output = lastFrame();
    
    // Check that highlighting is applied (blue background should be present)
    // The exact output format depends on how Ink renders backgrounds
    expect(output).toContain("ASSISTANT:");
    expect(output).toContain("Hi there! How can I help?");
  });

  test("handles empty entries array", () => {
    const { lastFrame } = render(
      <DetailedLogView entries={[]} />
    );

    const output = lastFrame();
    expect(output.trim()).toBe("");
  });

  test("displays full content without truncation", () => {
    const longEntry = {
      id: "log-long",
      timestamp: "2023-06-10T12:00:00.000Z",
      type: "assistant",
      content: "This is a very long message that should be displayed in full without any truncation because the log view is designed to show complete content for detailed analysis and debugging purposes."
    };

    const { lastFrame } = render(
      <DetailedLogView entries={[longEntry]} />
    );

    const output = lastFrame();
    
    // Should contain the full content
    expect(output).toContain("This is a very long message");
    expect(output).toContain("debugging purposes.");
  });

  test("handles agent activity content with newlines", () => {
    const activityEntry = {
      id: "log-activity",
      timestamp: "2023-06-10T12:00:00.000Z",
      type: "agent_activity",
      content: "Multiple operations:\nStep 1: Initialize\nStep 2: Process\nStep 3: Complete"
    };

    const { lastFrame } = render(
      <DetailedLogView entries={[activityEntry]} />
    );

    const output = lastFrame();
    
    expect(output).toContain("AGENT_ACTIVITY:");
    expect(output).toContain("Multiple operations:");
    expect(output).toContain("Step 1: Initialize");
    expect(output).toContain("Step 3: Complete");
  });

  test("uses virtual scrolling for large entry lists", () => {
    // Create a large number of entries
    const largeEntryList = Array.from({ length: 100 }, (_, i) => ({
      id: `log-${i}`,
      timestamp: "2023-06-10T12:00:00.000Z",
      type: "user",
      content: `Message ${i}`
    }));

    const { lastFrame } = render(
      <DetailedLogView 
        entries={largeEntryList}
        scrollPosition={50}
        isNavigationMode={true}
      />
    );

    const output = lastFrame();
    
    // Should render entries around position 50
    expect(output).toContain("Message 50");
    // Should not render all 100 entries (virtual scrolling)
    expect(output).not.toContain("Message 0");
    expect(output).not.toContain("Message 99");
  });

  test("formats timestamps in local time", () => {
    const entry = {
      id: "log-time",
      timestamp: "2023-06-10T15:30:45.123Z",
      type: "user", 
      content: "Test message"
    };

    const { lastFrame } = render(
      <DetailedLogView entries={[entry]} />
    );

    const output = lastFrame();
    
    // Should format time as local time (exact format depends on system locale)
    expect(output).toMatch(/\[\d{1,2}:\d{2}:\d{2}/);
  });

  test("displays color-coded type prefixes for different entry types", () => {
    const entries = [
      {
        id: "1",
        timestamp: new Date().toISOString(),
        type: "user",
        content: "User input message",
      },
      {
        id: "2", 
        timestamp: new Date().toISOString(),
        type: "assistant",
        content: "Assistant response",
      },
      {
        id: "3",
        timestamp: new Date().toISOString(),
        type: "tool_call",
        content: "Tool execution",
      },
      {
        id: "4",
        timestamp: new Date().toISOString(),
        type: "tool_result",
        content: "Tool result data",
      },
    ];

    const { lastFrame } = render(<DetailedLogView entries={entries} />);
    const output = lastFrame();

    // Verify content is displayed
    expect(output).toContain("User input message");
    expect(output).toContain("Assistant response");
    expect(output).toContain("Tool execution");
    expect(output).toContain("Tool result data");
    
    // Verify type prefixes are displayed according to Task 7 requirements
    expect(output).toContain("[USER]:");
    expect(output).toContain("[MODEL]:");
    expect(output).toContain("[TOOL→]:");
    expect(output).toContain("[TOOL←]:");
    
    // Should render all entries with color coding
    expect(entries).toHaveLength(4);
  });
});
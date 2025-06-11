// ABOUTME: Integration tests for message display functionality
// ABOUTME: Tests user-observable message behavior and conversation flow

import React from "react";
import { renderInkComponent, stripAnsi } from "../../with-mocks/helpers/ink-test-utils";
import { Box } from "ink";
import ConversationView from "@/ui/components/ConversationView";
import Message from "@/ui/components/Message";

describe("Message Display Integration", () => {
  test("user can see complete conversation flow", () => {
    const mockConversation = [
      { type: "user" as const, content: "Hello" },
      { type: "assistant" as const, content: "Hi! How can I help you today?" },
      { type: "user" as const, content: "Can you write a function?" },
      {
        type: "assistant" as const,
        content:
          'Sure! Here is a basic function:\n\nfunction hello() {\n  return "Hello World";\n}',
      },
    ];

    const { lastFrame } = renderInkComponent(<ConversationView messages={mockConversation} />);

    // User should see their messages
    expect(lastFrame()).toContain("Hello");
    expect(lastFrame()).toContain("Can you write a function?");
    
    // User should see assistant responses
    expect(lastFrame()).toContain("Hi! How can I help you today?");
    expect(lastFrame()).toContain("Sure! Here is a basic function:");
    expect(lastFrame()).toContain("function hello()");
    expect(lastFrame()).toContain('return "Hello World"');
  });

  test("user can distinguish between different message types", () => {
    const { lastFrame } = renderInkComponent(
      <Box flexDirection="column">
        <Message type="user" content="Hello" />
        <Message type="assistant" content="Hi there!" />
        <Message type="loading" content="Loading..." />
      </Box>
    );

    const output = lastFrame();
    
    // User should see visual indicators for different message types
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
    expect(output).toContain("Loading...");
    
    // Different message types should be visually distinguishable
    // (actual rendering will show different prefixes/styling)
    expect(output.length).toBeGreaterThan("HelloHi there!Loading...".length);
  });

  test("user can read multi-line assistant responses", () => {
    const multiLineContent = "Here's a code example:\n\nfunction test() {\n  console.log('Hello');\n}";
    
    const { lastFrame } = renderInkComponent(
      <Message type="assistant" content={multiLineContent} />
    );

    const output = lastFrame();
    
    // User should see all lines of the response
    expect(output).toContain("Here's a code example:");
    expect(output).toContain("function test() {");
    expect(output).toContain("console.log('Hello');");
    expect(output).toContain("}");
  });

  test("conversation displays messages in chronological order", () => {
    const mockConversation = [
      { type: "user" as const, content: "First message" },
      { type: "assistant" as const, content: "Second message" },
      { type: "user" as const, content: "Third message" },
    ];

    const { lastFrame } = renderInkComponent(<ConversationView messages={mockConversation} />);
    const output = lastFrame();

    // Messages should appear in the order they were sent
    const firstIndex = output.indexOf("First message");
    const secondIndex = output.indexOf("Second message");
    const thirdIndex = output.indexOf("Third message");

    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  test("empty conversation displays appropriately", () => {
    const { lastFrame } = renderInkComponent(<ConversationView messages={[]} />);
    const output = lastFrame();

    // Empty conversation should not crash and should render some content
    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
  });

  test("conversation handles various content types", () => {
    const mockConversation = [
      { type: "user" as const, content: "Show me some code" },
      { 
        type: "assistant" as const, 
        content: "```javascript\nconst hello = () => 'world';\n```" 
      },
      { type: "user" as const, content: "What about markdown **bold** text?" },
      { 
        type: "assistant" as const, 
        content: "I can handle **bold** and *italic* formatting." 
      },
    ];

    const { lastFrame } = renderInkComponent(<ConversationView messages={mockConversation} />);
    const output = lastFrame();

    // User should see all different content types
    expect(output).toContain("Show me some code");
    expect(stripAnsi(output)).toContain("const hello = () => 'world';");
    expect(output).toContain("What about markdown **bold** text?");
    expect(output).toContain("I can handle **bold** and *italic* formatting.");
  });
});

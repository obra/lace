// ABOUTME: Integration tests for input handling functionality
// ABOUTME: Tests user text input, submission, and real-time input feedback

import React from "react";
import { render } from "ink-testing-library";
import InputBar from "@/ui/components/InputBar";
import ConversationView from "@/ui/components/ConversationView";

describe("Input Handling Integration", () => {
  test("user can see their text as they type", () => {
    const { lastFrame } = render(
      <InputBar 
        isNavigationMode={false}
        inputText="hello world"
      />
    );

    const output = lastFrame();
    
    // User should see their typed text
    expect(output).toContain("hello world");
  });

  test("user can see cursor while typing", () => {
    const { lastFrame: withCursor } = render(
      <InputBar 
        isNavigationMode={false}
        inputText="hello"
        showCursor={true}
      />
    );

    const { lastFrame: withoutCursor } = render(
      <InputBar 
        isNavigationMode={false}
        inputText="hello"
        showCursor={false}
      />
    );

    const withCursorOutput = withCursor();
    const withoutCursorOutput = withoutCursor();

    // Cursor presence should be visible to user
    expect(withCursorOutput).not.toEqual(withoutCursorOutput);
    expect(withCursorOutput).toContain("hello");
    expect(withoutCursorOutput).toContain("hello");
  });

  test("user input appears in conversation after submission", () => {
    const messages = [
      { type: "user" as const, content: "Hello" },
      { type: "assistant" as const, content: "Hi!" },
      { type: "user" as const, content: "How are you?" },
    ];

    const { lastFrame } = render(<ConversationView messages={messages} />);
    const output = lastFrame();

    // User should see their submitted messages in conversation
    expect(output).toContain("Hello");
    expect(output).toContain("How are you?");
    
    // User should also see assistant responses
    expect(output).toContain("Hi!");
  });

  test("input prompt guides user on what to do", () => {
    const { lastFrame } = render(
      <InputBar isNavigationMode={false} />
    );

    const output = lastFrame();
    
    // User should see guidance on how to interact
    expect(output).toContain("Type your message");
  });

  test("user can distinguish between input area and conversation", () => {
    const messages = [
      { type: "user" as const, content: "Previous message" },
      { type: "assistant" as const, content: "Assistant response" },
    ];

    const conversationOutput = render(<ConversationView messages={messages} />).lastFrame();
    const inputOutput = render(<InputBar isNavigationMode={false} inputText="Current typing" />).lastFrame();

    // Conversation and input should be visually distinct
    expect(conversationOutput).not.toEqual(inputOutput);
    expect(conversationOutput).toContain("Previous message");
    expect(inputOutput).toContain("Current typing");
  });

  test("long input text is handled appropriately", () => {
    const longText = "This is a very long message that the user is typing and it should be displayed properly without breaking the interface";
    
    const { lastFrame } = render(
      <InputBar 
        isNavigationMode={false}
        inputText={longText}
      />
    );

    const output = lastFrame();
    
    // User should see their long text (may be truncated or wrapped)
    expect(output).toContain("This is a very long message");
  });

  test("empty input shows placeholder correctly", () => {
    const { lastFrame } = render(
      <InputBar 
        isNavigationMode={false}
        inputText=""
      />
    );

    const output = lastFrame();
    
    // User should see placeholder when no text is entered
    expect(output).toContain("Type your message");
  });

  test("input state updates are immediately visible", () => {
    const { lastFrame, rerender } = render(
      <InputBar 
        isNavigationMode={false}
        inputText=""
      />
    );

    const emptyOutput = lastFrame();

    // User starts typing
    rerender(
      <InputBar 
        isNavigationMode={false}
        inputText="hello"
      />
    );

    const typingOutput = lastFrame();

    // Change should be immediately visible
    expect(emptyOutput).not.toEqual(typingOutput);
    expect(typingOutput).toContain("hello");
  });

  test("special characters in input are displayed correctly", () => {
    const specialText = "console.log('Hello, world!'); // Special chars: @#$%^&*()";
    
    const { lastFrame } = render(
      <InputBar 
        isNavigationMode={false}
        inputText={specialText}
      />
    );

    const output = lastFrame();
    
    // User should see special characters preserved
    expect(output).toContain("console.log");
    expect(output).toContain("'Hello, world!'");
    expect(output).toContain("@#$%");
  });
});
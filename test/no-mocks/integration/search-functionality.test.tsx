// ABOUTME: Integration tests for search functionality
// ABOUTME: Tests user search experience, highlighting, and navigation

import React from "react";
import { renderInkComponent, stripAnsi } from "../../with-mocks/helpers/ink-test-utils";
import StatusBar from "@/ui/components/StatusBar";
import InputBar from "@/ui/components/InputBar";
import ConversationView from "@/ui/components/ConversationView";
import Message from "@/ui/components/Message";

describe("Search Functionality Integration", () => {
  test("user can see when search mode is active", () => {
    const { lastFrame: normalMode } = renderInkComponent(
      <StatusBar isSearchMode={false} />
    );
    
    const { lastFrame: searchMode } = renderInkComponent(
      <StatusBar isSearchMode={true} searchTerm="hello" />
    );

    const normalOutput = normalMode();
    const searchOutput = searchMode();

    // Search mode should be visually different from normal mode
    expect(normalOutput).not.toEqual(searchOutput);
    
    // User should see search mode indicator
    expect(searchOutput).toContain("Search");
  });

  test("user can see search instructions in input bar", () => {
    const { lastFrame } = renderInkComponent(
      <InputBar isSearchMode={true} />
    );

    const output = lastFrame();
    
    // User should see search placeholder
    expect(output).toContain("Search...");
  });

  test("user can see search results highlighted in conversation", () => {
    const messages = [
      { type: "user" as const, content: "Hello world" },
      { type: "assistant" as const, content: "Hello there! How can I help?" },
      { type: "user" as const, content: "Can you write some code?" },
    ];

    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={messages} 
        searchTerm="hello"
        searchResults={[
          { messageIndex: 0, message: messages[0] },
          { messageIndex: 1, message: messages[1] }
        ]}
      />
    );

    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // User should see messages containing search term
    expect(cleanOutput.toLowerCase()).toContain("hello world");
    expect(cleanOutput.toLowerCase()).toContain("hello there");
    
    // Search highlighting should be applied (check for ANSI codes around search term)
    expect(output).toMatch(/\x1b\[43m\x1b\[30m[Hh]ello\x1b\[39m\x1b\[49m/);
  });

  test("user can see search navigation status", () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        isNavigationMode={true}
        filterMode="search"
        searchTerm="test"
        searchResultIndex={2}
        searchResults={[
          {messageIndex: 0, message: {}},
          {messageIndex: 1, message: {}},
          {messageIndex: 2, message: {}},
          {messageIndex: 3, message: {}},
          {messageIndex: 4, message: {}}
        ]}
      />
    );

    const output = lastFrame();
    
    // User should see their position in search results
    expect(output).toContain("Result 3 of 5"); // searchResultIndex 2 displays as "Result 3"
  });

  test("user sees appropriate message when no search results found", () => {
    const messages = [
      { type: "user" as const, content: "Hello world" },
      { type: "assistant" as const, content: "Hi there!" },
    ];

    const { lastFrame } = renderInkComponent(
      <StatusBar 
        isSearchMode={true}
        searchTerm="nonexistent"
        searchResults={[]}
      />
    );

    const output = lastFrame();
    
    // User should see search mode but no specific "no results" message
    expect(output).toContain("Search");
  });

  test("user can search for code snippets", () => {
    const messages = [
      { 
        type: "assistant" as const, 
        content: "Here's a function:\n\n```javascript\nfunction hello() {\n  return 'Hello World';\n}\n```" 
      },
      { 
        type: "user" as const, 
        content: "Can you explain the function?" 
      },
    ];

    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={messages} 
        searchTerm="function"
        searchResults={[
          { messageIndex: 0, message: messages[0] },
          { messageIndex: 1, message: messages[1] }
        ]}
      />
    );

    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // User should see the code with search term highlighted
    expect(cleanOutput.toLowerCase()).toContain("function hello()");
    expect(cleanOutput.toLowerCase()).toContain("explain the function");
    
    // Verify highlighting is applied to the search term
    expect(output).toMatch(/\x1b\[43m\x1b\[30mfunction\x1b\[39m\x1b\[49m/);
  });

  test("user can search case-insensitively", () => {
    const messages = [
      { type: "assistant" as const, content: "JavaScript is powerful" },
      { type: "user" as const, content: "I love javascript!" },
    ];

    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={messages} 
        searchTerm="JAVASCRIPT"
        searchResults={[
          { messageIndex: 0, message: messages[0] },
          { messageIndex: 1, message: messages[1] }
        ]}
      />
    );

    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // User should see both uppercase and lowercase matches
    expect(cleanOutput.toLowerCase()).toContain("javascript is powerful");
    expect(cleanOutput.toLowerCase()).toContain("i love javascript!");
    
    // Case-insensitive search should highlight both variations (searching for "JAVASCRIPT")
    expect(output).toMatch(/\x1b\[43m\x1b\[30m[Jj]ava[Ss]cript\x1b\[39m\x1b\[49m/);
  });

  test("user can search with special characters", () => {
    const messages = [
      { type: "assistant" as const, content: "File path: /home/user/.config" },
      { type: "user" as const, content: "Where is the config file?" },
    ];

    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={messages} 
        searchTerm="/home"
        searchResults={[
          { messageIndex: 0, message: messages[0] }
        ]}
      />
    );

    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // User should see special characters in search results
    expect(cleanOutput.toLowerCase()).toContain("/home/user/.config");
    
    // Verify highlighting is applied to the search term (escaping the forward slash)
    expect(output).toMatch(/\x1b\[43m\x1b\[30m\/home\x1b\[39m\x1b\[49m/);
  });

  test("user sees search progress through multiple results", () => {
    // Test progression through search results in navigation mode
    const { lastFrame: result1 } = renderInkComponent(
      <StatusBar 
        isNavigationMode={true}
        filterMode="search"
        searchTerm="test"
        searchResultIndex={1}
        searchResults={[
          {messageIndex: 0, message: {}},
          {messageIndex: 1, message: {}},
          {messageIndex: 2, message: {}}
        ]}
      />
    );

    const { lastFrame: result2 } = renderInkComponent(
      <StatusBar 
        isNavigationMode={true}
        filterMode="search"
        searchTerm="test"
        searchResultIndex={2}
        searchResults={[
          {messageIndex: 0, message: {}},
          {messageIndex: 1, message: {}},
          {messageIndex: 2, message: {}}
        ]}
      />
    );

    const output1 = result1();
    const output2 = result2();

    // User should see position change in navigation mode
    expect(output1).not.toEqual(output2);
    expect(output1).toContain("Result 2 of 3"); // searchResultIndex 1 displays as "Result 2"
    expect(output2).toContain("Result 3 of 3"); // searchResultIndex 2 displays as "Result 3"
  });

  test("user can exit search mode", () => {
    const { lastFrame: searchMode } = renderInkComponent(
      <InputBar isSearchMode={true} />
    );

    const { lastFrame: normalMode } = renderInkComponent(
      <InputBar isSearchMode={false} />
    );

    const searchOutput = searchMode();
    const normalOutput = normalMode();

    // Should return to normal input mode
    expect(searchOutput).not.toEqual(normalOutput);
    expect(normalOutput).toContain("Type your message");
  });

  test("user can search in long conversations", () => {
    const longConversation = Array.from({ length: 10 }, (_, i) => {
      if (i % 2 === 0) {
        return {
          type: "user" as const,
          content: `Message ${i + 1} with some test content`,
        };
      } else {
        return {
          type: "assistant" as const,
          content: `Message ${i + 1} with some test content`,
        };
      }
    });

    const { lastFrame } = renderInkComponent(
      <ConversationView 
        messages={longConversation} 
        searchTerm="test"
      />
    );

    const output = lastFrame();
    const cleanOutput = stripAnsi(output);
    
    // User should see multiple search matches
    expect(cleanOutput.toLowerCase()).toContain("message 1 with some test content");
    expect(cleanOutput.toLowerCase()).toContain("message 2 with some test content");
    
    // Verify highlighting is applied to search terms
    expect(output).toMatch(/\x1b\[43m\x1b\[30mtest\x1b\[39m\x1b\[49m/);
  });
});
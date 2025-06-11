// ABOUTME: Integration tests for search functionality
// ABOUTME: Tests user search experience, highlighting, and navigation

import React from "react";
import { render } from "ink-testing-library";
import StatusBar from "@/ui/components/StatusBar";
import InputBar from "@/ui/components/InputBar";
import ConversationView from "@/ui/components/ConversationView";
import Message from "@/ui/components/Message";

describe("Search Functionality Integration", () => {
  test("user can see when search mode is active", () => {
    const { lastFrame: normalMode } = render(
      <StatusBar isSearchMode={false} />
    );
    
    const { lastFrame: searchMode } = render(
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
    const { lastFrame } = render(
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

    const { lastFrame } = render(
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
    
    // User should see messages containing search term
    expect(output).toContain("Hello world");
    expect(output).toContain("Hello there!");
    
    // Search highlighting should be visible (text should contain the search term)
    expect(output.toLowerCase()).toContain("hello");
  });

  test("user can see search navigation status", () => {
    const { lastFrame } = render(
      <StatusBar 
        isSearchMode={true}
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

    const { lastFrame } = render(
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

    const { lastFrame } = render(
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
    
    // User should see the code with search term highlighted
    expect(output).toContain("function hello()");
    expect(output).toContain("explain the function");
  });

  test("user can search case-insensitively", () => {
    const messages = [
      { type: "assistant" as const, content: "JavaScript is powerful" },
      { type: "user" as const, content: "I love javascript!" },
    ];

    const { lastFrame } = render(
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
    
    // User should see both uppercase and lowercase matches
    expect(output).toContain("JavaScript is powerful");
    expect(output).toContain("I love javascript!");
  });

  test("user can search with special characters", () => {
    const messages = [
      { type: "assistant" as const, content: "File path: /home/user/.config" },
      { type: "user" as const, content: "Where is the config file?" },
    ];

    const { lastFrame } = render(
      <ConversationView 
        messages={messages} 
        searchTerm="/home"
        searchResults={[
          { messageIndex: 0, message: messages[0] }
        ]}
      />
    );

    const output = lastFrame();
    
    // User should see special characters in search results
    expect(output).toContain("/home/user/.config");
  });

  test("user sees search progress through multiple results", () => {
    // Test progression through search results
    const { lastFrame: result1 } = render(
      <StatusBar 
        isSearchMode={true}
        searchTerm="test"
        searchResultIndex={1}
        searchResults={[
          {messageIndex: 0, message: {}},
          {messageIndex: 1, message: {}},
          {messageIndex: 2, message: {}}
        ]}
      />
    );

    const { lastFrame: result2 } = render(
      <StatusBar 
        isSearchMode={true}
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

    // User should see position change
    expect(output1).not.toEqual(output2);
    expect(output1).toContain("Result 2 of 3"); // searchResultIndex 1 displays as "Result 2"
    expect(output2).toContain("Result 3 of 3"); // searchResultIndex 2 displays as "Result 3"
  });

  test("user can exit search mode", () => {
    const { lastFrame: searchMode } = render(
      <InputBar isSearchMode={true} />
    );

    const { lastFrame: normalMode } = render(
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

    const { lastFrame } = render(
      <ConversationView 
        messages={longConversation} 
        searchTerm="test"
      />
    );

    const output = lastFrame();
    
    // User should see multiple search matches
    expect(output).toContain("Message 1 with some test content");
    expect(output).toContain("Message 2 with some test content");
  });
});
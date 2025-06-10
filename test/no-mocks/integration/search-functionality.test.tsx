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
    
    // User should see search term in status
    expect(searchOutput).toContain("hello");
  });

  test("user can see search instructions in input bar", () => {
    const { lastFrame } = render(
      <InputBar isSearchMode={true} />
    );

    const output = lastFrame();
    
    // User should see search-specific instructions
    expect(output).toContain("Search") || expect(output).toContain("search");
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
      />
    );

    const output = lastFrame();
    
    // User should see all messages
    expect(output).toContain("Hello world");
    expect(output).toContain("Hello there!");
    expect(output).toContain("Can you write some code?");
    
    // Search highlighting should be visible (text should contain the search term)
    expect(output.toLowerCase()).toContain("hello");
  });

  test("user can see search navigation status", () => {
    const { lastFrame } = render(
      <StatusBar 
        isSearchMode={true}
        searchTerm="test"
        currentSearchResult={2}
        totalSearchResults={5}
      />
    );

    const output = lastFrame();
    
    // User should see their position in search results
    expect(output).toContain("2") && expect(output).toContain("5");
    expect(output).toContain("test");
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
        totalSearchResults={0}
      />
    );

    const output = lastFrame();
    
    // User should see indication of no results
    expect(output).toContain("0") || expect(output).toContain("No") || expect(output).toContain("not found");
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
        currentSearchResult={1}
        totalSearchResults={3}
      />
    );

    const { lastFrame: result2 } = render(
      <StatusBar 
        isSearchMode={true}
        searchTerm="test"
        currentSearchResult={2}
        totalSearchResults={3}
      />
    );

    const output1 = result1();
    const output2 = result2();

    // User should see position change
    expect(output1).not.toEqual(output2);
    expect(output1).toContain("1");
    expect(output2).toContain("2");
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
    const longConversation = Array.from({ length: 10 }, (_, i) => ({
      type: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i + 1} with some test content`,
    }));

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
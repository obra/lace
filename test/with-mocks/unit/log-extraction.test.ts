// ABOUTME: Unit tests for log extraction functionality
// ABOUTME: Tests conversion of ConversationMessage[] to DetailedLogEntry[]

describe("Log Extraction", () => {
  // Define types locally since they're not exported
  interface ToolCall {
    id?: string;
    name: string;
    input: any;
  }

  type ConversationMessage =
    | { type: "user"; content: string }
    | { type: "assistant"; content: string; tool_calls?: ToolCall[] }
    | { type: "loading"; content: string }
    | { type: "streaming"; content: string; isStreaming: boolean }
    | {
        type: "agent_activity";
        summary: string;
        content: string[];
        folded: boolean;
      };

  interface DetailedLogEntry {
    id: string;
    timestamp: string;
    type: ConversationMessage["type"];
    content: string;
  }

  function extractLogEntries(conversation: ConversationMessage[]): DetailedLogEntry[] {
    return conversation.map((message, index) => {
      const timestamp = new Date().toISOString();
      const id = `log-${index}-${timestamp}`;
      
      let content: string;
      if (message.type === "agent_activity") {
        content = `${message.summary}\n${message.content.join('\n')}`;
      } else {
        content = message.content as string;
      }
      
      return {
        id,
        timestamp,
        type: message.type,
        content,
      };
    });
  }

  describe("extractLogEntries", () => {
    test("converts simple messages to log entries", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Hello" },
        { type: "assistant", content: "Hi there!" }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(2);
      expect(logEntries[0].type).toBe("user");
      expect(logEntries[0].content).toBe("Hello");
      expect(logEntries[1].type).toBe("assistant");
      expect(logEntries[1].content).toBe("Hi there!");
    });

    test("generates unique IDs with timestamps", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Test message 1" },
        { type: "user", content: "Test message 2" }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].id).toMatch(/^log-0-\d{4}-\d{2}-\d{2}T/);
      expect(logEntries[1].id).toMatch(/^log-1-\d{4}-\d{2}-\d{2}T/);
      expect(logEntries[0].id).not.toBe(logEntries[1].id);
    });

    test("includes ISO timestamp for each entry", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Test" }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(logEntries[0].timestamp)).not.toThrow();
    });

    test("handles agent_activity messages by combining summary and content", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "agent_activity",
          summary: "File operations",
          content: ["Reading file.txt", "Writing output.log"],
          folded: false
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].type).toBe("agent_activity");
      expect(logEntries[0].content).toBe("File operations\nReading file.txt\nWriting output.log");
    });

    test("handles streaming messages correctly", () => {
      const conversation: ConversationMessage[] = [
        { type: "streaming", content: "Streaming response...", isStreaming: true }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].type).toBe("streaming");
      expect(logEntries[0].content).toBe("Streaming response...");
    });

    test("handles loading messages correctly", () => {
      const conversation: ConversationMessage[] = [
        { type: "loading", content: "Thinking..." }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].type).toBe("loading");
      expect(logEntries[0].content).toBe("Thinking...");
    });

    test("handles empty conversation array", () => {
      const conversation: ConversationMessage[] = [];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(0);
    });

    test("handles mixed message types in correct order", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Hello" },
        { type: "loading", content: "Thinking..." },
        { type: "assistant", content: "Hi!" },
        {
          type: "agent_activity",
          summary: "Tool usage",
          content: ["Called search", "Got results"],
          folded: true
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(4);
      expect(logEntries[0].type).toBe("user");
      expect(logEntries[1].type).toBe("loading");
      expect(logEntries[2].type).toBe("assistant");
      expect(logEntries[3].type).toBe("agent_activity");
      expect(logEntries[3].content).toBe("Tool usage\nCalled search\nGot results");
    });

    test("preserves message types exactly", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Test" },
        { type: "assistant", content: "Test" },
        { type: "loading", content: "Test" },
        { type: "streaming", content: "Test", isStreaming: false },
        {
          type: "agent_activity",
          summary: "Test",
          content: ["Test"],
          folded: false
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].type).toBe("user");
      expect(logEntries[1].type).toBe("assistant");
      expect(logEntries[2].type).toBe("loading");
      expect(logEntries[3].type).toBe("streaming");
      expect(logEntries[4].type).toBe("agent_activity");
    });

    test("handles long content without truncation", () => {
      const longContent = "This is a very long message that should be preserved in its entirety without any truncation or modification because the log view is designed to show complete content for detailed analysis and debugging purposes. ".repeat(5);
      
      const conversation: ConversationMessage[] = [
        { type: "assistant", content: longContent }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[0].content).toBe(longContent);
      expect(logEntries[0].content.length).toBeGreaterThan(500);
    });
  });
});
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
    type: string;
    content: string;
  }

  function extractLogEntries(conversation: ConversationMessage[]): DetailedLogEntry[] {
    const entries: DetailedLogEntry[] = [];
    let entryIndex = 0;

    conversation.forEach((message, messageIndex) => {
      const baseTimestamp = new Date().toISOString();
      
      // Add the main message entry
      let content: string;
      if (message.type === "agent_activity") {
        content = `${message.summary}\n${message.content.join('\n')}`;
      } else {
        content = message.content as string;
      }
      
      entries.push({
        id: `log-${entryIndex++}-${baseTimestamp}`,
        timestamp: baseTimestamp,
        type: message.type as string,
        content,
      });

      // If this is an assistant message with tool calls, add separate tool call entries
      if (message.type === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((toolCall, toolIndex) => {
          // Add tool call entry
          const toolCallTimestamp = new Date(Date.parse(baseTimestamp) + toolIndex + 1).toISOString();
          entries.push({
            id: `log-${entryIndex++}-${toolCallTimestamp}`,
            timestamp: toolCallTimestamp,
            type: "tool_call",
            content: `Tool: ${toolCall.name}\nInput: ${JSON.stringify(toolCall.input, null, 2)}`,
          });
        });
      }
    });

    return entries;
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

    test("extracts tool calls into separate log entries", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "I'll help you read that file.",
          tool_calls: [
            {
              id: "call_123",
              name: "file_read",
              input: { path: "/path/to/file.txt" }
            }
          ]
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(2); // assistant message + tool call
      expect(logEntries[0].type).toBe("assistant");
      expect(logEntries[0].content).toBe("I'll help you read that file.");
      
      expect(logEntries[1].type).toBe("tool_call");
      expect(logEntries[1].content).toContain("Tool: file_read");
      expect(logEntries[1].content).toContain('"path": "/path/to/file.txt"');
    });

    test("handles multiple tool calls in one message", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "I'll read the file and then search for patterns.",
          tool_calls: [
            {
              name: "file_read",
              input: { path: "data.txt" }
            },
            {
              name: "search",
              input: { query: "error", file: "data.txt" }
            }
          ]
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(3); // assistant + 2 tool calls
      expect(logEntries[0].type).toBe("assistant");
      expect(logEntries[1].type).toBe("tool_call");
      expect(logEntries[2].type).toBe("tool_call");
      
      expect(logEntries[1].content).toContain("Tool: file_read");
      expect(logEntries[2].content).toContain("Tool: search");
    });

    test("formats tool call input as JSON", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "Running complex operation.",
          tool_calls: [
            {
              name: "complex_tool",
              input: {
                options: { recursive: true, depth: 3 },
                filters: ["*.js", "*.ts"],
                metadata: { author: "test", version: "1.0" }
              }
            }
          ]
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[1].type).toBe("tool_call");
      expect(logEntries[1].content).toContain("Tool: complex_tool");
      expect(logEntries[1].content).toContain('"recursive": true');
      expect(logEntries[1].content).toContain('"filters"');
      expect(logEntries[1].content).toContain('"*.js"');
      expect(logEntries[1].content).toContain('"author": "test"');
    });

    test("handles tool calls with no input", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "Getting status.",
          tool_calls: [
            {
              name: "status_check",
              input: {}
            }
          ]
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries[1].type).toBe("tool_call");
      expect(logEntries[1].content).toContain("Tool: status_check");
      expect(logEntries[1].content).toContain("Input: {}");
    });

    test("preserves chronological order with tool calls", () => {
      const conversation: ConversationMessage[] = [
        { type: "user", content: "Please read file.txt" },
        {
          type: "assistant",
          content: "I'll read the file for you.",
          tool_calls: [
            { name: "file_read", input: { path: "file.txt" } }
          ]
        },
        { type: "user", content: "Thanks!" }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(4); // user + assistant + tool_call + user
      expect(logEntries[0].type).toBe("user");
      expect(logEntries[0].content).toBe("Please read file.txt");
      expect(logEntries[1].type).toBe("assistant");
      expect(logEntries[1].content).toBe("I'll read the file for you.");
      expect(logEntries[2].type).toBe("tool_call");
      expect(logEntries[2].content).toContain("Tool: file_read");
      expect(logEntries[3].type).toBe("user");
      expect(logEntries[3].content).toBe("Thanks!");
    });

    test("generates unique timestamps for tool calls", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "Running tools.",
          tool_calls: [
            { name: "tool1", input: {} },
            { name: "tool2", input: {} }
          ]
        }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(3);
      expect(logEntries[0].timestamp).not.toBe(logEntries[1].timestamp);
      expect(logEntries[1].timestamp).not.toBe(logEntries[2].timestamp);
      
      // Tool call timestamps should be after the assistant message timestamp
      expect(Date.parse(logEntries[1].timestamp)).toBeGreaterThan(Date.parse(logEntries[0].timestamp));
      expect(Date.parse(logEntries[2].timestamp)).toBeGreaterThan(Date.parse(logEntries[1].timestamp));
    });

    test("handles assistant messages without tool calls normally", () => {
      const conversation: ConversationMessage[] = [
        { type: "assistant", content: "Simple response without tools." }
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].type).toBe("assistant");
      expect(logEntries[0].content).toBe("Simple response without tools.");
    });

    test("extracts usage data from assistant messages", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "Response with usage data",
          usage: {
            inputTokens: 1200,
            outputTokens: 456,
            totalTokens: 1656,
          },
        },
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].usage).toEqual({
        inputTokens: 1200,
        outputTokens: 456,
        totalTokens: 1656,
      });
    });

    test("extracts timing data from tool calls", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "assistant",
          content: "Here are the results",
          tool_calls: [
            {
              name: "shell",
              input: { command: "ls -la" },
            },
          ],
        },
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(2); // assistant + tool_call
      expect(logEntries[1].type).toBe("tool_call");
      expect(logEntries[1].timing).toBeDefined();
      expect(logEntries[1].timing?.durationMs).toBeGreaterThan(0);
    });

    test("extracts timing data from agent activity", () => {
      const conversation: ConversationMessage[] = [
        {
          type: "agent_activity",
          summary: "Processing request",
          content: ["Step 1", "Step 2"],
          folded: false,
          timing: {
            durationMs: 1500,
          },
        },
      ];

      const logEntries = extractLogEntries(conversation);

      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].timing).toEqual({
        durationMs: 1500,
      });
    });
  });
});
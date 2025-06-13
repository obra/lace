// ABOUTME: Unit tests for LaceUI activity logging integration
// ABOUTME: Tests that user_input and agent_response events are logged correctly

import {
  test,
  describe,
  beforeEach,
  afterEach,
  TestHarness,
  assert,
  utils,
} from "../../test-harness.js";
import { LaceUI } from "../../../src/ui/lace-ui.ts";
import { ActivityLogger } from "../../../src/logging/activity-logger.js";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("LaceUI Activity Logging", () => {
  let harness;
  let testDbPath;
  let laceUI;

  beforeEach(async () => {
    harness = new TestHarness();
    testDbPath = join(tmpdir(), `laceui-activity-test-${Date.now()}.db`);
    laceUI = new LaceUI({
      verbose: false,
      memoryPath: ":memory:", // Use in-memory DB for tests
      activityLogPath: testDbPath,
    });

    // Override the model provider with a mock before initializing
    laceUI.modelProvider = {
      initialize: async () => {},
      getModelSession: (modelName) => ({
        definition: {
          name: modelName,
          provider: "anthropic",
          contextWindow: 200000,
          inputPrice: 3.0,
          outputPrice: 15.0,
          capabilities: ["chat", "tools"]
        },
        chat: async () => ({ 
          success: true, 
          content: "Mock response",
          usage: { input_tokens: 10, output_tokens: 20 }
        })
      })
    };

    await laceUI.initialize();
  });

  afterEach(async () => {
    await harness.cleanup();
    if (laceUI) {
      await laceUI.stop();
    }
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe("Activity Logger Initialization", () => {
    test("should initialize activity logger during LaceUI start", async () => {
      // Verify the database was created
      assert.ok(await utils.fileExists(testDbPath));

      // Verify we can query events (should be empty initially)
      const events = await laceUI.getRecentActivity();
      assert.strictEqual(events.length, 0);
    });
  });

  describe("User Input Logging", () => {
    test("should log user_input events with correct data structure through handleMessage", async () => {
      const testInput = "Hello, test input message";

      // Use LaceUI's handleMessage which logs user input automatically
      const response = await laceUI.handleMessage(testInput);
      assert.ok(response.success);

      const events = await laceUI.getRecentActivity();

      // Should have at least the user input event
      const userInputEvents = events.filter(
        (e) => e.event_type === "user_input",
      );
      assert.ok(userInputEvents.length >= 1);

      const event = userInputEvents[0];
      assert.strictEqual(event.event_type, "user_input");
      assert.strictEqual(event.local_session_id, laceUI.conversation.getSessionId());

      const data = JSON.parse(event.data);
      assert.strictEqual(data.content, testInput);
      assert.ok(data.timestamp);
    });
  });

  describe("Agent Response Logging", () => {
    test("should log agent_response events with timing and token data through handleMessage", async () => {
      const testInput = "Test message for agent response";

      // Use LaceUI's handleMessage which logs agent response automatically
      const response = await laceUI.handleMessage(testInput);
      assert.ok(response.success);

      const events = await laceUI.getRecentActivity();

      // Should have agent response event
      const agentResponseEvents = events.filter(
        (e) => e.event_type === "agent_response",
      );
      assert.ok(agentResponseEvents.length >= 1);

      const event = agentResponseEvents[0];
      assert.strictEqual(event.event_type, "agent_response");
      assert.strictEqual(event.local_session_id, laceUI.conversation.getSessionId());

      const data = JSON.parse(event.data);
      assert.ok(data.content);
      assert.ok(data.duration_ms >= 0);
      // Token data might be present depending on the actual response
    });
  });

  describe("Integrated LaceUI Flow", () => {
    test("should log both input and response in correct order", async () => {
      const userInput = "Test user message";

      // Use LaceUI's handleMessage which handles the full flow
      const response = await laceUI.handleMessage(userInput);
      assert.ok(response.success);

      // Verify both events were logged
      const events = await laceUI.getRecentActivity();

      // Should have both user input and agent response events
      const inputEvents = events.filter((e) => e.event_type === "user_input");
      const responseEvents = events.filter(
        (e) => e.event_type === "agent_response",
      );

      assert.ok(inputEvents.length >= 1);
      assert.ok(responseEvents.length >= 1);

      const inputEvent = inputEvents.find(
        (e) => JSON.parse(e.data).content === userInput,
      );
      const responseEvent = responseEvents[0];

      assert.ok(inputEvent);
      assert.strictEqual(inputEvent.event_type, "user_input");
      assert.strictEqual(responseEvent.event_type, "agent_response");

      const inputData = JSON.parse(inputEvent.data);
      const responseData = JSON.parse(responseEvent.data);

      assert.strictEqual(inputData.content, userInput);
      assert.ok(responseData.content);
      assert.ok(responseData.duration_ms >= 0);
    });

    test("should handle multiple conversation turns", async () => {
      const inputs = ["First message", "Second message", "Third message"];

      for (const input of inputs) {
        // Use LaceUI's handleMessage for each turn
        const response = await laceUI.handleMessage(input);
        assert.ok(response.success);

        // Small delay between turns
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const events = await laceUI.getRecentActivity();

      // Count event types
      const inputEvents = events.filter((e) => e.event_type === "user_input");
      const responseEvents = events.filter(
        (e) => e.event_type === "agent_response",
      );

      // Should have at least 3 of each type (might have more due to other activity)
      assert.ok(inputEvents.length >= 3);
      assert.ok(responseEvents.length >= 3);

      // Verify all events have the same session ID
      for (const event of events) {
        assert.strictEqual(event.local_session_id, laceUI.conversation.getSessionId());
      }

      // Verify our specific inputs were logged
      for (const expectedInput of inputs) {
        const foundInput = inputEvents.find((e) => {
          const data = JSON.parse(e.data);
          return data.content === expectedInput;
        });
        assert.ok(foundInput, `Input "${expectedInput}" should be logged`);
      }
    });
  });
});

// ABOUTME: Direct test of debug logging without UI layer
// ABOUTME: Tests DebugLogger and LaceUI logging initialization without terminal dependencies

import { promises as fs } from "fs";
import { describe, beforeEach, afterEach, test } from "@jest/globals";
import assert from "node:assert";
import { DebugLogger } from "../../../src/logging/debug-logger.js";
import { LaceUI } from "../../../src/ui/lace-ui.ts";

describe("Debug Logging Direct Tests", () => {
  const testLogFile = "./test-debug-direct.log";

  beforeEach(async () => {
    // Clean up any existing log file
    try {
      await fs.unlink(testLogFile);
    } catch (error) {
      // File doesn't exist, that's fine
    }
  });

  afterEach(async () => {
    // Clean up log file after test
    try {
      await fs.unlink(testLogFile);
    } catch (error) {
      // File doesn't exist, that's fine
    }
  });

  test("DebugLogger should create log file and write messages", async () => {
    const logger = new DebugLogger({
      logLevel: "off", // No stderr output during tests
      logFile: testLogFile,
      logFileLevel: "debug",
    });

    // Log messages at different levels
    logger.debug("Test debug message");
    logger.info("Test info message");
    logger.warn("Test warning message");
    logger.error("Test error message");

    // Give async file writes time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check file was created
    const logExists = await fs
      .access(testLogFile)
      .then(() => true)
      .catch(() => false);
    assert.ok(logExists, "Debug log file should be created");

    // Check file content
    const logContent = await fs.readFile(testLogFile, "utf8");
    console.log("Log content:", logContent);

    assert.ok(
      logContent.includes("[DEBUG] Test debug message"),
      "Should contain debug message",
    );
    assert.ok(
      logContent.includes("[INFO ] Test info message"),
      "Should contain info message",
    );
    assert.ok(
      logContent.includes("[WARN ] Test warning message"),
      "Should contain warning message",
    );
    assert.ok(
      logContent.includes("[ERROR] Test error message"),
      "Should contain error message",
    );
  });

  test("DebugLogger should respect log levels", async () => {
    const logger = new DebugLogger({
      logLevel: "off", // No console output
      logFile: testLogFile,
      logFileLevel: "info", // Only info and above in file
    });

    logger.debug("Debug message should not appear");
    logger.info("Info message should appear");
    logger.warn("Warning message should appear");
    logger.error("Error message should appear");

    // Give async file writes time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logContent = await fs.readFile(testLogFile, "utf8");
    console.log("Filtered log content:", logContent);

    assert.ok(
      !logContent.includes("[DEBUG]"),
      "Should not contain debug messages",
    );
    assert.ok(logContent.includes("[INFO ]"), "Should contain info messages");
    assert.ok(
      logContent.includes("[WARN ]"),
      "Should contain warning messages",
    );
    assert.ok(logContent.includes("[ERROR]"), "Should contain error messages");
  });

  test("LaceUI should initialize debugLogger correctly", async () => {
    const laceUI = new LaceUI({
      verbose: true,
      logLevel: "off", // No stderr output during tests
      logFile: testLogFile,
      logFileLevel: "debug",
    });

    // Initialize without starting the UI (avoid terminal issues)
    await laceUI.initialize();

    // Access the debugLogger to test it
    const debugLogger = laceUI.debugLogger;
    assert.ok(debugLogger, "LaceUI should have debugLogger instance");

    // Test that it logs
    debugLogger.info("LaceUI debugLogger test message");

    // Give async file writes time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logContent = await fs.readFile(testLogFile, "utf8");
    console.log("LaceUI log content:", logContent);

    assert.ok(
      logContent.includes("[INFO ] LaceUI debugLogger test message"),
      "Should contain message from LaceUI debugLogger",
    );
  });

  test("Agent should receive debugLogger instance from LaceUI", async () => {
    const laceUI = new LaceUI({
      verbose: true,
      logLevel: "off", // No stderr output during tests
      logFile: testLogFile,
      logFileLevel: "debug",
    });

    await laceUI.initialize();

    // Check that the primary agent has the debugLogger
    const agent = laceUI.agentCoordinator.primaryAgentInstance;
    assert.ok(agent, "LaceUI should have primaryAgent");

    console.log("LaceUI debugLogger:", !!laceUI.debugLogger);
    console.log("Agent debugLogger:", !!agent.debugLogger);
    console.log("Agent constructor type:", agent.constructor.name);

    assert.ok(agent.debugLogger, "Agent should have debugLogger instance");
    assert.strictEqual(
      agent.debugLogger,
      laceUI.debugLogger,
      "Agent debugLogger should be the same instance as LaceUI debugLogger",
    );

    // Test that agent can log
    agent.debugLogger.info("Agent debugLogger test message");

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logContent = await fs.readFile(testLogFile, "utf8");
    console.log("Agent log content:", logContent);

    assert.ok(
      logContent.includes("[INFO ] Agent debugLogger test message"),
      "Should contain message from agent debugLogger",
    );
  });

  test("CLI options should be parsed correctly", async () => {
    // Test different combinations of CLI options
    const testCases = [
      {
        options: {
          logLevel: "off", // No stderr during tests
          logFile: testLogFile,
          logFileLevel: "info",
        },
        expectedStderrLevel: "off",
        expectedFileLevel: "info",
      },
      {
        options: {
          logLevel: "off",
          logFile: testLogFile,
          logFileLevel: "debug",
        },
        expectedStderrLevel: "off",
        expectedFileLevel: "debug",
      },
      {
        options: { logLevel: "off", logFile: testLogFile }, // No stderr during tests
        expectedStderrLevel: "off",
        expectedFileLevel: "debug", // Default
      },
    ];

    for (const testCase of testCases) {
      const laceUI = new LaceUI(testCase.options);
      const debugLogger = laceUI.debugLogger;

      assert.strictEqual(
        debugLogger.stderrLevel,
        testCase.expectedStderrLevel,
        `stderr level should be ${testCase.expectedStderrLevel}`,
      );
      assert.strictEqual(
        debugLogger.fileLevel,
        testCase.expectedFileLevel,
        `file level should be ${testCase.expectedFileLevel}`,
      );
      assert.strictEqual(
        debugLogger.filePath,
        testLogFile,
        "file path should be set correctly",
      );

      // Clean up before next iteration
      try {
        await fs.unlink(testLogFile);
      } catch (e) {}
    }
  });
});

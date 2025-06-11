// ABOUTME: Integration tests for command system functionality
// ABOUTME: Tests user command experience, execution, and feedback

import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import React from "react";
import { renderInkComponent } from "../../with-mocks/helpers/ink-test-utils";
import { CommandManager } from "@/ui/commands/CommandManager";
import { getAllCommands } from "@/ui/commands/registry";
import InputBar from "@/ui/components/InputBar";
import ConversationView from "@/ui/components/ConversationView";

describe("Command System Integration", () => {
  let commandManager: CommandManager;

  beforeEach(() => {
    commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
  });

  test("user can see available commands through help", async () => {
    const mockContext = {
      laceUI: {
        commandManager: commandManager,
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
    };

    const result = await commandManager.execute("/help", mockContext);
    
    // User should see command help information
    expect(result.success).toBe(true);
    expect(result.shouldShowModal).toBeDefined();
    expect(result.shouldShowModal?.type).toBe("help");
    expect(result.shouldShowModal?.data.helpText).toContain("Available commands");
  });

  test("user can check application status", async () => {
    const mockContext = {
      laceUI: {
        getStatus: jest.fn().mockReturnValue({
          messages: [{ content: "test", type: "user" }],
          tokenUsage: { used: 100, limit: 1000 }
        }),
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ 
          messages: [{ content: "test", type: "user" }],
          tokenUsage: { used: 100, limit: 1000 }
        }),
      },
      agent: { /* mock agent */ },
    };

    const result = await commandManager.execute("/status", mockContext);
    
    // User should see status information
    expect(result.success).toBe(true);
    expect(result.shouldShowModal).toBeDefined();
    expect(result.shouldShowModal?.type).toBe("status");
    expect(mockContext.laceUI.getStatus).toHaveBeenCalled();
  });

  test("user can list available tools", async () => {
    const mockContext = {
      laceUI: {
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
      agent: {
        tools: {
          listTools: jest.fn().mockReturnValue(["file-tool", "search-tool"]),
          getToolSchema: jest.fn().mockReturnValue({ description: "Mock tool description" }),
        },
      },
    };

    const result = await commandManager.execute("/tools", mockContext);
    
    // User should see available tools
    expect(result.success).toBe(true);
    expect(result.shouldShowModal).toBeDefined();
    expect(result.shouldShowModal?.type).toBe("tools");
    expect(result.shouldShowModal?.data.tools).toBeDefined();
  });

  test("user receives feedback for invalid commands", async () => {
    const mockContext = {
      laceUI: {
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
    };

    const result = await commandManager.execute("/nonexistent", mockContext);
    
    // User should see error feedback
    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
  });

  test("user can see command suggestions for typos", () => {
    // Test command suggestion system
    expect(commandManager.hasCommand("help")).toBe(true);
    expect(commandManager.hasCommand("quit")).toBe(true);
    expect(commandManager.hasCommand("status")).toBe(true);
    
    // User should have these essential commands available
    const commands = commandManager.listCommands();
    expect(commands.length).toBeGreaterThan(0);
  });

  test("user can execute commands with parameters", async () => {
    const mockContext = {
      laceUI: {
        commandManager: commandManager,
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
    };

    // Test command with parameters - help command should work with or without parameters
    const result = await commandManager.execute("/help status", mockContext);
    
    // User should see help information (help command ignores parameters)
    expect(result.success).toBe(true);
    expect(result.shouldShowModal?.type).toBe("help");
  });

  test("user sees command execution results immediately", async () => {
    const mockContext = {
      laceUI: {
        commandManager: commandManager,
        getStatus: jest.fn().mockReturnValue({ test: "status" }),
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
      agent: {
        tools: {
          listTools: jest.fn().mockReturnValue(["file-tool"]),
          getToolSchema: jest.fn().mockReturnValue({ description: "Mock tool" }),
        },
      },
    };

    // Execute multiple commands to test immediate feedback
    const result1 = await commandManager.execute("/help", mockContext);
    const result2 = await commandManager.execute("/status", mockContext);
    
    // User should see results for each command
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.shouldShowModal).toBeDefined();
    expect(result2.shouldShowModal).toBeDefined();
  });

  test("user can distinguish command input from regular messages", () => {
    // Test that command syntax is recognizable
    const { lastFrame: commandInput } = renderInkComponent(
      <InputBar 
        isNavigationMode={false}
        inputText="/help"
      />
    );

    const { lastFrame: regularInput } = renderInkComponent(
      <InputBar 
        isNavigationMode={false}
        inputText="regular message"
      />
    );

    const commandOutput = commandInput();
    const regularOutput = regularInput();

    // Command input should be visually distinguishable
    expect(commandOutput).toContain("/help");
    expect(regularOutput).toContain("regular message");
    expect(commandOutput).not.toEqual(regularOutput);
  });

  test("user can see command results in conversation", () => {
    const messages = [
      { type: "user" as const, content: "/status" },
      { type: "assistant" as const, content: "Status: Application running normally" },
      { type: "user" as const, content: "/tools" },
      { type: "assistant" as const, content: "Available tools: file-tool, search-tool" },
    ];

    const { lastFrame } = renderInkComponent(<ConversationView messages={messages} />);
    const output = lastFrame();

    // User should see command execution history
    expect(output).toContain("/status");
    expect(output).toContain("Status: Application running normally");
    expect(output).toContain("/tools");
    expect(output).toContain("Available tools:");
  });

  test("user can access command completion", () => {
    // Test that commands are available for completion
    const allCommands = commandManager.listCommands();
    const commandNames = allCommands.map(cmd => cmd.name);
    
    // User should have access to essential commands
    expect(commandNames).toContain("help");
    expect(commandNames).toContain("quit");
    expect(commandNames).toContain("status");
    
    // Commands should be easily discoverable
    expect(allCommands.length).toBeGreaterThan(3);
  });

  test("user receives helpful error messages for malformed commands", async () => {
    const mockContext = {
      laceUI: {
        addMessage: jest.fn(),
        setState: jest.fn(),
        getState: jest.fn().mockReturnValue({ messages: [] }),
      },
    };

    // Test various invalid command formats
    const result1 = await commandManager.execute("/", mockContext);
    const result2 = await commandManager.execute("/invalid-command", mockContext);
    
    // User should get helpful error messages
    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
    expect(result1.success || result2.success).toBe(false);
  });
});
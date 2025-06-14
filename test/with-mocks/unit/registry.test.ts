// ABOUTME: Tests for command registry - validates all default commands work correctly
// ABOUTME: Tests command execution with various contexts and scenarios

import { jest } from "@jest/globals";
import {
  basicCommands,
  agentCommands,
  toolManagementCommands,
  getAllCommands,
} from "@/ui/commands/registry";
import type { CommandContext } from "@/ui/commands/types";

// Import new mock factories
import { createMockTools, createMockDatabase } from "../__mocks__/standard-mocks.js";

describe("Command Registry", () => {
  let mockContext: CommandContext;
  let mockLaceUI: any;
  let mockAgent: any;

  beforeEach(() => {
    const mockCommandManager = {
      getHelpText: jest.fn(
        () => "Available commands:\n  /help - Show help\n  /quit - Exit",
      ),
    };

    mockLaceUI = {
      commandManager: mockCommandManager,
      getStatus: jest.fn(() => ({
        agent: { role: "orchestrator", model: "claude-3-5-sonnet" },
        context: { used: 1000, total: 200000, percentage: 0.5 },
        session: "test-session",
      })),
      sessionId: "test-session",
    };

    const mockTools = createMockTools({
      availableTools: ["file", "shell", "search"],
      shouldSucceed: true,
      customResponses: {}
    });

    const mockDatabase = createMockDatabase({
      conversationHistory: [
        { role: "user", content: "test message", timestamp: Date.now() },
        { role: "assistant", content: "test response", timestamp: Date.now() },
      ],
      shouldSucceed: true
    });

    mockAgent = {
      tools: mockTools,
      toolApproval: {
        getStatus: jest.fn(() => ({
          interactive: true,
          autoApprove: ["file"],
          denyList: ["dangerous-tool"],
        })),
        addAutoApprove: jest.fn(),
        addDenyList: jest.fn(),
      },
      getConversationHistory: mockDatabase.getConversationHistory,
    };

    mockContext = {
      laceUI: mockLaceUI,
      agent: mockAgent,
      addMessage: jest.fn(),
    };
  });

  describe("basicCommands", () => {
    it("should handle help command", async () => {
      const helpCmd = basicCommands.find((cmd) => cmd.name === "help")!;
      const result = await helpCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldShowModal).toEqual({
        type: "help",
        data: {
          helpText: "Available commands:\n  /help - Show help\n  /quit - Exit",
        },
      });
    });

    it("should handle quit command", async () => {
      const quitCmd = basicCommands.find((cmd) => cmd.name === "quit")!;
      const result = await quitCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldExit).toBe(true);
      expect(result.message).toBe("Goodbye!");
    });

    it("should handle quit aliases", async () => {
      const quitCmd = basicCommands.find((cmd) => cmd.name === "quit")!;
      expect(quitCmd.aliases).toContain("exit");
      expect(quitCmd.aliases).toContain("q");
    });

    it("should handle help command when command manager unavailable", async () => {
      const helpCmd = basicCommands.find((cmd) => cmd.name === "help")!;
      const contextWithoutCM = { ...mockContext, laceUI: {} };
      const result = await helpCmd.handler([], contextWithoutCM);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Command manager not available");
    });
  });

  describe("agentCommands", () => {
    it("should handle status command", async () => {
      const statusCmd = agentCommands.find((cmd) => cmd.name === "status")!;
      const result = await statusCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldShowModal?.type).toBe("status");
      expect(mockLaceUI.getStatus).toHaveBeenCalled();
    });

    it("should handle tools command", async () => {
      const toolsCmd = agentCommands.find((cmd) => cmd.name === "tools")!;
      const result = await toolsCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldShowModal?.type).toBe("tools");
      expect(result.shouldShowModal?.data.tools).toEqual([
        { name: "file", description: "Mock file tool description" },
        { name: "shell", description: "Mock shell tool description" },
        { name: "search", description: "Mock search tool description" },
      ]);
    });

    it("should handle memory command", async () => {
      jest.useRealTimers(); // Use real timers for async operation
      const memoryCmd = agentCommands.find((cmd) => cmd.name === "memory")!;
      const result = await memoryCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldShowModal?.type).toBe("memory");
      expect(mockAgent.getConversationHistory).toHaveBeenCalledWith(
        "test-session",
        10,
      );
      jest.useFakeTimers(); // Restore fake timers
    });

    it("should handle approval command", async () => {
      const approvalCmd = agentCommands.find((cmd) => cmd.name === "approval")!;
      const result = await approvalCmd.handler([], mockContext);

      expect(result.success).toBe(true);
      expect(result.shouldShowModal?.type).toBe("approval");
      expect(mockAgent.toolApproval.getStatus).toHaveBeenCalled();
    });

    it("should require agent for agent commands", () => {
      for (const cmd of agentCommands) {
        expect(cmd.requiresAgent).toBe(true);
      }
    });

    it("should handle missing agent tools gracefully", async () => {
      const toolsCmd = agentCommands.find((cmd) => cmd.name === "tools")!;
      const contextWithoutTools = {
        ...mockContext,
        agent: { ...mockAgent, tools: undefined },
      };
      const result = await toolsCmd.handler([], contextWithoutTools);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No tool registry available");
    });
  });

  describe("toolManagementCommands", () => {
    it("should handle auto-approve command with argument", async () => {
      const autoApproveCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "auto-approve",
      )!;
      const result = await autoApproveCmd.handler(["file"], mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Added 'file' to auto-approve list");
      expect(mockAgent.toolApproval.addAutoApprove).toHaveBeenCalledWith(
        "file",
      );
    });

    it("should handle auto-approve command without argument", async () => {
      const autoApproveCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "auto-approve",
      )!;
      const result = await autoApproveCmd.handler([], mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Usage: /auto-approve <tool_name>");
    });

    it("should handle deny command with argument", async () => {
      const denyCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "deny",
      )!;
      const result = await denyCmd.handler(["dangerous-tool"], mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Added 'dangerous-tool' to deny list");
      expect(mockAgent.toolApproval.addDenyList).toHaveBeenCalledWith(
        "dangerous-tool",
      );
    });

    it("should handle deny command without argument", async () => {
      const denyCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "deny",
      )!;
      const result = await denyCmd.handler([], mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Usage: /deny <tool_name>");
    });

    it("should have parameter descriptions", () => {
      const autoApproveCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "auto-approve",
      )!;
      const denyCmd = toolManagementCommands.find(
        (cmd) => cmd.name === "deny",
      )!;

      expect(autoApproveCmd.parameterDescription).toBe("<tool_name>");
      expect(denyCmd.parameterDescription).toBe("<tool_name>");
    });
  });

  describe("getAllCommands", () => {
    it("should return all commands", () => {
      const allCommands = getAllCommands();

      expect(allCommands.length).toBe(
        basicCommands.length +
          agentCommands.length +
          toolManagementCommands.length,
      );

      // Check that all command types are included
      const commandNames = allCommands.map((cmd) => cmd.name);
      expect(commandNames).toContain("help");
      expect(commandNames).toContain("quit");
      expect(commandNames).toContain("status");
      expect(commandNames).toContain("tools");
      expect(commandNames).toContain("memory");
      expect(commandNames).toContain("approval");
      expect(commandNames).toContain("auto-approve");
      expect(commandNames).toContain("deny");
    });
  });
});

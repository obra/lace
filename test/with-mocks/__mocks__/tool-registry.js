// Mock ToolRegistry for Jest tests
import { jest } from "@jest/globals";

export class ToolRegistry {
  constructor() {}

  initialize = jest.fn().mockResolvedValue(undefined);
  listTools = jest
    .fn()
    .mockReturnValue(["file", "shell", "javascript", "search", "task"]);
  get = jest.fn().mockReturnValue(null);
  getToolSchema = jest.fn((toolName) => ({
    description: `Mock ${toolName} tool description`,
    methods: {
      execute: {
        description: `Execute ${toolName}`,
        parameters: {
          input: {
            type: "string",
            required: false,
            description: "Input parameter",
          },
        },
      },
      read: {
        description: `Read using ${toolName}`,
        parameters: {
          path: { type: "string", required: true, description: "File path" },
        },
      },
    },
  }));
}

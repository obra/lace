// Mock ToolRegistry for Jest tests
import { jest } from "@jest/globals";

export class ToolRegistry {
  constructor() {}

  initialize = jest.fn().mockResolvedValue(undefined);
  listTools = jest.fn().mockReturnValue(["file", "shell", "javascript"]);
  get = jest.fn().mockReturnValue(null);
}

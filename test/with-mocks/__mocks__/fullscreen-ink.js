// Mock fullscreen-ink module for Jest tests
import { jest } from "@jest/globals";

export const withFullScreen = jest
  .fn()
  .mockImplementation((component, options) => {
    return {
      start: jest.fn().mockResolvedValue({
        unmount: jest.fn(),
      }),
    };
  });

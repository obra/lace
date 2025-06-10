// ABOUTME: File operations tool for reading, writing, and editing files
// ABOUTME: Supports atomic operations and basic file system manipulation

import { promises as fs } from "fs";
import { join, dirname } from "path";

export class FileTool {
  async read(params) {
    const { path, encoding = "utf8" } = params;
    try {
      const content = await fs.readFile(path, encoding);
      return {
        success: true,
        content,
        size: content.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async write(params) {
    const { path, content, encoding = "utf8" } = params;
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, content, encoding);
      return {
        success: true,
        bytesWritten: content.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async append(params) {
    const { path, content, encoding = "utf8" } = params;
    try {
      await fs.appendFile(path, content, encoding);
      return {
        success: true,
        bytesAppended: content.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async exists(params) {
    const { path } = params;
    try {
      await fs.access(path);
      return { success: true, exists: true };
    } catch {
      return { success: true, exists: false };
    }
  }

  async list(params) {
    const { path = ".", recursive = false } = params;
    try {
      if (recursive) {
        const files = [];
        const walk = async (dir) => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(fullPath);
            } else {
              files.push(fullPath);
            }
          }
        };
        await walk(path);
        return { success: true, files };
      } else {
        const entries = await fs.readdir(path, { withFileTypes: true });
        const files = entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        }));
        return { success: true, files };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async edit(params) {
    const { path, find, replace, all = false } = params;
    try {
      let content = await fs.readFile(path, "utf8");

      if (all) {
        content = content.replaceAll(find, replace);
      } else {
        content = content.replace(find, replace);
      }

      await fs.writeFile(path, content, "utf8");
      return {
        success: true,
        modified: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  getSchema() {
    return {
      name: "file",
      description: "File system operations",
      methods: {
        read: {
          description: "Read file contents",
          parameters: {
            path: {
              type: "string",
              required: true,
              description: "File path to read",
            },
            encoding: {
              type: "string",
              required: false,
              description: "File encoding (default: utf8)",
            },
          },
        },
        write: {
          description: "Write content to file",
          parameters: {
            path: {
              type: "string",
              required: true,
              description: "File path to write",
            },
            content: {
              type: "string",
              required: true,
              description: "Content to write",
            },
            encoding: {
              type: "string",
              required: false,
              description: "File encoding (default: utf8)",
            },
          },
        },
        list: {
          description: "List directory contents",
          parameters: {
            path: {
              type: "string",
              required: false,
              description: "Directory path (default: current)",
            },
            recursive: {
              type: "boolean",
              required: false,
              description: "List recursively",
            },
          },
        },
        edit: {
          description: "Edit file by find and replace",
          parameters: {
            path: {
              type: "string",
              required: true,
              description: "File path to edit",
            },
            find: {
              type: "string",
              required: true,
              description: "Text to find",
            },
            replace: {
              type: "string",
              required: true,
              description: "Replacement text",
            },
            all: {
              type: "boolean",
              required: false,
              description: "Replace all occurrences",
            },
          },
        },
      },
    };
  }
}

// ABOUTME: Text search tool for finding content across files and directories
// ABOUTME: Provides grep-like functionality with regex support

import { promises as fs } from "fs";
import { join } from "path";

export class SearchTool {
  async grep(params) {
    const { pattern, path = ".", recursive = true, ignoreCase = true } = params;

    const flags = ignoreCase ? "gi" : "g";
    const regex = new RegExp(pattern, flags);
    const results = [];

    const searchFile = async (filePath) => {
      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (regex.test(line)) {
            results.push({
              file: filePath,
              line: i + 1,
              content: line.trim(),
              match: line.match(regex)?.[0],
            });
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    };

    const searchDirectory = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);

          if (entry.isDirectory() && recursive) {
            await searchDirectory(fullPath);
          } else if (entry.isFile()) {
            await searchFile(fullPath);
          }
        }
      } catch (error) {
        // Skip directories that can't be accessed
      }
    };

    try {
      const stat = await fs.stat(path);
      if (stat.isDirectory()) {
        await searchDirectory(path);
      } else {
        await searchFile(path);
      }

      return {
        success: true,
        results,
        count: results.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async find(params) {
    const { name, path = ".", type = "both" } = params;
    const pattern = new RegExp(name, "i");
    const results = [];

    const searchDirectory = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);

          if (pattern.test(entry.name)) {
            if (
              type === "both" ||
              (type === "file" && entry.isFile()) ||
              (type === "directory" && entry.isDirectory())
            ) {
              results.push({
                path: fullPath,
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
              });
            }
          }

          if (entry.isDirectory()) {
            await searchDirectory(fullPath);
          }
        }
      } catch (error) {
        // Skip directories that can't be accessed
      }
    };

    try {
      await searchDirectory(path);

      return {
        success: true,
        results,
        count: results.length,
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
      name: "search",
      description: "Search for text and files",
      methods: {
        grep: {
          description: "Search for text patterns in files",
          parameters: {
            pattern: {
              type: "string",
              required: true,
              description: "Regular expression pattern to search for",
            },
            path: {
              type: "string",
              required: false,
              description: "Path to search in (default: current directory)",
            },
            recursive: {
              type: "boolean",
              required: false,
              description: "Search recursively (default: true)",
            },
            ignoreCase: {
              type: "boolean",
              required: false,
              description: "Case insensitive search (default: true)",
            },
          },
        },
        find: {
          description: "Find files and directories by name",
          parameters: {
            name: {
              type: "string",
              required: true,
              description: "Name pattern to search for",
            },
            path: {
              type: "string",
              required: false,
              description: "Path to search in (default: current directory)",
            },
            type: {
              type: "string",
              required: false,
              description:
                "Type to search for: file, directory, or both (default: both)",
            },
          },
        },
      },
    };
  }
}

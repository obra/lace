// ABOUTME: Shell command execution tool for system operations
// ABOUTME: Provides safe command execution with output capture and error handling

import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class ShellTool {
  async execute(params) {
    const { command, cwd = process.cwd(), timeout = 30000 } = params;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
      };
    } catch (error) {
      return {
        success: false,
        stdout: error.stdout?.trim() || "",
        stderr: error.stderr?.trim() || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  async run(params) {
    // Alias for execute
    return this.execute(params);
  }

  async interactive(params) {
    const { command, args = [], cwd = process.cwd() } = params;

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        stdio: "inherit",
      });

      child.on("close", (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
        });
      });

      child.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  getSchema() {
    return {
      name: "shell",
      description: "Execute shell commands",
      methods: {
        execute: {
          description: "Execute a shell command and capture output",
          parameters: {
            command: {
              type: "string",
              required: true,
              description: "Shell command to execute",
            },
            cwd: {
              type: "string",
              required: false,
              description: "Working directory",
            },
            timeout: {
              type: "number",
              required: false,
              description: "Timeout in milliseconds (default: 30000)",
            },
          },
        },
        run: {
          description: "Alias for execute",
          parameters: {
            command: {
              type: "string",
              required: true,
              description: "Shell command to execute",
            },
            cwd: {
              type: "string",
              required: false,
              description: "Working directory",
            },
            timeout: {
              type: "number",
              required: false,
              description: "Timeout in milliseconds (default: 30000)",
            },
          },
        },
        interactive: {
          description: "Run command interactively (inherit stdio)",
          parameters: {
            command: {
              type: "string",
              required: true,
              description: "Command to run",
            },
            args: {
              type: "array",
              required: false,
              description: "Command arguments",
            },
            cwd: {
              type: "string",
              required: false,
              description: "Working directory",
            },
          },
        },
      },
    };
  }
}

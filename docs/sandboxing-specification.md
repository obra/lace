# File System Sandboxing Specification for Lace

## Overview

To protect users from malicious (or incompetent) AI model behavior, Lace should restrict all file write operations and bash commands to safe directories by default. This document specifies a simple sandboxing approach that:

1. **Secure by default** - Only allows operations in working directory and temp directories
2. **Progressive consent** - Prompts user when operations are blocked
3. **Simple override** - Single `--disable-sandbox` flag to disable protection
4. **Cross-platform** - Pure TypeScript implementation

## Architecture

### Core Components

```
src/security/
├── sandbox-validator.ts        # Path validation and user prompts
└── __tests__/
    └── sandbox-validator.test.ts
```

### CLI Integration

```typescript
interface CLIOptions {
  // ... existing options
  disableSandbox: boolean;  // Single flag to disable all sandboxing
}
```

### Tool Integration

All file-writing tools (file_write, file_edit, file_insert, bash) will be wrapped with sandbox validation before execution.

## Implementation

### Core Sandbox Validator (UX Layer)

```typescript
// src/security/sandbox-validator.ts
export class SandboxValidator {
  private allowedPaths: Set<string>;
  private disabled: boolean;
  
  constructor(disabled: boolean = false) {
    this.disabled = disabled;
    this.allowedPaths = new Set([
      process.cwd(),
      os.tmpdir(),
      path.join(os.tmpdir(), 'lace'),
    ]);
  }
  
  async validatePath(targetPath: string): Promise<ValidationResult> {
    if (this.disabled) {
      return { allowed: true };
    }
    
    const resolvedPath = path.resolve(targetPath);
    const parentDir = path.dirname(resolvedPath);
    
    // Check if path is already allowed
    for (const allowedPath of this.allowedPaths) {
      if (resolvedPath.startsWith(allowedPath)) {
        return { allowed: true };
      }
    }
    
    // Path not allowed - prompt user
    return await this.promptUser(resolvedPath, parentDir);
  }
  
  private async promptUser(targetPath: string, parentDir: string): Promise<ValidationResult> {
    const choice = await this.showPrompt(
      `Tool wants to write to: ${targetPath}\n\n` +
      `This path is outside the sandbox. Choose an option:`,
      [
        { label: 'Allow once', value: 'once' },
        { label: `Allow all operations in ${parentDir}`, value: 'directory' },
        { label: 'Deny', value: 'deny' }
      ]
    );
    
    switch (choice) {
      case 'once':
        return { allowed: true, temporary: true };
      case 'directory':
        this.allowedPaths.add(parentDir);
        return { allowed: true };
      case 'deny':
      default:
        return { allowed: false, reason: 'User denied access' };
    }
  }
}
```

### Platform-Level Enforcement

#### macOS - Seatbelt Profiles

```typescript
// src/security/platforms/macos-sandbox.ts
export class MacOSSandbox {
  async createSandboxProfile(allowedPaths: Set<string>): Promise<string> {
    const pathRules = Array.from(allowedPaths)
      .map(path => `(subpath "${path}")`)
      .join('\n  ');
    
    return `
(version 1)
(deny default)
(allow process-info* (target self))
(allow file-read*)
(allow file-write* 
  ${pathRules}
  (subpath "/tmp")
  (subpath "/var/tmp")
)
(allow network-outbound)
(allow process-exec
  (path "/bin/bash")
  (path "/usr/bin/node")
  (path "/usr/local/bin/node")
)
(allow mach-lookup 
  (global-name "com.apple.system.opendirectoryd.api"))
`;
  }
  
  async enableSandbox(profile: string): Promise<void> {
    const fs = await import('fs/promises');
    const profilePath = `/tmp/lace-sandbox-${process.pid}.sb`;
    
    await fs.writeFile(profilePath, profile);
    
    // Apply sandbox to current process
    const { execSync } = await import('child_process');
    execSync(`sandbox-exec -f ${profilePath} true`); // Test profile
    
    // TODO: Apply to current process using sandbox_init()
    // This requires native bindings or process restart
  }
}
```

#### Linux - seccomp + Path Validation

```typescript
// src/security/platforms/linux-sandbox.ts  
export class LinuxSandbox {
  async enableSandbox(allowedPaths: Set<string>): Promise<void> {
    // Install seccomp filter to restrict file operations
    if (await this.hasSeccompSupport()) {
      await this.setupSeccompFilter();
    }
    
    // Hook file system calls at libc level
    await this.setupLibcHooks(allowedPaths);
  }
  
  private async setupSeccompFilter(): Promise<void> {
    // Use seccomp-bpf to restrict dangerous system calls
    // Block: openat, creat, mkdir, rmdir, unlink, rename
    // Allow: read, write to already-opened descriptors
    
    const seccompRules = `
A = sys_number
A == openat ? next : allow
A == creat ? next : allow  
A == mkdir ? next : allow
A == unlink ? next : allow
return ERRNO(1)
allow:
return ALLOW
`;
    
    // Apply seccomp filter (requires native implementation)
    await this.applySeccompFilter(seccompRules);
  }
  
  private async setupLibcHooks(allowedPaths: Set<string>): Promise<void> {
    // Use LD_PRELOAD to intercept file operations
    // Validate paths against allowedPaths before calling real syscalls
    const hookLibPath = await this.buildHookLibrary(allowedPaths);
    process.env.LD_PRELOAD = hookLibPath;
  }
}
```

#### Windows - Job Objects

```typescript
// src/security/platforms/windows-sandbox.ts
export class WindowsSandbox {
  async enableSandbox(allowedPaths: Set<string>): Promise<void> {
    const jobName = `lace-sandbox-${process.pid}`;
    
    // Create job object with file system restrictions
    await this.createRestrictedJob(jobName, allowedPaths);
    await this.assignProcessToJob(process.pid, jobName);
  }
  
  private async createRestrictedJob(name: string, allowedPaths: Set<string>): Promise<void> {
    // Use Windows API to create job object
    // Set JOBOBJECT_BASIC_LIMIT_INFORMATION to restrict file access
    // Configure JOBOBJECT_BASIC_UI_RESTRICTIONS
    
    const pathList = Array.from(allowedPaths).join(';');
    
    const powershellScript = `
$job = New-Object System.Diagnostics.ProcessStartInfo
$job.FileName = "powershell"
$job.Arguments = "-Command Set-Location '${process.cwd()}'"
$job.CreateNoWindow = $true
$job.UseShellExecute = $false

# Apply file system restrictions
# TODO: Implement via Windows Job Objects API
`;
    
    await this.runPowerShellScript(powershellScript);
  }
}
```

### Tool Integration

Modify the ToolExecutor to validate paths before execution:

```typescript
// src/tools/tool-executor.ts (modified)
export class ToolExecutor {
  private sandboxValidator: SandboxValidator;
  
  constructor(disableSandbox: boolean = false) {
    this.sandboxValidator = new SandboxValidator(disableSandbox);
  }
  
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Validate paths before execution
    const pathFields = this.getPathFields(toolName);
    
    for (const field of pathFields) {
      if (input[field] && typeof input[field] === 'string') {
        const validation = await this.sandboxValidator.validatePath(input[field] as string);
        if (!validation.allowed) {
          return {
            content: [{
              type: 'text',
              text: `Operation blocked: ${validation.reason}`
            }],
            isError: true,
          };
        }
      }
    }
    
    // Proceed with normal tool execution
    return this.executeToolUnsafe(toolName, input, context);
  }
  
  private getPathFields(toolName: string): string[] {
    const pathFieldMap: Record<string, string[]> = {
      'file_write': ['path'],
      'file_edit': ['path'], 
      'file_insert': ['path'],
      'bash': [], // Special handling needed for commands
    };
    
    return pathFieldMap[toolName] || [];
  }
}
```

## Configuration

### Default Behavior

**Sandbox enabled by default** with these allowed locations:
- Current working directory and subdirectories
- System temp directories (`/tmp`, `%TEMP%`)
- Lace temp directory (`/tmp/lace`)

### CLI Configuration

```bash
# Default - sandbox enabled
lace

# Disable sandbox completely
lace --disable-sandbox
```

### Runtime Permission Model

When a tool tries to access a path outside the sandbox:

1. **Allow once** - Permit this specific operation only
2. **Allow directory** - Add the parent directory to allowed paths for the session  
3. **Deny** - Block the operation

Permissions granted during a session are not persisted between runs.

## Implementation Plan

### Phase 1: Core Implementation
- [ ] Implement `SandboxValidator` class with user prompts
- [ ] Add `--disable-sandbox` CLI flag  
- [ ] Integrate with ToolExecutor
- [ ] Add comprehensive tests

### Phase 2: Bash Command Handling
- [ ] Add basic command parsing for file operations
- [ ] Handle common patterns like `>`, `>>`, `cp`, `mv`
- [ ] Prompt for any detected file writes

### Phase 3: Polish
- [ ] Improve user prompt UX in terminal interface
- [ ] Add session permission persistence
- [ ] Add logging for security audit trail

## Security Considerations

1. **Path Traversal Prevention**: All paths are resolved and normalized before validation
2. **Symlink Handling**: Resolve symlinks to their targets for validation  
3. **User Consent**: All operations outside sandbox require explicit user approval
4. **Session Scope**: Permissions are granted only for current session

## Testing Strategy

1. **Unit Tests**: `SandboxValidator` class behavior
2. **Integration Tests**: Tool execution with sandbox prompts
3. **Security Tests**: Attempt to bypass sandbox restrictions
4. **UX Tests**: User prompt experience in terminal interface

## User Experience

When a tool tries to access a blocked path:

```
🛡️  Sandbox Protection

Tool wants to write to: /etc/hosts

This path is outside the sandbox. Choose an option:
  [1] Allow once
  [2] Allow all operations in /etc  
  [3] Deny

Choice:
```

## Migration Path

1. **Feature Flag**: Add `--disable-sandbox` flag first (defaults to disabled)
2. **Default Change**: Enable sandbox by default in minor version bump
3. **Documentation**: Update guides with sandbox examples

This simplified approach provides immediate security benefits while maintaining excellent usability through progressive consent.

// ABOUTME: Integration test for command system in Ink UI
// ABOUTME: Tests that command system compiles and integrates without crashing

import { jest } from '@jest/globals';
import { CommandManager } from '@/ui/commands/CommandManager';
import { getAllCommands } from '@/ui/commands/registry';
import { createCompletionManager } from '@/ui/completion/index';

describe('Step 16: Command System Integration', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useFakeTimers();
  });

  it('should create command manager with all commands', () => {
    const commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
    
    expect(commandManager.hasCommand('help')).toBe(true);
    expect(commandManager.hasCommand('quit')).toBe(true);
    expect(commandManager.hasCommand('status')).toBe(true);
    expect(commandManager.hasCommand('tools')).toBe(true);
    expect(commandManager.hasCommand('memory')).toBe(true);
    expect(commandManager.hasCommand('approval')).toBe(true);
    expect(commandManager.hasCommand('auto-approve')).toBe(true);
    expect(commandManager.hasCommand('deny')).toBe(true);
  });

  it('should integrate with completion system', () => {
    const commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
    
    const completionManager = createCompletionManager({
      commandManager,
      cwd: process.cwd(),
      history: []
    });
    
    expect(completionManager).toBeDefined();
  });

  it('should execute basic commands', async () => {
    const commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
    
    const mockContext = {
      laceUI: {
        commandManager,
        getStatus: () => ({
          agent: { role: 'test' },
          context: { used: 0, total: 1000 }
        })
      },
      agent: null,
      addMessage: jest.fn()
    };

    const result = await commandManager.execute('/help', mockContext);
    expect(result.success).toBe(true);
    expect(result.shouldShowModal?.type).toBe('help');
  });

  it('should handle command completions', () => {
    const commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
    
    const completions = commandManager.getCompletions('h');
    expect(completions).toHaveLength(1);
    expect(completions[0].value).toBe('help');
  });

  it('should validate command system architecture', () => {
    // Verify clean architecture - commands return structured results
    const commandManager = new CommandManager();
    commandManager.registerAll(getAllCommands());
    
    const commands = commandManager.listCommands();
    expect(commands.length).toBeGreaterThan(0);
    
    // All commands should have required properties
    for (const cmd of commands) {
      expect(cmd).toHaveProperty('name');
      expect(cmd).toHaveProperty('description');
      expect(cmd).toHaveProperty('handler');
      expect(typeof cmd.handler).toBe('function');
    }
  });
});
// ABOUTME: Commander-based CLI argument parsing with tool approval flags
// ABOUTME: Handles all CLI flags, validation, and help text generation with fail-early validation

import { Command, Option } from 'commander';
import { ToolExecutor } from '../tools/executor.js';
import { ProviderRegistry } from '../providers/registry.js';

export interface CLIOptions {
  provider: string;
  model: string | undefined;
  help: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logFile: string | undefined;
  prompt: string | undefined;
  ui: 'terminal';
  continue?: string | boolean;
  // Tool approval options
  allowNonDestructiveTools: boolean;
  autoApproveTools: string[];
  disableTools: string[];
  disableAllTools: boolean;
  disableToolGuardrails: boolean;
  listTools: boolean;
}

function parseToolList(value: string): string[] {
  if (!value || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

function validateTools(tools: string[], availableTools: string[], flagName: string): void {
  for (const tool of tools) {
    if (!availableTools.includes(tool)) {
      console.error(
        `Error: Unknown tool '${tool}' in ${flagName}. Available tools: ${availableTools.join(', ')}`
      );
      process.exit(1);
    }
  }
}

function validateFlagCombinations(options: CLIOptions): void {
  // Check contradictory combinations
  if (options.disableAllTools && options.autoApproveTools.length > 0) {
    console.error(
      'Error: Cannot auto-approve tools when all tools are disabled (--disable-all-tools conflicts with --auto-approve-tools)'
    );
    process.exit(1);
  }

  if (options.disableAllTools && options.allowNonDestructiveTools) {
    console.error(
      'Error: Cannot allow tools when all tools are disabled (--disable-all-tools conflicts with --allow-non-destructive-tools)'
    );
    process.exit(1);
  }

  if (options.disableToolGuardrails && options.disableAllTools) {
    console.error(
      'Error: Cannot disable guardrails and all tools simultaneously (--disable-tool-guardrails conflicts with --disable-all-tools)'
    );
    process.exit(1);
  }

  // Check for auto-approving disabled tools
  const disabledTools = new Set(options.disableTools);
  for (const tool of options.autoApproveTools) {
    if (disabledTools.has(tool)) {
      console.error(
        `Error: Cannot auto-approve disabled tool '${tool}' (--disable-tools conflicts with --auto-approve-tools)`
      );
      process.exit(1);
    }
  }
}

function listToolsAndExit(toolExecutor: ToolExecutor): void {
  console.log('Available tools:');

  const tools = toolExecutor.getAllTools();

  for (const tool of tools) {
    // Extract first sentence from description
    const firstSentence =
      tool.description.split('.')[0] + (tool.description.includes('.') ? '' : '');

    // Determine safety classification
    const isReadOnly = tool.annotations?.readOnlyHint === true;
    const isDestructive = tool.annotations?.destructiveHint === true;
    let safetyTag = '';

    if (isReadOnly) {
      safetyTag = ' (read-only)';
    } else if (isDestructive) {
      safetyTag = ' (destructive)';
    }

    console.log(`  ${tool.name} - ${firstSentence}${safetyTag}`);
  }

  process.exit(0);
}

export async function parseArgs(args: string[] = process.argv.slice(2)): Promise<CLIOptions> {
  const program = new Command();

  program
    .name('lace')
    .description('Lace AI Coding Assistant')
    .version('1.0.0')
    .exitOverride() // Prevent Commander from calling process.exit directly
    .helpOption(false) // Disable automatic help handling
    .option('-h, --help', 'display help for command', false)
    .option('-p, --provider <name>', 'Choose AI provider (use --help for full list)', 'anthropic')
    .option('-m, --model <name>', 'Override the default model for the selected provider')
    .option(
      '--log-level <level>',
      'Set log level: "error", "warn", "info" (default), or "debug"',
      'info'
    )
    .option('--log-file <path>', 'Write logs to file (no file = no logging)')
    .option('--prompt <text>', 'Send a single prompt and exit (non-interactive mode)')
    .option('--continue [session_id]', 'Continue previous conversation (latest if no ID provided)')
    .addOption(
      new Option('--ui <type>', 'Choose UI type').choices(['terminal']).default('terminal')
    )
    // Tool approval flags
    .option(
      '--allow-non-destructive-tools',
      'Automatically approve tools marked as read-only',
      false
    )
    .option(
      '--auto-approve-tools <tools...>',
      'Automatically approve specific tools (comma-separated, additive)'
    )
    .option(
      '--disable-tools <tools...>',
      'Disable specific tools entirely (comma-separated, additive)'
    )
    .option('--disable-all-tools', 'Disable all tool calling', false)
    .option(
      '--disable-tool-guardrails',
      'Auto-approve all tools (DANGEROUS: tools may erase data)',
      false
    )
    .option('--list-tools', 'Show available tools and their descriptions', false);

  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    // Commander throws CommanderError for unknown options when exitOverride is used
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }

  const options = program.opts();

  // Validate log level
  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(options.logLevel)) {
    console.error('Error: --log-level must be "error", "warn", "info", or "debug"');
    process.exit(1);
  }

  // Process tool arrays - handle comma-separated values and flatten
  const processToolArray = (tools: string | string[] | undefined): string[] => {
    if (!tools) return [];
    if (typeof tools === 'string') {
      return parseToolList(tools);
    }
    if (Array.isArray(tools)) {
      return tools.flatMap((tool) => parseToolList(tool));
    }
    return [];
  };

  const finalAutoApproveTools = processToolArray(options.autoApproveTools);
  const finalDisableTools = processToolArray(options.disableTools);

  // Create temporary ToolExecutor for validation and --list-tools
  const tempExecutor = new ToolExecutor();
  tempExecutor.registerAllAvailableTools();
  const availableTools = tempExecutor.getAvailableToolNames();

  // Validate tools
  if (finalAutoApproveTools.length > 0) {
    validateTools(finalAutoApproveTools, availableTools, '--auto-approve-tools');
  }
  if (finalDisableTools.length > 0) {
    validateTools(finalDisableTools, availableTools, '--disable-tools');
  }

  const result: CLIOptions = {
    provider: options.provider,
    model: options.model,
    help: options.help || false,
    logLevel: options.logLevel,
    logFile: options.logFile,
    prompt: options.prompt,
    ui: options.ui,
    continue: options.continue,
    allowNonDestructiveTools: options.allowNonDestructiveTools || false,
    autoApproveTools: finalAutoApproveTools,
    disableTools: finalDisableTools,
    disableAllTools: options.disableAllTools || false,
    disableToolGuardrails: options.disableToolGuardrails || false,
    listTools: options.listTools || false,
  };

  // Handle --help (exits after showing help)
  if (result.help) {
    await showHelp();
    process.exit(0);
  }

  // Validate flag combinations
  validateFlagCombinations(result);

  // Handle --list-tools (exits after listing)
  if (result.listTools) {
    listToolsAndExit(tempExecutor);
  }

  return result;
}

async function getProviderHelpText(): Promise<string> {
  const registry = await ProviderRegistry.createWithAutoDiscovery();
  const providers = registry.getProviderNames().sort();

  return `Choose AI provider: ${providers.join(', ')}`;
}

export function validateProvider(provider: string, registry: ProviderRegistry): void {
  const availableProviders = registry.getProviderNames();
  if (!availableProviders.includes(provider)) {
    console.error(
      `Error: Unknown provider '${provider}'. Available providers: ${availableProviders.join(', ')}`
    );
    process.exit(1);
  }
}

export async function showHelp(): Promise<void> {
  const providerHelpText = await getProviderHelpText();

  // Commander generates help automatically, just trigger it
  const program = new Command();

  program
    .name('lace')
    .description('Lace AI Coding Assistant')
    .option('-p, --provider <name>', providerHelpText, 'anthropic')
    .option('-m, --model <name>', 'Override the default model for the selected provider')
    .option(
      '--log-level <level>',
      'Set log level: "error", "warn", "info" (default), or "debug"',
      'info'
    )
    .option('--log-file <path>', 'Write logs to file (no file = no logging)')
    .option('--prompt <text>', 'Send a single prompt and exit (non-interactive mode)')
    .option('--continue [session_id]', 'Continue previous conversation (latest if no ID provided)')
    .addOption(
      new Option('--ui <type>', 'Choose UI type').choices(['terminal']).default('terminal')
    )
    // Tool approval flags
    .option('--allow-non-destructive-tools', 'Automatically approve tools marked as read-only')
    .option(
      '--auto-approve-tools <tools...>',
      'Automatically approve specific tools (comma-separated, additive)'
    )
    .option(
      '--disable-tools <tools...>',
      'Disable specific tools entirely (comma-separated, additive)'
    )
    .option('--disable-all-tools', 'Disable all tool calling')
    .option('--disable-tool-guardrails', 'Auto-approve all tools (DANGEROUS: tools may erase data)')
    .option('--list-tools', 'Show available tools and their descriptions');

  program.outputHelp();
}

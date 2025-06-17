// ABOUTME: Command line argument parsing for Lace CLI
// ABOUTME: Handles all CLI flags, validation, and help text generation

export interface CLIOptions {
  provider: 'anthropic' | 'openai' | 'lmstudio' | 'ollama';
  model: string | undefined;
  help: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logFile: string | undefined;
  prompt: string | undefined;
}

export function parseArgs(args: string[] = process.argv.slice(2)): CLIOptions {
  const options: CLIOptions = {
    provider: 'anthropic',
    model: undefined,
    help: false,
    logLevel: 'info',
    logFile: undefined,
    prompt: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--provider' || arg === '-p') {
      const providerValue = args[i + 1];
      if (
        !providerValue ||
        !['anthropic', 'openai', 'lmstudio', 'ollama'].includes(providerValue)
      ) {
        console.error('Error: --provider must be "anthropic", "openai", "lmstudio", or "ollama"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'openai' | 'lmstudio' | 'ollama';
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--provider=')) {
      const providerValue = arg.split('=')[1];
      if (!['anthropic', 'openai', 'lmstudio', 'ollama'].includes(providerValue)) {
        console.error('Error: --provider must be "anthropic", "openai", "lmstudio", or "ollama"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'openai' | 'lmstudio' | 'ollama';
    } else if (arg === '--model' || arg === '-m') {
      const modelValue = args[i + 1];
      if (!modelValue) {
        console.error('Error: --model requires a model name');
        process.exit(1);
      }
      options.model = modelValue;
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--model=')) {
      const modelValue = arg.split('=')[1];
      if (!modelValue) {
        console.error('Error: --model requires a model name');
        process.exit(1);
      }
      options.model = modelValue;
    } else if (arg === '--log-level') {
      const levelValue = args[i + 1];
      if (!levelValue || !['error', 'warn', 'info', 'debug'].includes(levelValue)) {
        console.error('Error: --log-level must be "error", "warn", "info", or "debug"');
        process.exit(1);
      }
      options.logLevel = levelValue as 'error' | 'warn' | 'info' | 'debug';
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--log-level=')) {
      const levelValue = arg.split('=')[1];
      if (!['error', 'warn', 'info', 'debug'].includes(levelValue)) {
        console.error('Error: --log-level must be "error", "warn", "info", or "debug"');
        process.exit(1);
      }
      options.logLevel = levelValue as 'error' | 'warn' | 'info' | 'debug';
    } else if (arg === '--log-file') {
      const fileValue = args[i + 1];
      if (!fileValue) {
        console.error('Error: --log-file requires a file path');
        process.exit(1);
      }
      options.logFile = fileValue;
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--log-file=')) {
      const fileValue = arg.split('=')[1];
      if (!fileValue) {
        console.error('Error: --log-file requires a file path');
        process.exit(1);
      }
      options.logFile = fileValue;
    } else if (arg === '--prompt') {
      const promptValue = args[i + 1];
      if (!promptValue) {
        console.error('Error: --prompt requires a prompt text');
        process.exit(1);
      }
      options.prompt = promptValue;
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--prompt=')) {
      const promptValue = arg.split('=')[1];
      if (!promptValue) {
        console.error('Error: --prompt requires a prompt text');
        process.exit(1);
      }
      options.prompt = promptValue;
    } else if (arg === '--continue') {
      // --continue is handled by startSession(), just allow it to pass through
    } else if (arg.startsWith('lace_')) {
      // Thread ID arguments are handled by startSession(), just allow them to pass through
    } else {
      console.error(`Error: Unknown argument "${arg}"`);
      process.exit(1);
    }
  }

  return options;
}

export function showHelp(): void {
  console.log(`
Lace AI Coding Assistant

Usage: lace [options]

Options:
  -h, --help                Show this help message
  -p, --provider <name>     Choose AI provider: "anthropic" (default), "openai", "lmstudio", or "ollama"
  -m, --model <name>        Override the default model for the selected provider
  --log-level <level>       Set log level: "error", "warn", "info" (default), or "debug"
  --log-file <path>         Write logs to file (no file = no logging)
  --prompt <text>           Send a single prompt and exit (non-interactive mode)
  --continue [session_id]   Continue previous conversation (latest if no ID provided)

Examples:
  lace                      # Use Anthropic Claude (default)
  lace --provider anthropic # Use Anthropic Claude explicitly
  lace --provider openai    # Use OpenAI GPT models
  lace --provider lmstudio  # Use local LMStudio server
  lace --provider ollama    # Use local Ollama server
  lace --model claude-haiku-3-20241022  # Use specific Anthropic model
  lace --provider openai --model gpt-4o  # Use specific OpenAI model
  lace --provider lmstudio --model mistralai/devstral-small-2505  # Use specific LMStudio model
  lace --log-level debug --log-file debug.log  # Debug logging to file
  lace --prompt "What files are in the current directory?"  # Single command
  lace --continue           # Continue latest conversation
  lace --continue lace_20250615_abc123  # Continue specific conversation
  lace --continue --prompt "What number was that again?"  # Continue with new prompt

Environment Variables:
  ANTHROPIC_KEY            Required for Anthropic provider
  OPENAI_API_KEY           Required for OpenAI provider (or OPENAI_KEY)
`);
}

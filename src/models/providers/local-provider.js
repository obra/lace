// ABOUTME: Local model provider for on-premise deployments
// ABOUTME: Will support DeepSeek and other local models via Ollama or direct API

export class LocalProvider {
  constructor(config = {}) {
    this.config = config;
    // TODO: Implement local provider (Ollama, etc.)
  }

  async initialize() {
    throw new Error('Local provider not yet implemented');
  }

  async chat(messages, options = {}) {
    throw new Error('Local provider not yet implemented');
  }

  getInfo() {
    return {
      name: 'local',
      models: [
        'deepseek-v3',
        'llama-3.3',
        'qwen-2.5'
      ],
      capabilities: [
        'chat',
        'local_inference',
        'privacy'
      ]
    };
  }
}
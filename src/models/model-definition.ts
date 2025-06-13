// ABOUTME: Model definition interfaces providing static metadata for AI models
// ABOUTME: Includes capabilities, pricing, and context window information

export interface ModelDefinition {
  name: string;
  provider: string;
  contextWindow: number;
  inputPrice: number;        // per million tokens
  outputPrice: number;       // per million tokens
  capabilities: string[];
}
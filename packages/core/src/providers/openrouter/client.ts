// ABOUTME: OpenRouter API client for fetching model catalogs
// ABOUTME: Handles authentication, request formatting, and response validation

import { OpenRouterResponse, OpenRouterResponseSchema } from './types';

export class OpenRouterClient {
  private baseUrl = 'https://openrouter.ai/api/v1';

  async fetchModels(apiKey?: string): Promise<OpenRouterResponse> {
    const headers: HeadersInit = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/models`, { headers });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    return OpenRouterResponseSchema.parse(data);
  }
}

// ABOUTME: Anthropic API client for fetching model catalogs
// ABOUTME: Handles authentication, pagination, and response validation

import { AnthropicModel, AnthropicModelsResponse, AnthropicModelsResponseSchema } from './types';

export class AnthropicClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://api.anthropic.com/v1';
  }

  async fetchModels(apiKey: string, afterId?: string): Promise<AnthropicModelsResponse> {
    const url = new URL(`${this.baseUrl}/models`);
    if (afterId) {
      url.searchParams.set('after_id', afterId);
    }

    const headers: HeadersInit = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${text}`);
    }

    const data = (await response.json()) as unknown;
    return AnthropicModelsResponseSchema.parse(data);
  }

  async fetchAllModels(apiKey: string): Promise<AnthropicModel[]> {
    const allModels: AnthropicModel[] = [];
    let afterId: string | undefined;

    // Use max limit (1000) for efficient fetching
    const url = new URL(`${this.baseUrl}/models`);
    url.searchParams.set('limit', '1000');

    for (;;) {
      if (afterId) {
        url.searchParams.set('after_id', afterId);
      }

      const headers: HeadersInit = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };

      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${text}`);
      }

      const data = (await response.json()) as unknown;
      const parsed = AnthropicModelsResponseSchema.parse(data);

      allModels.push(...parsed.data);

      if (!parsed.has_more || !parsed.last_id) {
        break;
      }

      afterId = parsed.last_id;
    }

    return allModels;
  }
}

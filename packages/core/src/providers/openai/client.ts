// ABOUTME: OpenAI API client for fetching model catalogs
// ABOUTME: Handles authentication, request formatting, and response validation

import { OpenAIResponse, OpenAIResponseSchema } from './types';

export class OpenAIClient {
  private baseUrl = 'https://api.openai.com/v1';

  async fetchModels(apiKey: string): Promise<OpenAIResponse> {
    const headers: HeadersInit = {
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await fetch(`${this.baseUrl}/models`, { headers });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as unknown;
    return OpenAIResponseSchema.parse(data);
  }
}

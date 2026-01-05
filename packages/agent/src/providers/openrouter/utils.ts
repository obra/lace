// ABOUTME: Utility functions for OpenRouter model processing
// ABOUTME: Provider extraction, pricing conversion, and capability checking

export function extractProvider(modelId: string): string {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts[0] : 'unknown';
}

export function convertPricing(priceString: string): number {
  return parseFloat(priceString) * 1000000;
}

export function hasCapability(supportedParams: string[] | undefined, capability: string): boolean {
  return supportedParams?.includes(capability) ?? false;
}

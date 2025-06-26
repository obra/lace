// ABOUTME: Simple provider availability checking for local server providers
// ABOUTME: Call once in beforeAll to skip tests if local providers unavailable

/**
 * Skip test suite if a local provider (LMStudio, Ollama) is unavailable.
 * Call this in beforeAll() to automatically skip tests when the provider
 * server is not running or has no models loaded.
 *
 * @param providerName - Human-readable provider name for logging
 * @param provider - Provider instance with diagnose() method
 */
export async function skipIfProviderIsUnavailable(
  providerName: string,
  provider: { diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> }
): Promise<void> {
  try {
    const diagnostics = await provider.diagnose();
    if (!diagnostics.connected || diagnostics.models.length === 0) {
      console.log(`Skipping ${providerName} tests - ${diagnostics.error || 'not available'}`);
      return;
    }
  } catch (error) {
    console.log(`Skipping ${providerName} tests - ${error}`);
    return;
  }
}

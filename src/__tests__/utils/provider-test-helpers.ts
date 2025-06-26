// ABOUTME: Simple provider availability checking for local server providers
// ABOUTME: Returns availability status for conditional test execution

/**
 * Check if a local provider (LMStudio, Ollama) is available.
 * Use the return value to conditionally run tests.
 *
 * @param providerName - Human-readable provider name for logging
 * @param provider - Provider instance with diagnose() method
 * @returns Promise<boolean> - true if provider is available, false otherwise
 */
export async function checkProviderAvailability(
  providerName: string,
  provider: { diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> }
): Promise<boolean> {
  try {
    const diagnostics = await provider.diagnose();
    if (!diagnostics.connected || diagnostics.models.length === 0) {
      console.log(`Skipping ${providerName} tests - ${diagnostics.error || 'not available'}`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`Skipping ${providerName} tests - ${error}`);
    return false;
  }
}

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
/**
 * Whether an integration suite can run against a live local provider.
 *
 * `requiredModel` is the model the suite actually calls. Without it the gate
 * only asks "is the server up with any model at all?", so a machine holding a
 * different model passes the gate and then fails every test on
 * `Model "x" is not available`. An integration test whose dependency is missing
 * must skip, not fail — a red suite that really means "you didn't pull a 32b
 * model" trains people to ignore red.
 */
export async function checkProviderAvailability(
  providerName: string,
  provider: { diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> },
  requiredModel?: string
): Promise<boolean> {
  try {
    // Add timeout to prevent hanging (give extra time for provider's own timeout)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Provider check timeout')), 4000);
    });

    const diagnostics = await Promise.race([provider.diagnose(), timeoutPromise]);
    if (!diagnostics.connected || diagnostics.models.length === 0) {
      // Silently skip unavailable providers to reduce test noise
      // Original message: `Skipping ${providerName} tests - ${diagnostics.error || 'not available'}`
      return false;
    }
    if (requiredModel && !diagnostics.models.includes(requiredModel)) {
      // Server is up but holds different models — skip rather than fail.
      return false;
    }
    return true;
  } catch (_error) {
    // Silently skip unavailable providers to reduce test noise
    // Original message: `Skipping ${providerName} tests - ${String(_error)}`
    return false;
  }
}

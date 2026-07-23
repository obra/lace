// ABOUTME: Integration test against a real AWS Bedrock endpoint
// ABOUTME: Skipped by default — run with LACE_INTEGRATION_BEDROCK=1 plus working AWS creds
//
// Requirements to run:
//   1. AWS credentials configured (env vars or ~/.aws/credentials) with bedrock:InvokeModel
//      permission for the model below in the configured region.
//   2. The model must be enabled in your AWS Bedrock console for the region.
//   3. LACE_INTEGRATION_BEDROCK=1 in the environment.
//
// Example:
//   AWS_REGION=us-west-2 \
//     LACE_INTEGRATION_BEDROCK=1 \
//     npx vitest run packages/agent/src/providers/bedrock-integration.test.ts

import { describe, it, expect } from 'vitest';
import { BedrockProvider } from './bedrock-provider';

const enabled = process.env.LACE_INTEGRATION_BEDROCK === '1';
// Bedrock Mantle is currently served in us-east-1 for account 526275945504
// (us-west-2 is a partial/broken deployment; us-east-2 returns 404). Bare
// provider-prefixed model IDs only — no version suffix, no us./global profile.
const region = process.env.AWS_REGION ?? 'us-east-1';
const model = process.env.LACE_BEDROCK_TEST_MODEL ?? 'anthropic.claude-haiku-4-5';

const describeIf = enabled ? describe : describe.skip;

describeIf('BedrockProvider live integration', () => {
  it('completes a short request against real Bedrock', async () => {
    const provider = new BedrockProvider({ awsRegion: region });
    provider.setSystemPrompt('You are a terse assistant. Reply with a single short sentence.');

    const response = await provider.createResponse(
      [{ role: 'user', content: 'Say hello in five words or fewer.' }],
      [],
      model
    );

    expect(response.content.length).toBeGreaterThan(0);
    expect(response.stopReason).toBe('end_turn');
  }, 30_000);
});

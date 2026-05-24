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
const region = process.env.AWS_REGION ?? 'us-west-2';
const model = process.env.LACE_BEDROCK_TEST_MODEL ?? 'anthropic.claude-3-5-haiku-20241022-v1:0';

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

import { test, expect } from './mocks/setup';

test('MSW intercepts external API calls', async ({ page, worker }) => {
  // Navigate to a page that would make an API call
  await page.goto('/');
  
  // Make a direct API call from the browser to verify interception
  const response = await page.evaluate(async () => {
    const result = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'test' }]
      })
    });
    return result.json();
  });

  expect(response).toHaveProperty('id', 'msg_test123');
  expect(response.content[0].text).toContain('test response from the mocked Anthropic API');
});
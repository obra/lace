// ABOUTME: Page object for chat interface interactions
// ABOUTME: Handles message sending, receiving, and chat controls

import { Page, Locator } from '@playwright/test';

export class ChatInterface {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Locators
  get messageInput(): Locator {
    return this.page
      .locator('textarea[placeholder*="Message"]')
      .or(this.page.locator('input[placeholder*="message"]'))
      .or(this.page.locator('[data-testid="message-input"]'))
      .or(this.page.locator('[data-testid="enhanced-message-input"]'))
      .first();
  }

  get sendButton(): Locator {
    return this.page.getByTestId('send-button');
  }

  get stopButton(): Locator {
    return this.page.getByTestId('stop-button');
  }

  get thinkingIndicator(): Locator {
    return this.page.getByTestId('thinking-indicator');
  }

  // Actions
  async typeMessage(message: string): Promise<void> {
    await this.messageInput.fill(message);
  }

  async clickSend(): Promise<void> {
    await this.sendButton.click();
  }

  async sendMessage(message: string): Promise<void> {
    await this.typeMessage(message);
    await this.clickSend();
  }

  async clickStop(): Promise<void> {
    await this.stopButton.click();
  }

  async pressEscapeToStop(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  // Get message content (for verification by tests)
  getMessage(messageText: string): Locator {
    return this.page.getByText(messageText);
  }

  // Wait for interface to be ready (session creation may take a moment)
  async waitForChatReady(): Promise<void> {
    await this.messageInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  // Wait for send button to be available (not disabled)
  async waitForSendAvailable(): Promise<void> {
    await this.sendButton.waitFor({ state: 'visible' });
    // Additional wait for enabled state if needed
  }

  // Wait for stop button to appear (during processing)
  async waitForStopButton(): Promise<void> {
    await this.stopButton.waitFor({ state: 'visible' });
  }
}

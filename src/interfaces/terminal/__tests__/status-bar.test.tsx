// ABOUTME: Tests for StatusBar component
// ABOUTME: Verifies status information display and token usage formatting

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderInkComponent, stripAnsi } from './helpers/ink-test-utils.js';
import StatusBar from '../components/status-bar.js';
import { UI_SYMBOLS } from '../theme.js';

describe('StatusBar', () => {
  const basicProps = {
    providerName: 'anthropic',
    messageCount: 5,
  };

  it('renders basic provider information', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar {...basicProps} />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.PROVIDER + ' anthropic');
    expect(frame).toContain(UI_SYMBOLS.MESSAGE + ' 5');
  });

  it('shows model name when provided', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        modelName="claude-sonnet-4"
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('anthropic:claude-sonnet-4');
  });

  it('shows full thread ID without truncation', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        threadId="12345678901234567890"
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.FOLDER + ' 12345678901234567890');
  });

  it('shows short thread ID as-is', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        threadId="abc123"
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.FOLDER + ' abc123');
  });

  it('formats cumulative tokens in k format for large numbers', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        cumulativeTokens={{
          totalTokens: 2500,
          promptTokens: 1000,
          completionTokens: 1500,
        }}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.TOKEN_IN}1.0k ${UI_SYMBOLS.TOKEN_OUT}1.5k`);
  });

  it('formats cumulative tokens as exact numbers for small numbers', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        cumulativeTokens={{
          totalTokens: 250,
          promptTokens: 100,
          completionTokens: 150,
        }}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.TOKEN_IN}100 ${UI_SYMBOLS.TOKEN_OUT}150`);
  });

  it('shows 0 tokens when no cumulative tokens provided', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar {...basicProps} />
    );

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.TOKEN_IN}0 ${UI_SYMBOLS.TOKEN_OUT}0`);
  });

  it('shows processing status when isProcessing is true', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        isProcessing={true}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.LIGHTNING + ' Processing');
  });

  it('shows ready status when not processing', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar 
        {...basicProps}
        isProcessing={false}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.READY + ' Ready');
  });

  it('handles missing thread ID gracefully', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar {...basicProps} />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.FOLDER + ' no-thread');
  });
});
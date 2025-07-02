// ABOUTME: Tests for StatusBar component
// ABOUTME: Verifies status information display and token usage formatting

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderInkComponent, stripAnsi } from './helpers/ink-test-utils.js';
import StatusBar from '../components/status-bar.js';
import { UI_SYMBOLS } from '../theme.js';
import type { ProjectContext } from '../hooks/use-project-context.js';

describe('StatusBar', () => {
  const basicProps = {
    providerName: 'anthropic',
    messageCount: 5,
  };

  it('renders basic provider information', () => {
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} />);

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.PROVIDER + ' anthropic');
    expect(frame).toContain(UI_SYMBOLS.MESSAGE + ' 5');
  });

  it('shows model name when provided', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar {...basicProps} modelName="claude-sonnet-4" />
    );

    const frame = lastFrame();
    expect(frame).toContain('anthropic:claude-sonnet-4');
  });

  it('shows full thread ID without truncation', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar {...basicProps} threadId="12345678901234567890" />
    );

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.FOLDER + ' 12345678901234567890');
  });

  it('shows short thread ID as-is', () => {
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} threadId="abc123" />);

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
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} />);

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.TOKEN_IN}0 ${UI_SYMBOLS.TOKEN_OUT}0`);
  });

  it('shows processing status when isProcessing is true', () => {
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} isProcessing={true} />);

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.LIGHTNING + ' Processing');
  });

  it('shows ready status when not processing', () => {
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} isProcessing={false} />);

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.READY + ' Ready');
  });

  it('handles missing thread ID gracefully', () => {
    const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} />);

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.FOLDER + ' no-thread');
  });

  describe('project context (double status bar)', () => {
    const projectContext: ProjectContext = {
      cwd: '/Users/testuser/project',
      displayPath: '~/project',
      isGitRepo: true,
      gitStatus: {
        branch: 'main',
        modified: 2,
        deleted: 1,
        untracked: 3,
        staged: 1
      }
    };

    it('renders two rows when project context is provided', () => {
      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={projectContext} />
      );

      const frame = lastFrame();
      
      // Should contain original status bar content
      expect(frame).toContain(UI_SYMBOLS.PROVIDER + ' anthropic');
      
      // Should contain project context row
      expect(frame).toContain('~/project');
      expect(frame).toContain(UI_SYMBOLS.GIT_BRANCH + ' main');
    });

    it('displays git status counts correctly', () => {
      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={projectContext} />
      );

      const frame = lastFrame();
      
      // Should show counts for non-zero values
      expect(frame).toContain(`2${UI_SYMBOLS.GIT_MODIFIED}`); // 2 modified
      expect(frame).toContain(`1${UI_SYMBOLS.GIT_DELETED}`);  // 1 deleted
      expect(frame).toContain(`3${UI_SYMBOLS.GIT_UNTRACKED}`); // 3 untracked
      expect(frame).toContain(`1${UI_SYMBOLS.GIT_STAGED}`);   // 1 staged
    });

    it('only shows non-zero git status counts', () => {
      const cleanContext: ProjectContext = {
        cwd: '/Users/testuser/project',
        displayPath: '~/project',
        isGitRepo: true,
        gitStatus: {
          branch: 'main',
          modified: 0,
          deleted: 0,
          untracked: 1,
          staged: 0
        }
      };

      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={cleanContext} />
      );

      const frame = lastFrame();
      
      // Should only show untracked count
      expect(frame).toContain(`1${UI_SYMBOLS.GIT_UNTRACKED}`);
      
      // Should not show zero counts
      expect(frame).not.toContain(`0${UI_SYMBOLS.GIT_MODIFIED}`);
      expect(frame).not.toContain(`0${UI_SYMBOLS.GIT_DELETED}`);
      expect(frame).not.toContain(`0${UI_SYMBOLS.GIT_STAGED}`);
    });

    it('handles non-git directories', () => {
      const nonGitContext: ProjectContext = {
        cwd: '/Users/testuser/project',
        displayPath: '~/project',
        isGitRepo: false
      };

      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={nonGitContext} />
      );

      const frame = lastFrame();
      
      // Should show path but no git info
      expect(frame).toContain('~/project');
      expect(frame).not.toContain(UI_SYMBOLS.GIT_BRANCH);
    });

    it('handles git errors', () => {
      const errorContext: ProjectContext = {
        cwd: '/Users/testuser/project',
        displayPath: '~/project',
        isGitRepo: false,
        error: 'Not a git repository'
      };

      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={errorContext} />
      );

      const frame = lastFrame();
      
      // Should show path and error indicator
      expect(frame).toContain('~/project');
      expect(frame).toContain(UI_SYMBOLS.GIT_ERROR);
    });

    it('handles detached HEAD state', () => {
      const detachedContext: ProjectContext = {
        cwd: '/Users/testuser/project',
        displayPath: '~/project',
        isGitRepo: true,
        gitStatus: {
          // No branch property (detached HEAD)
          modified: 0,
          deleted: 0,
          untracked: 0,
          staged: 0
        }
      };

      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={detachedContext} />
      );

      const frame = lastFrame();
      
      // Should show path without branch info
      expect(frame).toContain('~/project');
      expect(frame).not.toContain(UI_SYMBOLS.GIT_BRANCH);
    });

    it('works without project context (backward compatibility)', () => {
      const { lastFrame } = renderInkComponent(<StatusBar {...basicProps} />);

      const frame = lastFrame();
      
      // Should render normally without project context
      expect(frame).toContain(UI_SYMBOLS.PROVIDER + ' anthropic');
      expect(frame).toContain(UI_SYMBOLS.MESSAGE + ' 5');
      
      // Should not contain project context elements
      expect(frame).not.toContain(UI_SYMBOLS.GIT_BRANCH);
    });

    it('floats git status to the right side', () => {
      const { lastFrame } = renderInkComponent(
        <StatusBar {...basicProps} projectContext={projectContext} />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      
      // Path should appear on the left
      const pathIndex = frame!.indexOf('~/project');
      expect(pathIndex).toBeGreaterThan(0);
      
      // Git branch should appear on the right (after the path)
      const branchIndex = frame!.indexOf(UI_SYMBOLS.GIT_BRANCH + ' main');
      expect(branchIndex).toBeGreaterThan(pathIndex);
      
      // Git status counts should be on the right side
      const modifiedIndex = frame!.indexOf(`2${UI_SYMBOLS.GIT_MODIFIED}`);
      expect(modifiedIndex).toBeGreaterThan(branchIndex);
    });
  });
});

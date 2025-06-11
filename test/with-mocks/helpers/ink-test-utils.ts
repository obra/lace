// ABOUTME: Custom Ink testing utilities that extend ink-testing-library with missing methods
// ABOUTME: Fixes stdin.ref() and other missing stream methods for proper Ink component testing

import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';

class EnhancedStdin extends EventEmitter {
  public isTTY = true;

  public write(data: string) {
    this.emit('data', data);
  }

  public setEncoding() {
    // Do nothing - mock implementation
  }

  public setRawMode() {
    // Do nothing - mock implementation  
  }

  public resume() {
    // Do nothing - mock implementation
  }

  public pause() {
    // Do nothing - mock implementation
  }

  // Missing methods that Ink's App component needs
  public ref() {
    // Do nothing - mock implementation
  }

  public unref() {
    // Do nothing - mock implementation
  }

  public read() {
    // Return null to indicate no data available
    return null;
  }
}

class EnhancedStdout extends EventEmitter {
  public frames: string[] = [];
  private _lastFrame: string | undefined;

  public columns = 100;

  public write = (frame: string) => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };

  public lastFrame = () => this._lastFrame;
}

class EnhancedStderr extends EventEmitter {
  public frames: string[] = [];
  private _lastFrame: string | undefined;

  public write = (frame: string) => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };

  public lastFrame = () => this._lastFrame;
}

interface RenderResult {
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
  cleanup: () => void;
  stdout: EnhancedStdout;
  stderr: EnhancedStderr;
  stdin: EnhancedStdin;
  frames: string[];
  lastFrame: () => string | undefined;
}

export function renderInkComponent(tree: React.ReactElement): RenderResult {
  const stdout = new EnhancedStdout();
  const stderr = new EnhancedStderr();
  const stdin = new EnhancedStdin();

  const instance = inkRender(tree, {
    stdout: stdout as any,
    stderr: stderr as any,
    stdin: stdin as any,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false
  });

  return {
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
    stdout,
    stderr,
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame
  };
}
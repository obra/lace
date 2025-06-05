// ABOUTME: Entry point for the Ink-based terminal UI for Lace
// ABOUTME: Renders the main App component and handles process lifecycle

import React from 'react';
import { render } from 'ink';
import App from './App';

// Render the Ink app
const app = render(<App />);
const unmount = app.unmount || (() => {});

// Handle graceful shutdown
process.on('SIGINT', () => {
  unmount();
  process.exit(0);
});

process.on('SIGTERM', () => {
  unmount();
  process.exit(0);
});
// ABOUTME: Entry point for the Ink-based terminal UI for Lace
// ABOUTME: Renders the main App component and handles process lifecycle

import React from "react";
import { render } from "ink";
import App from "./App";

// Render the Ink app
const app = render(<App />);
const unmount = app.unmount || (() => {});

// For Step 3 demo: keep alive for 10 seconds to allow manual testing
// This will be replaced with real input handling in Step 5
setTimeout(() => {
  console.log(
    "\nStep 3 demo complete. Press Ctrl+C to exit or wait for auto-exit...",
  );
  setTimeout(() => {
    unmount();
    process.exit(0);
  }, 5000);
}, 10000);

// Handle graceful shutdown
process.on("SIGINT", () => {
  unmount();
  process.exit(0);
});

process.on("SIGTERM", () => {
  unmount();
  process.exit(0);
});

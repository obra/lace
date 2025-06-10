// ABOUTME: Mock implementation of Ink components for testing
// ABOUTME: Allows testing component logic without actual terminal rendering

import React from "react";

const Box = React.forwardRef(({ children, ...props }, ref) => {
  return React.createElement(
    "box",
    { "data-testid": "box", ref, ...props },
    children,
  );
});

const Text = React.forwardRef(({ children, color, bold, ...props }, ref) => {
  return React.createElement(
    "text",
    {
      "data-testid": "text",
      ref,
      color,
      bold,
      ...props,
    },
    children,
  );
});

const render = (element) => {
  return {
    unmount: jest.fn(),
  };
};

export { Box, Text, render };

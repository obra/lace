// ABOUTME: Simple layout component for main application structure
// ABOUTME: Provides consistent flexbox layout with column direction

import React from "react";
import { Box } from "ink";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
};

export default AppLayout;
// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Renders the basic "Hello Lace" greeting and exits after 2 seconds

import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';

const App: React.FC = () => {
  const [shouldExit, setShouldExit] = useState<boolean>(false);

  useEffect(() => {
    // Auto-exit after 2 seconds for Step 1 demo
    const timer = setTimeout(() => {
      setShouldExit(true);
      process.exit(0);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        Hello Lace
      </Text>
      <Text color="dim">
        Ink terminal UI starting up...
      </Text>
    </Box>
  );
};

export default App;
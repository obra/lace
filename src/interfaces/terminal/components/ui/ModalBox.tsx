// ABOUTME: Modal box component that creates an opaque background for overlays
// ABOUTME: Uses a full-size Text component with background color to create modal backdrop

import React, { ReactNode } from 'react';
import { Box, Text } from 'ink';

interface ModalBoxProps {
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  backgroundColor?: string;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic';
  borderColor?: string;
  paddingX?: number;
  paddingY?: number;
  marginX?: number;
  marginY?: number;
  position?: 'absolute' | 'relative';
}

/**
 * A modal box component that creates an opaque background by filling the box
 * with a background-colored Text component, then rendering content on top.
 * 
 * This solves the problem that Ink's Box doesn't support backgroundColor,
 * but Text does. We create a "canvas" of background-colored spaces, then
 * position the actual content absolutely on top.
 */
export const ModalBox: React.FC<ModalBoxProps> = ({
  children,
  width = 60,
  height = 12,
  backgroundColor = 'black',
  borderStyle = 'single',
  borderColor = 'yellow',
  paddingX = 2,
  paddingY = 1,
  marginX = 4,
  marginY = 2,
  position = 'absolute',
}) => {
  // Calculate inner dimensions for background fill
  const innerWidth = typeof width === 'number' ? width - 4 : 50; // subtract border + padding
  const innerHeight = typeof height === 'number' ? height - 4 : 8;
  
  // Create background fill lines
  const backgroundText = Array(innerHeight)
    .fill(' '.repeat(innerWidth))
    .join('\n');

  return (
    <Box
      position={position}
      borderStyle={borderStyle}
      borderColor={borderColor}
      width={width}
      height={height}
      marginX={marginX}
      marginY={marginY}
    >
      <Box flexDirection="column" paddingX={paddingX} paddingY={paddingY}>
        {/* Background layer */}
        <Text backgroundColor={backgroundColor} color={backgroundColor}>
          {backgroundText}
        </Text>
        
        {/* Content layer - use negative margin to overlay on background */}
        <Box flexDirection="column" marginTop={-innerHeight}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default ModalBox;
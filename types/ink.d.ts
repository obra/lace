// ABOUTME: Type declarations for Ink 6.0 to help Jest/TypeScript resolution
// ABOUTME: Re-exports the main types that our components need

declare module 'ink' {
  import React from 'react';
  
  export interface BoxProps {
    flexDirection?: 'row' | 'column';
    flexGrow?: number;
    height?: string | number;
    padding?: number;
    borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic';
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    children?: React.ReactNode;
  }
  
  export interface TextProps {
    color?: string;
    bold?: boolean;
    children?: React.ReactNode;
  }
  
  export const Box: React.FC<BoxProps>;
  export const Text: React.FC<TextProps>;
  
  export interface RenderOptions {
    unmount?: () => void;
  }
  
  export function render(element: React.ReactElement): RenderOptions;
}
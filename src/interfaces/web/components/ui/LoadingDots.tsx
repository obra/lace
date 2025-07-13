// ABOUTME: Loading dots component for indicating processing states
// ABOUTME: Animated dots with configurable sizes using DaisyUI classes

import React from 'react';

interface LoadingDotsProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  xs: 'loading-xs',
  sm: 'loading-sm',
  md: 'loading-md',
  lg: 'loading-lg',
};

export default function LoadingDots({ size = 'sm' }: LoadingDotsProps) {
  return <span className={`loading loading-dots ${sizeClasses[size]}`}></span>;
}

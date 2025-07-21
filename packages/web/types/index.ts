// ABOUTME: Main types index for web package
// ABOUTME: Re-exports all type definitions from various modules

// API types
export * from './api';

// Event types  
export * from './events';
export * from './events-constants';

// Design system types imported from f-web-spicy
export type {
  Message,
  StreamEvent,
  ChatState,
  GoogleDocAttachment,
  TimelineEntry,
  CarouselItem,
  Timeline,
  Task,
  RecentFile,
  Theme,
} from './design-system';

// Core project types
export type { ProjectInfo as Project } from '@/lib/server/core-types';
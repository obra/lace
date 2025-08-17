// ABOUTME: Edge runtime Sentry configuration for middleware and edge functions
// ABOUTME: Captures errors in Edge runtime environments with minimal overhead
import * as Sentry from '@sentry/nextjs';
import { SENTRY_CONFIG } from './lib/sentry-config';

Sentry.init({
  ...SENTRY_CONFIG,
});
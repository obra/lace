// ABOUTME: Common schema patterns for tool parameter validation
// ABOUTME: Reusable Zod schemas with consistent error messages

import { z } from 'zod';

export const NonEmptyString = z.string().min(1, 'Cannot be empty');

export const FilePath = z.string().min(1, 'File path cannot be empty');

export const LineNumber = z.number().int('Must be an integer').positive('Must be positive');

export const MaxResults = z.number().int().min(1).max(1000).default(100);

export const FilePattern = z.string().min(1, 'Pattern cannot be empty');

// ABOUTME: Input validation and sanitization utilities for user settings
// ABOUTME: Provides secure validation for email, text inputs with length limits and XSS protection

interface ValidationResult {
  isValid: boolean;
  value: string;
  error?: string;
}

/**
 * Sanitize and validate user name input
 */
export function validateUserName(input: string): ValidationResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { isValid: true, value: '' }; // Allow empty names
  }

  if (trimmed.length > 100) {
    return {
      isValid: false,
      value: trimmed.slice(0, 100),
      error: 'Name must be 100 characters or less',
    };
  }

  // Basic XSS protection - remove HTML tags and script content
  const sanitized = trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/javascript\s*:.*?([A-Z][a-z]+)$/gi, '$1') // Remove javascript: protocol until final name
    .replace(/on\w+\s*=\s*[^>\s]*/gi, ''); // Remove event handlers

  return { isValid: true, value: sanitized };
}

/**
 * Sanitize and validate email input
 */
export function validateEmail(input: string): ValidationResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { isValid: true, value: '' }; // Allow empty email
  }

  if (trimmed.length > 254) {
    return {
      isValid: false,
      value: trimmed.slice(0, 254),
      error: 'Email must be 254 characters or less',
    };
  }

  // Basic email format validation - no consecutive dots, no dots at start/end
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  // Additional validation: no consecutive dots
  if (trimmed.includes('..')) {
    return {
      isValid: false,
      value: trimmed,
      error: 'Please enter a valid email address',
    };
  }
  if (!emailRegex.test(trimmed)) {
    return {
      isValid: false,
      value: trimmed,
      error: 'Please enter a valid email address',
    };
  }

  return { isValid: true, value: trimmed };
}

/**
 * Sanitize and validate bio input
 */
export function validateBio(input: string): ValidationResult {
  const trimmed = input.trim();

  if (trimmed.length > 500) {
    return {
      isValid: false,
      value: trimmed.slice(0, 500),
      error: 'Bio must be 500 characters or less',
    };
  }

  // Basic XSS protection
  const sanitized = trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/javascript\s*:.*?([A-Z][a-z]+)$/gi, '$1') // Remove javascript: protocol until final name
    .replace(/on\w+\s*=\s*[^>\s]*/gi, ''); // Remove event handlers

  return { isValid: true, value: sanitized };
}

/**
 * Sanitize user data for general use
 */
export function sanitizeUserData(userData: {
  userName: string;
  userEmail: string;
  userBio: string;
}) {
  return {
    userName: validateUserName(userData.userName).value,
    userEmail: validateEmail(userData.userEmail).value,
    userBio: validateBio(userData.userBio).value,
  };
}

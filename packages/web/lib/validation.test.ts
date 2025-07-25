// ABOUTME: Tests for input validation and sanitization utilities
// ABOUTME: Ensures proper XSS protection, length limits, and email validation

import { describe, it, expect } from 'vitest';
import { validateUserName, validateEmail, validateBio, sanitizeUserData } from './validation';

describe('validateUserName', () => {
  it('accepts valid names', () => {
    const result = validateUserName('John Doe');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John Doe');
    expect(result.error).toBeUndefined();
  });

  it('allows empty names', () => {
    const result = validateUserName('');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace', () => {
    const result = validateUserName('  John Doe  ');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John Doe');
  });

  it('enforces 100 character limit', () => {
    const longName = 'a'.repeat(101);
    const result = validateUserName(longName);
    expect(result.isValid).toBe(false);
    expect(result.value).toBe('a'.repeat(100));
    expect(result.error).toBe('Name must be 100 characters or less');
  });

  it('removes HTML tags for XSS protection', () => {
    const result = validateUserName('<script>alert("xss")</script>John');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John');
  });

  it('removes javascript: protocol', () => {
    const result = validateUserName('javascript:alert("xss")John');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John');
  });

  it('removes event handlers', () => {
    const result = validateUserName('John onclick=alert("xss")');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John ');
  });
});

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    const result = validateEmail('john@example.com');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('john@example.com');
    expect(result.error).toBeUndefined();
  });

  it('allows empty emails', () => {
    const result = validateEmail('');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace', () => {
    const result = validateEmail('  john@example.com  ');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('john@example.com');
  });

  it('enforces 254 character limit (RFC 5321)', () => {
    const longEmail = 'a'.repeat(250) + '@example.com';
    const result = validateEmail(longEmail);
    expect(result.isValid).toBe(false);
    expect(result.value).toBe(longEmail.slice(0, 254));
    expect(result.error).toBe('Email must be 254 characters or less');
  });

  it('validates email format', () => {
    const invalidEmails = [
      'invalid-email',
      '@example.com',
      'john@',
      'john..doe@example.com',
      'john@example',
    ];

    invalidEmails.forEach((email) => {
      const result = validateEmail(email);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Please enter a valid email address');
    });
  });

  it('accepts various valid email formats', () => {
    const validEmails = [
      'john@example.com',
      'john.doe@example.co.uk',
      'john+tag@example.org',
      'john_doe@example-site.com',
    ];

    validEmails.forEach((email) => {
      const result = validateEmail(email);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(email);
    });
  });
});

describe('validateBio', () => {
  it('accepts valid bios', () => {
    const result = validateBio('This is my bio.');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('This is my bio.');
    expect(result.error).toBeUndefined();
  });

  it('allows empty bios', () => {
    const result = validateBio('');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace', () => {
    const result = validateBio('  This is my bio.  ');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('This is my bio.');
  });

  it('enforces 500 character limit', () => {
    const longBio = 'a'.repeat(501);
    const result = validateBio(longBio);
    expect(result.isValid).toBe(false);
    expect(result.value).toBe('a'.repeat(500));
    expect(result.error).toBe('Bio must be 500 characters or less');
  });

  it('removes HTML tags for XSS protection', () => {
    const result = validateBio('<script>alert("xss")</script>This is my bio.');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('This is my bio.');
  });
});

describe('sanitizeUserData', () => {
  it('sanitizes all user data fields', () => {
    const userData = {
      userName: '  <script>alert("xss")</script>John  ',
      userEmail: '  john@example.com  ',
      userBio: '  <img src="x" onerror="alert(1)">My bio  ',
    };

    const result = sanitizeUserData(userData);

    expect(result.userName).toBe('John');
    expect(result.userEmail).toBe('john@example.com');
    expect(result.userBio).toBe('My bio');
  });

  it('handles empty data', () => {
    const userData = {
      userName: '',
      userEmail: '',
      userBio: '',
    };

    const result = sanitizeUserData(userData);

    expect(result.userName).toBe('');
    expect(result.userEmail).toBe('');
    expect(result.userBio).toBe('');
  });
});

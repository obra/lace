// ABOUTME: Jest-DOM setup for Vitest testing environment
// ABOUTME: Extends Vitest expect with DOM-specific matchers

import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);
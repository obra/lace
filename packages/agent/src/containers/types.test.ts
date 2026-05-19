// ABOUTME: Type-level tests for container type contracts
// ABOUTME: Asserts ExecStreamHandle exposes concrete Writable/Readable streams

import { describe, it, expectTypeOf } from 'vitest';
import type { Writable, Readable } from 'node:stream';
import type { ExecStreamHandle } from './types';

describe('ExecStreamHandle types', () => {
  it('exposes concrete Writable/Readable streams', () => {
    expectTypeOf<ExecStreamHandle['stdin']>().toEqualTypeOf<Writable>();
    expectTypeOf<ExecStreamHandle['stdout']>().toEqualTypeOf<Readable>();
    expectTypeOf<ExecStreamHandle['stderr']>().toEqualTypeOf<Readable>();
  });
});

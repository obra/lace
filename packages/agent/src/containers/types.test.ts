// ABOUTME: Type-level tests for container type contracts
// ABOUTME: Asserts ExecStreamHandle exposes concrete Writable/Readable streams

import { describe, it, expectTypeOf } from 'vitest';
import type { Writable, Readable } from 'node:stream';
import type { DockerCreateConfig, ExecStreamHandle } from './types';

describe('ExecStreamHandle types', () => {
  // eslint-disable-next-line vitest/expect-expect -- expectTypeOf performs compile-time assertions.
  it('exposes concrete Writable/Readable streams', () => {
    expectTypeOf<ExecStreamHandle['stdin']>().toEqualTypeOf<Writable>();
    expectTypeOf<ExecStreamHandle['stdout']>().toEqualTypeOf<Readable>();
    expectTypeOf<ExecStreamHandle['stderr']>().toEqualTypeOf<Readable>();
  });
});

describe('DockerCreateConfig types', () => {
  // eslint-disable-next-line vitest/expect-expect -- expectTypeOf performs compile-time assertions.
  it('does not expose unused resource-limit fields', () => {
    const config = {} as DockerCreateConfig;

    // @ts-expect-error DockerCreateConfig has no memory resource-limit field.
    config.memory;
    // @ts-expect-error DockerCreateConfig has no cpuShares resource-limit field.
    config.cpuShares;
  });
});

// ABOUTME: Factory for creating helper agents with simplified configuration
// ABOUTME: Provides static methods to create InfrastructureHelper and SessionHelper instances

import { InfrastructureHelper } from '~/helpers/infrastructure-helper';
import type { InfrastructureHelperOptions } from '~/helpers/infrastructure-helper';
import { SessionHelper } from '~/helpers/session-helper';
import type { SessionHelperOptions } from '~/helpers/session-helper';

/**
 * Factory for creating helper agents
 * Provides type-safe creation methods with clear APIs
 */
export class HelperFactory {
  /**
   * Create an infrastructure helper for system-level LLM operations
   * Bypasses user approval with explicit tool whitelist
   */
  static createInfrastructureHelper(options: InfrastructureHelperOptions): InfrastructureHelper {
    return new InfrastructureHelper(options);
  }

  /**
   * Create a session helper for agent-spawned LLM operations
   * Inherits context and policies from parent agent
   */
  static createSessionHelper(options: SessionHelperOptions): SessionHelper {
    return new SessionHelper(options);
  }
}

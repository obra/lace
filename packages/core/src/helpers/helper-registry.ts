// ABOUTME: Centralized registry for managing active helper agent instances
// ABOUTME: Tracks helper lifecycle and provides lookup/management functionality

import { InfrastructureHelper, InfrastructureHelperOptions } from './infrastructure-helper';
import { SessionHelper, SessionHelperOptions } from './session-helper';
import { BaseHelper } from './base-helper';

type HelperType = 'infrastructure' | 'session';

interface RegistryEntry {
  helper: BaseHelper;
  type: HelperType;
}

/**
 * Registry for managing active helper instances
 * Provides centralized tracking and lifecycle management
 */
export class HelperRegistry {
  private helpers = new Map<string, RegistryEntry>();

  /**
   * Create an infrastructure helper and register it
   * @param id Unique identifier for this helper instance
   * @param options Configuration for the infrastructure helper
   * @returns The created infrastructure helper
   */
  createInfrastructureHelper(id: string, options: InfrastructureHelperOptions): InfrastructureHelper {
    if (this.helpers.has(id)) {
      throw new Error(`Helper with id "${id}" already exists`);
    }

    const helper = new InfrastructureHelper(options);
    this.helpers.set(id, { helper, type: 'infrastructure' });
    
    return helper;
  }

  /**
   * Create a session helper and register it
   * @param id Unique identifier for this helper instance
   * @param options Configuration for the session helper
   * @returns The created session helper
   */
  createSessionHelper(id: string, options: SessionHelperOptions): SessionHelper {
    if (this.helpers.has(id)) {
      throw new Error(`Helper with id "${id}" already exists`);
    }

    const helper = new SessionHelper(options);
    this.helpers.set(id, { helper, type: 'session' });
    
    return helper;
  }

  /**
   * Get a helper by its ID
   * @param id The helper ID
   * @returns The helper instance or undefined if not found
   */
  getHelper(id: string): BaseHelper | undefined {
    return this.helpers.get(id)?.helper;
  }

  /**
   * Get the type of a helper by its ID
   * @param id The helper ID
   * @returns The helper type or undefined if not found
   */
  getHelperType(id: string): HelperType | undefined {
    return this.helpers.get(id)?.type;
  }

  /**
   * Remove a helper from the registry
   * @param id The helper ID to remove
   */
  removeHelper(id: string): void {
    this.helpers.delete(id);
  }

  /**
   * Get all active helper IDs in creation order
   * @returns Array of helper IDs
   */
  getActiveHelperIds(): string[] {
    return Array.from(this.helpers.keys());
  }

  /**
   * Get helper IDs filtered by type
   * @param type The helper type to filter by
   * @returns Array of helper IDs of the specified type
   */
  getHelperIdsByType(type: HelperType): string[] {
    return Array.from(this.helpers.entries())
      .filter(([, entry]) => entry.type === type)
      .map(([id]) => id);
  }

  /**
   * Get the count of active helpers
   * @returns Number of active helpers
   */
  getActiveHelperCount(): number {
    return this.helpers.size;
  }

  /**
   * Clear all registered helpers
   */
  clearAll(): void {
    this.helpers.clear();
  }
}
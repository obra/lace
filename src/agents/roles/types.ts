// ABOUTME: TypeScript type definitions for the agent role system
// ABOUTME: Defines the Role interface and related types for pluggable agent roles

export interface Role {
  /** The unique name identifier for this role */
  name: string;
  
  /** System prompt that defines the role's behavior and guidelines */
  systemPrompt: string;
  
  /** Default model to use for this role */
  defaultModel: string;
  
  /** Default provider to use for this role */
  defaultProvider: string;
  
  /** Capabilities this role provides */
  capabilities: string[];
  
  /** Tool restrictions for this role (optional) */
  toolRestrictions?: {
    allowed?: string[];
    denied?: string[];
  };
  
  /** Maximum concurrent tools for this role (optional) */
  maxConcurrentTools?: number;
  
  /** Context window preferences for this role (optional) */
  contextPreferences?: {
    handoffThreshold?: number;
    maxContextSize?: number;
  };
}

/** Union type of all valid role names */
export type RoleName = 
  | 'orchestrator'
  | 'execution' 
  | 'reasoning'
  | 'planning'
  | 'memory'
  | 'synthesis'
  | 'general';

/** Type guard to check if a string is a valid role name */
export function isValidRoleName(name: string): name is RoleName {
  const validRoles: RoleName[] = [
    'orchestrator',
    'execution',
    'reasoning', 
    'planning',
    'memory',
    'synthesis',
    'general'
  ];
  return validRoles.includes(name as RoleName);
}
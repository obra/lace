// ABOUTME: Owner-keyed capability manifest — record at load, query at use. Default-deny.
// ABOUTME: Enforcement of the credential path is spec #6; this is the record + gate.

export type Capability = 'credentials';
export interface CapabilityManifest {
  capabilities: Capability[];
}

const manifests = new Map<string, CapabilityManifest>();

export function recordManifest(pluginName: string, manifest: CapabilityManifest): void {
  manifests.set(pluginName, manifest);
}

/** Built-ins (owner 'builtin') are trusted lace code → all capabilities. A plugin
 *  gets a capability only if it explicitly declared it. Unknown owner → deny. */
export function pluginMayUseCapability(owner: string, capability: Capability): boolean {
  if (owner === 'builtin') return true;
  return manifests.get(owner)?.capabilities.includes(capability) ?? false;
}

export function resetManifestsForTest(): void {
  manifests.clear();
}

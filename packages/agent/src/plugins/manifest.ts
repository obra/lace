// ABOUTME: Owner-keyed capability manifest — plugins declare capabilities at load.

export type Capability = 'credentials';
export interface CapabilityManifest {
  capabilities: Capability[];
}

const manifests = new Map<string, CapabilityManifest>();

export function recordManifest(pluginName: string, manifest: CapabilityManifest): void {
  manifests.set(pluginName, manifest);
}

export function resetManifestsForTest(): void {
  manifests.clear();
}

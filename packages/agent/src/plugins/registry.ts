// ABOUTME: Generic owner-tracking select-one-by-name registry for the plugin system
// ABOUTME: register-by-name (with owner), dup→fatal, lazy-resolve; one per extension kind

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

interface Entry<T> {
  value: T;
  owner: string;
}

export class Registry<T> {
  private readonly entries = new Map<string, Entry<T>>();
  constructor(private readonly kind: string) {}

  register(name: string, value: T, owner: string): void {
    if (this.entries.has(name)) {
      throw new RegistryError(`duplicate: "${name}" already registered in ${this.kind}`);
    }
    this.entries.set(name, { value, owner });
  }

  resolve(name: string): T {
    const e = this.entries.get(name);
    if (!e) {
      throw new RegistryError(
        `no ${this.kind} registered under "${name}" (known: ${this.names().join(', ') || 'none'})`
      );
    }
    return e.value;
  }

  /** The plugin (or 'builtin') that registered `name`. Throws if absent. */
  owner(name: string): string {
    const e = this.entries.get(name);
    if (!e) throw new RegistryError(`no ${this.kind} registered under "${name}"`);
    return e.owner;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }
  names(): string[] {
    return Array.from(this.entries.keys());
  }
  /** Test-support: empty the registry. Production never calls this. */
  clear(): void {
    this.entries.clear();
  }
}

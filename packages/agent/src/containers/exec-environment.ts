// ABOUTME: Shared container exec environment argument shaping
// ABOUTME: Keeps Docker and Apple container replace/inherit env semantics aligned

interface ContainerExecEnvironmentOptions {
  command: string[];
  environment?: Record<string, string>;
  environmentMode?: 'inherit' | 'replace';
}

export function appendEnvironmentOverlayArgs(
  args: string[],
  options: ContainerExecEnvironmentOptions
): void {
  if (options.environmentMode === 'replace') {
    return;
  }

  for (const [key, value] of Object.entries(options.environment || {})) {
    args.push('-e', `${key}=${value}`);
  }
}

export function commandWithExecEnvironment(options: ContainerExecEnvironmentOptions): string[] {
  if (options.environmentMode !== 'replace') {
    return options.command;
  }

  // Container exec APIs only overlay env on top of the container's configured
  // environment. Use env -i inside the container when callers need replacement.
  const environmentAssignments = Object.entries(options.environment || {}).map(
    ([key, value]) => `${key}=${value}`
  );
  return ['env', '-i', ...environmentAssignments, ...options.command];
}

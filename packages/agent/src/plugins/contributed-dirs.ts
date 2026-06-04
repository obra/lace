// ABOUTME: Module-level lists of plugin-contributed persona/skill directories,
// ABOUTME: populated during loadPlugins() and read by PersonaRegistry / composeSkillDirs.
export interface ContributedDir {
  namespace: string;
  dir: string;
}
const _personaDirs: ContributedDir[] = [];
const _skillDirs: ContributedDir[] = [];
export function addPersonaDir(namespace: string, dir: string): void {
  _personaDirs.push({ namespace, dir });
}
export function personaDirs(): ReadonlyArray<ContributedDir> {
  return _personaDirs;
}
export function addSkillDir(namespace: string, dir: string): void {
  _skillDirs.push({ namespace, dir });
}
export function skillDirs(): ReadonlyArray<ContributedDir> {
  return _skillDirs;
}
export function resetContributedDirsForTest(): void {
  _personaDirs.length = 0;
  _skillDirs.length = 0;
}

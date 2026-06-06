// ABOUTME: Public surface of the lace plugin system
export { Registry, RegistryError } from './registry';
export {
  createPluginApi,
  makeRegistries,
  registries,
  resetRegistriesForTest,
  KERNEL_PLUGIN_VERSION,
  PluginVersionError,
  type PluginApi,
  type PluginMeta,
  type PluginRegistries,
  type PluginRegistrar,
  type PluginModule,
} from './api';
export {
  addPersonaDir,
  personaDirs,
  addSkillDir,
  skillDirs,
  resetContributedDirsForTest,
  type ContributedDir,
} from './contributed-dirs';
export {
  recordManifest,
  resetManifestsForTest,
  type Capability,
  type CapabilityManifest,
} from './manifest';
export {
  loadPlugins,
  parsePluginSpec,
  PluginLoadError,
  type LoadPluginsResult,
  type LoadPluginsOptions,
} from './loader';

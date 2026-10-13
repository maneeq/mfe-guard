export { check, DEFAULT_CRITICAL_SINGLETONS } from './check.js';
export { parseManifest, loadManifest } from './loaders/manifest.js';
export { loadProject, DEFAULT_SINGLETONS } from './loaders/project.js';
export { loadConfig } from './config.js';
export { formatText, formatJson } from './report.js';
export type * from './types.js';
export type { MfeGuardConfig, ParticipantConfig, FailOn } from './config.js';

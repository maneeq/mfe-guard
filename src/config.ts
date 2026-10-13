import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export type FailOn = 'error' | 'warn' | 'never';

export interface ParticipantConfig {
  name: string;
  /** URL or path to mf-manifest.json / mf-stats.json. */
  manifest?: string;
  /** Path to a project folder containing package.json (and ideally node_modules). */
  project?: string;
}

export interface MfeGuardConfig {
  participants: ParticipantConfig[];
  /** Project mode: packages treated as shared singletons. ["*"] matches Nx defaults. */
  singletons?: string[];
  criticalSingletons?: string[];
  ignore?: string[];
  failOn?: FailOn;
}

export const DEFAULT_CONFIG_FILE = 'mfe-guard.config.json';

/** Load a JSON config; relative project/manifest paths resolve against the config file. */
export async function loadConfig(path: string): Promise<MfeGuardConfig> {
  const abs = resolve(path);
  let raw: any;
  try {
    raw = JSON.parse(await readFile(abs, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read config ${path}: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw.participants)) {
    throw new Error(`${path}: "participants" must be an array`);
  }
  const base = dirname(abs);
  const fix = (s?: string) => (s && !/^https?:\/\//i.test(s) && !isAbsolute(s) ? resolve(base, s) : s);
  raw.participants = raw.participants.map((p: ParticipantConfig, i: number) => {
    if (!p?.name || (!p.manifest && !p.project)) {
      throw new Error(`${path}: participants[${i}] needs "name" and either "manifest" or "project"`);
    }
    return { ...p, manifest: fix(p.manifest), project: fix(p.project) };
  });
  return raw as MfeGuardConfig;
}

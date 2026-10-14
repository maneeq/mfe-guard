import { readFile } from 'node:fs/promises';
import semver from 'semver';
import { join } from 'node:path';
import { cleanVersion, isRange, matchesPattern, parseJson } from '../util.js';
import type { Participant, SharedEntry } from '../types.js';

/** Packages assumed to be shared singletons in project mode unless configured otherwise. */
export const DEFAULT_SINGLETONS = [
  '@angular/*',
  'rxjs',
  'zone.js',
  'primeng',
  '@primeng/*',
  '@ngrx/*',
  '@ngxs/*',
  'react',
  'react-dom',
  'vue',
];

export interface ProjectOptions {
  /** Patterns of packages treated as shared singletons. Use ["*"] for Nx (shares everything). */
  singletons?: string[];
}

async function readJson(path: string): Promise<any | undefined> {
  try {
    return parseJson(await readFile(path, 'utf8'), path);
  } catch {
    return undefined;
  }
}

/**
 * Build a participant from a project folder: package.json gives the required range,
 * node_modules (when installed) gives the version it will actually ship.
 */
export async function loadProject(dir: string, label: string, opts: ProjectOptions = {}): Promise<Participant> {
  const pkg = await readJson(join(dir, 'package.json'));
  if (!pkg) throw new Error(`${dir}: package.json not found or unreadable`);
  const singletons = opts.singletons ?? DEFAULT_SINGLETONS;
  const deps: Record<string, string> = pkg.dependencies ?? {};

  const shared: SharedEntry[] = [];
  for (const [name, range] of Object.entries(deps)) {
    if (!singletons.some((p) => matchesPattern(name, p))) continue;
    if (!isRange(range)) continue; // workspace:, git urls, file: ...
    const installed = cleanVersion((await readJson(join(dir, 'node_modules', name, 'package.json')))?.version);
    shared.push({
      name,
      version: installed ?? semver.minVersion(range)?.version,
      versionGuessed: !installed,
      requiredVersion: range,
      singleton: true,
    });
  }

  return { name: label, source: dir, kind: 'project', shared };
}

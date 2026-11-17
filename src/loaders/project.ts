import { readFile } from 'node:fs/promises';
import semver from 'semver';
import { basename, join } from 'node:path';
import { cleanVersion, isRange, matchesPattern, parseJson } from '../util.js';
import { loadPnpm } from './pnpm.js';
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
 * Build a participant from a project folder.
 * - Required range: package.json (pnpm `catalog:` specifiers are resolved from the workspace).
 * - Shipped version, first match wins: pnpm-lock.yaml → node_modules → lowest version of the range.
 */
export async function loadProject(dir: string, label: string, opts: ProjectOptions = {}): Promise<Participant> {
  const pkg = await readJson(join(dir, 'package.json'));
  if (!pkg) throw new Error(`${dir}: package.json not found or unreadable`);
  const singletons = opts.singletons ?? DEFAULT_SINGLETONS;
  const deps: Record<string, string> = pkg.dependencies ?? {};
  const pnpm = await loadPnpm(dir);

  const shared: SharedEntry[] = [];
  const unresolved: string[] = [];
  for (const [name, spec] of Object.entries(deps)) {
    if (!singletons.some((p) => matchesPattern(name, p))) continue;

    let range: string | undefined = spec;
    let rangeSource: string | undefined;
    if (typeof spec === 'string' && spec.startsWith('catalog:')) {
      const cname = spec.slice('catalog:'.length).trim();
      rangeSource = `pnpm-workspace.yaml ${cname ? `catalogs.${cname}` : 'catalog'}`;
      range = pnpm?.resolveCatalog(name, spec);
      if (!range) {
        unresolved.push(`${name} (${spec})`);
        continue;
      }
    }
    if (!isRange(range)) continue; // workspace:, git urls, file:, link: ...

    const locked = pnpm?.versions.get(name);
    const installed = locked ? undefined : cleanVersion((await readJson(join(dir, 'node_modules', name, 'package.json')))?.version);
    const version = locked ?? installed ?? semver.minVersion(range)?.version;

    shared.push({
      name,
      version,
      versionGuessed: !locked && !installed,
      requiredVersion: range,
      rangeSource,
      singleton: true,
    });
  }

  const notes: string[] = [];
  if (pnpm) notes.push(`versions from ${basename(pnpm.lockfile)}`);
  if (unresolved.length) notes.push(`skipped unresolved catalog entries: ${unresolved.join(', ')}`);

  return { name: label, source: dir, kind: 'project', shared, notes };
}

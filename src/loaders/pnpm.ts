import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { cleanVersion } from '../util.js';

/** What pnpm tells us about one project inside a (possibly multi-package) workspace. */
export interface PnpmInfo {
  /** Absolute path of the pnpm-lock.yaml that was used. */
  lockfile: string;
  /** Resolved version per dependency name, from the lockfile (peer suffixes stripped). */
  versions: Map<string, string>;
  /** Turns a `catalog:` / `catalog:name` specifier into a real range, or undefined. */
  resolveCatalog(name: string, specifier: string): string | undefined;
}

async function readYaml(path: string): Promise<any | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return parseYaml(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new Error(`${path}: invalid YAML: ${(e as Error).message}`);
  }
}

/** Walk up from `dir` to the filesystem root and return the first folder holding `file`. */
async function findUp(dir: string, file: string): Promise<string | undefined> {
  let cur = resolve(dir);
  for (;;) {
    try {
      await readFile(join(cur, file));
      return cur;
    } catch {
      /* keep walking */
    }
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/**
 * "19.2.3(@angular/core@19.2.14)" -> "19.2.3"   (lockfile v6 / v9 peer suffix)
 * "19.2.3_@angular+core@19.2.14"  -> "19.2.3"   (lockfile v5 peer suffix)
 * "link:../lib" / "file:..."       -> undefined  (local packages, not from the registry)
 */
export function lockedVersion(raw: unknown): string | undefined {
  const v = typeof raw === 'string' ? raw : (raw as any)?.version;
  if (typeof v !== 'string' || /^(link|file|workspace):/.test(v)) return undefined;
  return cleanVersion(v.split('(')[0].split('_')[0].trim());
}

/** Lockfile importer key for a project folder: "." for the root, "apps/orders" for a package. */
function importerKey(root: string, dir: string): string {
  const rel = relative(root, resolve(dir)).split(sep).join('/');
  return rel === '' ? '.' : rel;
}

/**
 * Read pnpm data for `dir`: finds pnpm-lock.yaml in `dir` or any parent (monorepos keep it
 * at the workspace root), picks this project's importer, and loads the workspace catalogs.
 * Returns undefined when the project is not managed by pnpm.
 */
export async function loadPnpm(dir: string): Promise<PnpmInfo | undefined> {
  const root = await findUp(dir, 'pnpm-lock.yaml');
  if (!root) return undefined;
  const lockPath = join(root, 'pnpm-lock.yaml');
  const lock = (await readYaml(lockPath)) ?? {};

  const key = importerKey(root, dir);
  // v6 / v9 workspaces: importers[key]; v5 and single-project v6: top-level dependencies.
  const importer = lock.importers?.[key] ?? (key === '.' ? lock : undefined) ?? {};

  const versions = new Map<string, string>();
  for (const group of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [name, raw] of Object.entries<any>(importer[group] ?? {})) {
      const v = lockedVersion(raw);
      if (v && !versions.has(name)) versions.set(name, v);
    }
  }

  // Catalogs live in pnpm-workspace.yaml; lockfile v9 also records them.
  const ws = (await readYaml(join(root, 'pnpm-workspace.yaml'))) ?? {};
  const catalogs: Record<string, Record<string, unknown>> = { ...(ws.catalogs ?? {}) };
  if (ws.catalog) catalogs.default = { ...(catalogs.default ?? {}), ...ws.catalog };
  for (const [cname, entries] of Object.entries<any>(lock.catalogs ?? {})) {
    catalogs[cname] ??= {};
    for (const [pkg, e] of Object.entries<any>(entries ?? {})) catalogs[cname][pkg] ??= e?.specifier;
  }

  return {
    lockfile: lockPath,
    versions,
    resolveCatalog(name, specifier) {
      const m = /^catalog:(.*)$/.exec(specifier.trim());
      if (!m) return undefined;
      const spec = catalogs[m[1] || 'default']?.[name];
      return typeof spec === 'string' ? spec : undefined;
    },
  };
}

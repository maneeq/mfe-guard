import semver from 'semver';
import type { SharedEntry } from './types.js';

/** "primeng/autocomplete" -> "primeng", "@angular/common/http" -> "@angular/common". */
export function rootPackage(name: string): string {
  const parts = name.split('/');
  return name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * JSON.parse that tolerates a UTF-8 byte-order mark (Windows Notepad adds one)
 * and reports where the JSON is broken.
 */
export function parseJson(text: string, source: string): unknown {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(clean);
  } catch (e) {
    const msg = (e as Error).message;
    const pos = /position (\d+)/.exec(msg);
    let where = '';
    if (pos && !/line \d+/.test(msg)) {
      const before = clean.slice(0, Number(pos[1]));
      const line = before.split('\n').length;
      const col = Number(pos[1]) - before.lastIndexOf('\n');
      where = ` (line ${line}, column ${col})`;
    }
    const hint = /^\s*</.test(clean) ? ' — got HTML, check the URL points at mf-manifest.json' : '';
    throw new Error(`${source}: invalid JSON: ${msg}${where}${hint}`);
  }
}

/** Clean a version string into valid semver, or undefined. */
export function cleanVersion(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return semver.valid(v) ?? semver.coerce(v)?.version ?? undefined;
}

/** True for a usable semver range (rejects workspace:, git urls, "*"-less garbage). */
export function isRange(r: unknown): r is string {
  return typeof r === 'string' && r.length > 0 && semver.validRange(r) !== null;
}

/** True when the range pins one exact version ("1.2.3", "=1.2.3"). */
export function isExactPin(r: string): boolean {
  return semver.valid(r.replace(/^=/, '').trim()) !== null;
}

/** Glob-ish match: "@angular/*", "rxjs", "*". */
export function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('/*')) return name.startsWith(pattern.slice(0, -1));
  return name === pattern;
}

/**
 * Collapse secondary entry points into one entry per root package.
 * The root's own entry wins when present; otherwise the first entry point is used.
 */
export function collapseEntryPoints(shared: SharedEntry[]): SharedEntry[] {
  const byRoot = new Map<string, SharedEntry>();
  for (const s of shared) {
    const root = rootPackage(s.name);
    const existing = byRoot.get(root);
    if (!existing) {
      byRoot.set(root, { ...s, name: root, entryPoints: 1 });
      continue;
    }
    existing.entryPoints = (existing.entryPoints ?? 1) + 1;
    if (s.name === root) {
      byRoot.set(root, { ...s, name: root, entryPoints: existing.entryPoints });
    } else {
      // keep the strictest picture: singleton if any entry point is one
      existing.singleton = existing.singleton || s.singleton;
      existing.version ??= s.version;
      if (existing.requiredVersion === undefined) existing.requiredVersion = s.requiredVersion;
    }
  }
  return [...byRoot.values()];
}

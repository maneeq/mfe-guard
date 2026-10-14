import { readFile } from 'node:fs/promises';
import type { Participant, SharedEntry } from '../types.js';
import { parseJson } from '../util.js';

/**
 * Parse an `mf-manifest.json` (or `mf-stats.json`) produced by
 * @module-federation/enhanced, webpack or rspack.
 */
export function parseManifest(json: unknown, source: string, label?: string): Participant {
  if (!json || typeof json !== 'object') {
    throw new Error(`${source}: not a JSON object`);
  }
  const m = json as Record<string, any>;
  const meta = (m.metaData ?? {}) as Record<string, any>;
  const federationName: string | undefined = m.name ?? meta.name ?? m.id;
  if (!Array.isArray(m.shared)) {
    throw new Error(
      `${source}: no "shared" array found. Point mfe-guard at mf-manifest.json (or mf-stats.json), not remoteEntry.js.`,
    );
  }

  const shared: SharedEntry[] = m.shared
    .filter((s: any) => s && typeof s.name === 'string')
    .map((s: any) => ({
      name: s.name,
      version: typeof s.version === 'string' ? s.version : undefined,
      requiredVersion:
        s.requiredVersion === false ? false : typeof s.requiredVersion === 'string' ? s.requiredVersion : undefined,
      singleton: s.singleton === true,
      strictVersion: typeof s.strictVersion === 'boolean' ? s.strictVersion : undefined,
      eager: typeof s.eager === 'boolean' ? s.eager : undefined,
    }));

  return {
    name: label ?? federationName ?? source,
    federationName,
    globalName: typeof meta.globalName === 'string' ? meta.globalName : undefined,
    source,
    kind: 'manifest',
    shared,
  };
}

/** Load a manifest from an http(s) URL or a local path. */
export async function loadManifest(source: string, label?: string): Promise<Participant> {
  let text: string;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status} ${res.statusText}`);
    text = await res.text();
  } else {
    text = await readFile(source, 'utf8');
  }
  return parseManifest(parseJson(text, source), source, label);
}

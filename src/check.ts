import semver from 'semver';
import { collapseEntryPoints, isExactPin, isRange, matchesPattern } from './util.js';
import type { CheckOptions, CheckResult, Finding, Participant, RuleId, SharedEntry, Severity } from './types.js';

export const DEFAULT_CRITICAL_SINGLETONS = [
  '@angular/core',
  '@angular/common',
  '@angular/router',
  '@angular/platform-browser',
  'rxjs',
  'zone.js',
  'react',
  'react-dom',
];

interface Use {
  p: Participant;
  e: SharedEntry;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function versionLabel(u: Use): string {
  return u.e.versionGuessed ? `${u.e.version} (guessed from "${u.e.requiredVersion}" — install deps for the exact version)` : `${u.e.version}`;
}

/** Run every rule over the given participants. Pure function — no I/O. */
export function check(input: Participant[], opts: CheckOptions = {}): CheckResult {
  const critical = opts.criticalSingletons ?? DEFAULT_CRITICAL_SINGLETONS;
  const ignore = opts.ignore ?? [];
  const isIgnored = (rule: RuleId, pkg: string) => ignore.includes(rule) || ignore.includes(`${rule}:${pkg}`) || ignore.includes(pkg);

  const participants = input.map((p) => ({ ...p, shared: collapseEntryPoints(p.shared) }));
  const findings: Finding[] = [];
  const add = (f: Finding) => {
    if (!isIgnored(f.rule, f.package)) findings.push(f);
  };

  // ── duplicate-name ──────────────────────────────────────────────
  for (const key of ['federationName', 'globalName'] as const) {
    const byName = new Map<string, Participant[]>();
    for (const p of participants) {
      const n = p[key];
      if (!n) continue;
      byName.set(n, [...(byName.get(n) ?? []), p]);
    }
    for (const [n, ps] of byName) {
      if (ps.length < 2) continue;
      add({
        rule: 'duplicate-name',
        severity: 'error',
        package: '',
        message: `${ps.length} participants use the same ${key === 'globalName' ? 'global (chunk) name' : 'federation name'} "${n}"`,
        details: ps.map((p) => `${p.name} ← ${p.source}`),
        fix: 'give every remote a unique MF `name` (and `output.uniqueName`) — they will overwrite each other\'s modules at runtime',
        participants: ps.map((p) => p.name),
      });
    }
  }

  // ── per-package rules ──────────────────────────────────────────
  const byPkg = new Map<string, Use[]>();
  for (const p of participants) {
    for (const e of p.shared) byPkg.set(e.name, [...(byPkg.get(e.name) ?? []), { p, e }]);
  }

  let packagesCompared = 0;
  for (const [pkg, uses] of [...byPkg].sort(([a], [b]) => a.localeCompare(b))) {
    if (uses.length < 2) continue; // only one participant shares it — nothing to conflict with
    packagesCompared++;
    const entryPoints = Math.max(...uses.map((u) => u.e.entryPoints ?? 1));
    const names = uses.map((u) => u.p.name);
    const isSingleton = uses.some((u) => u.e.singleton);

    // not-singleton
    if (critical.some((c) => matchesPattern(pkg, c))) {
      const loose = uses.filter((u) => !u.e.singleton);
      if (loose.length) {
        add({
          rule: 'not-singleton',
          severity: 'warn',
          package: pkg,
          entryPoints,
          message: `${pkg} must be a singleton but is not in ${loose.map((u) => u.p.name).join(', ')}`,
          details: uses.map((u) => `${u.p.name}: singleton=${u.e.singleton}`),
          fix: `set { singleton: true } for ${pkg} in every participant — two copies break DI / zones / shared state`,
          participants: loose.map((u) => u.p.name),
        });
      }
    }

    const providers = uses.filter((u) => u.e.version && semver.valid(u.e.version));

    // major-mismatch
    const majors = new Set(providers.map((u) => semver.major(u.e.version!)));
    if (majors.size > 1) {
      add({
        rule: 'major-mismatch',
        severity: 'error',
        package: pkg,
        entryPoints,
        message: `${pkg} is shipped in ${majors.size} different major versions`,
        details: providers.map((u) => `${u.p.name} ships ${versionLabel(u)}`),
        fix: `align every participant on the same major version of ${pkg}`,
        participants: providers.map((u) => u.p.name),
      });
      continue;
    }

    if (!isSingleton || providers.length === 0) continue;

    // singleton-unsatisfied — MF picks the highest provided version for a singleton
    const winner = providers.reduce((a, b) => (semver.gt(b.e.version!, a.e.version!) ? b : a));
    const winVer = winner.e.version!;
    const unsatisfied = uses.filter(
      (u) =>
        u.e.version !== winVer &&
        isRange(u.e.requiredVersion) &&
        !semver.satisfies(winVer, u.e.requiredVersion, { includePrerelease: true }),
    );

    if (unsatisfied.length) {
      const fixes = unsatisfied.map((u) => {
        const range = u.e.requiredVersion as string;
        const lo = semver.minVersion(range);
        if (lo && semver.lt(winVer, lo.version)) {
          return `upgrade ${pkg} in ${winner.p.name} to >= ${lo.version}`;
        }
        if (lo && semver.major(lo) === semver.major(winVer)) {
          return `in ${u.p.name}: change ${pkg} "${range}" → "^${lo.version}" (or align both on ${winVer})`;
        }
        return `align ${pkg} versions between ${u.p.name} and ${winner.p.name}`;
      });
      add({
        rule: 'singleton-unsatisfied',
        severity: 'error',
        package: pkg,
        entryPoints,
        message: `${pkg} singleton resolves to ${winVer}, which does not satisfy ${unsatisfied.map((u) => u.p.name).join(', ')}`,
        details: [
          `${winner.p.name} provides ${versionLabel(winner)} → wins as singleton (highest version)`,
          ...unsatisfied.map((u) => `${u.p.name} requires "${u.e.requiredVersion}" ✗`),
        ],
        fix: fixes.join('; '),
        participants: names,
      });
    } else {
      const distinct = [...new Set(providers.map((u) => u.e.version!))];
      if (distinct.length > 1) {
        add({
          rule: 'version-drift',
          severity: 'info',
          package: pkg,
          entryPoints,
          message: `${pkg} versions differ (${distinct.join(', ')}); singleton resolves to ${winVer}`,
          details: providers.map((u) => `${u.p.name} ships ${versionLabel(u)}`),
          participants: names,
        });
      }
    }

    // exact-pin — fragile even when it happens to work today
    const unsatisfiedSet = new Set(unsatisfied.map((u) => u.p.name));
    const pinned = uses.filter(
      (u) => u.e.singleton && isRange(u.e.requiredVersion) && isExactPin(u.e.requiredVersion) && !unsatisfiedSet.has(u.p.name),
    );
    if (pinned.length) {
      add({
        rule: 'exact-pin',
        severity: 'warn',
        package: pkg,
        entryPoints,
        message: `${pkg} is pinned to an exact version in ${pinned.map((u) => u.p.name).join(', ')}`,
        details: pinned.map((u) => `${u.p.name} requires exactly "${u.e.requiredVersion}"`),
        fix: `use a caret range (e.g. "^${(pinned[0].e.requiredVersion as string).replace(/^=/, '')}") so a patch bump in another remote does not break it`,
        participants: pinned.map((u) => u.p.name),
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.package.localeCompare(b.package));
  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;

  return { participants, packagesCompared, findings, summary };
}

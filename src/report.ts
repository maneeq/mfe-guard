import type { CheckResult, Severity } from './types.js';

const useColor = () => !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code: number) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const cyan = paint(36);
const dim = paint(2);
const bold = paint(1);
const green = paint(32);

const ICON: Record<Severity, string> = { error: '✖', warn: '⚠', info: 'ℹ' };
const COLOR: Record<Severity, (s: string) => string> = { error: red, warn: yellow, info: cyan };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function formatText(result: CheckResult, version: string): string {
  const out: string[] = [];
  out.push(
    bold(`mfe-guard v${version}`) +
      dim(` — ${plural(result.participants.length, 'participant')}, ${plural(result.packagesCompared, 'shared package')} compared`),
  );
  for (const p of result.participants) {
    out.push(dim(`  • ${p.name} (${p.kind}, ${p.shared.length} shared) ← ${p.source}`));
  }
  out.push('');

  if (!result.findings.length) {
    out.push(green('✔ No conflicts found.'));
    return out.join('\n');
  }

  for (const f of result.findings) {
    const c = COLOR[f.severity];
    const pkg = f.package ? ` ${bold(f.package)}${f.entryPoints && f.entryPoints > 1 ? dim(` (${f.entryPoints} entry points)`) : ''}` : '';
    out.push(`${c(`${ICON[f.severity]} ${f.severity.padEnd(5)}`)} ${dim(f.rule)}${pkg}`);
    out.push(`    ${f.message}`);
    for (const d of f.details) out.push(dim(`      ${d}`));
    if (f.fix) out.push(`    ${green('fix:')} ${f.fix}`);
    out.push('');
  }

  const s = result.summary;
  out.push(
    [
      s.error ? red(plural(s.error, 'error')) : plural(0, 'error'),
      s.warn ? yellow(plural(s.warn, 'warning')) : plural(0, 'warning'),
      plural(s.info, 'info'),
    ].join(', '),
  );
  return out.join('\n');
}

export function formatJson(result: CheckResult, version: string): string {
  return JSON.stringify(
    {
      tool: 'mfe-guard',
      version,
      participants: result.participants.map((p) => ({ name: p.name, kind: p.kind, source: p.source, shared: p.shared.length })),
      packagesCompared: result.packagesCompared,
      summary: result.summary,
      findings: result.findings,
    },
    null,
    2,
  );
}

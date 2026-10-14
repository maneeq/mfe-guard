#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check } from './check.js';
import { DEFAULT_CONFIG_FILE, loadConfig, type FailOn, type ParticipantConfig } from './config.js';
import { loadManifest } from './loaders/manifest.js';
import { loadProject } from './loaders/project.js';
import { formatJson, formatText } from './report.js';
import type { Participant } from './types.js';

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `mfe-guard v${VERSION} — catch Module Federation shared-dependency conflicts before production

Usage
  mfe-guard check [options]

Inputs (repeatable, at least two participants)
  -m, --manifest <name=url|path>   mf-manifest.json (or mf-stats.json) of a shell/remote
  -p, --project  <name=dir>        project folder with package.json (+ node_modules)
  -c, --config   <file>            JSON config (default: ./${DEFAULT_CONFIG_FILE} if present)

Options
      --singletons <a,b,...>       project mode: packages treated as singletons ("*" = Nx default)
      --ignore <rule|pkg|rule:pkg,...>
      --fail-on <error|warn|never> exit 1 at this severity (default: error)
      --verbose                    list every finding, including patch-only version drift
      --json                       machine-readable output
  -h, --help
  -v, --version

Examples
  mfe-guard check -m shell=https://app.test/mf-manifest.json \\
                  -m orders=https://orders.test/mf-manifest.json \\
                  -m inventory=https://inventory.test/mf-manifest.json

  mfe-guard check -p orders=../orders-app -p inventory=../inventory-app --singletons "*"

Exit codes: 0 ok · 1 findings at/above --fail-on · 2 usage or load error`;

function splitPair(v: string, flag: string): { name: string; value: string } {
  const i = v.indexOf('=');
  if (i <= 0 || i === v.length - 1) throw new UsageError(`${flag} expects name=value, got "${v}"`);
  return { name: v.slice(0, i), value: v.slice(i + 1) };
}

const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      manifest: { type: 'string', short: 'm', multiple: true },
      project: { type: 'string', short: 'p', multiple: true },
      config: { type: 'string', short: 'c' },
      singletons: { type: 'string' },
      ignore: { type: 'string' },
      'fail-on': { type: 'string' },
      json: { type: 'boolean' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }
  if (positionals[0] !== 'check') throw new UsageError(`unknown command "${positionals[0]}" (try: mfe-guard check)`);

  // config file (explicit or auto-detected) + CLI flags are merged
  const configPath = values.config ?? (existsSync(DEFAULT_CONFIG_FILE) ? DEFAULT_CONFIG_FILE : undefined);
  const config = configPath ? await loadConfig(configPath) : { participants: [] as ParticipantConfig[] };

  const participantsCfg: ParticipantConfig[] = [
    ...config.participants,
    ...(values.manifest ?? []).map((v) => {
      const { name, value } = splitPair(v, '--manifest');
      return { name, manifest: value };
    }),
    ...(values.project ?? []).map((v) => {
      const { name, value } = splitPair(v, '--project');
      return { name, project: value };
    }),
  ];
  if (participantsCfg.length < 2) {
    throw new UsageError('need at least two participants (use --manifest / --project or a config file)');
  }

  const failOn = (values['fail-on'] ?? config.failOn ?? 'error') as FailOn;
  if (!['error', 'warn', 'never'].includes(failOn)) throw new UsageError(`--fail-on must be error, warn or never`);
  const singletons = list(values.singletons) ?? config.singletons;

  const participants: Participant[] = await Promise.all(
    participantsCfg.map((p) =>
      p.manifest ? loadManifest(p.manifest, p.name) : loadProject(p.project!, p.name, { singletons }),
    ),
  );

  const result = check(participants, {
    ignore: [...(config.ignore ?? []), ...(list(values.ignore) ?? [])],
    criticalSingletons: config.criticalSingletons,
  });

  console.log(values.json ? formatJson(result, VERSION) : formatText(result, VERSION, { verbose: values.verbose }));

  if (failOn === 'never') return 0;
  if (result.summary.error > 0) return 1;
  if (failOn === 'warn' && result.summary.warn > 0) return 1;
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`mfe-guard: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof UsageError) console.error('run "mfe-guard --help" for usage');
    process.exit(2);
  },
);

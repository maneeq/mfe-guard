# mfe-guard

[![npm](https://img.shields.io/npm/v/mfe-guard)](https://www.npmjs.com/package/mfe-guard)
[![downloads](https://img.shields.io/npm/dw/mfe-guard)](https://www.npmjs.com/package/mfe-guard)
[![CI](https://github.com/maneeq/mfe-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/maneeq/mfe-guard/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mfe-guard)](https://github.com/maneeq/mfe-guard/blob/main/LICENSE)

**Catch Module Federation shared-dependency conflicts before they crash your micro-frontends in production.**

You deploy a new remote. Everything builds. Then an older remote dies in the browser with:

```
Error: [ Federation Runtime ]: Version 19.2.3 from inventory of shared singleton
module @angular/material/autocomplete does not satisfy the requirement of orders which needs 19.2.1
```

…or worse, a cryptic `ReferenceError: Cannot access '_t' before initialization`.

`mfe-guard` reads the `mf-manifest.json` of every shell and remote, works out which version of each shared singleton will **actually win at runtime**, and fails CI when any participant will not accept it, with the exact fix.

![mfe-guard check output: one singleton-unsatisfied error with the exact fix](https://raw.githubusercontent.com/maneeq/mfe-guard/main/docs/demo.svg)

## Install

```bash
npx -y mfe-guard check --help     # no install needed
npm i -D mfe-guard                # or as a dev dependency
```

Requires Node 18.17+.

## Usage

### Manifest mode (recommended)

`@module-federation/enhanced` (and Nx, rspack, Modern.js on top of it) emits `mf-manifest.json` next to `remoteEntry.js`. Point mfe-guard at the deployed manifests of every participant. They can live in completely separate repos:

```bash
npx mfe-guard check \
  -m shell=https://app.test.example.com/mf-manifest.json \
  -m orders=https://orders.test.example.com/mf-manifest.json \
  -m inventory=https://inventory.test.example.com/mf-manifest.json
```

Local paths work too (`-m orders=./dist/orders/mf-manifest.json`), and so do `mf-stats.json` files.

### Project mode (no build needed)

Compare project folders directly. The required range comes from `package.json`, and the shipped version comes from `node_modules` when installed:

```bash
npx mfe-guard check -p orders=../orders-app -p inventory=../inventory-app --singletons "*"
```

By default only well-known singletons (`@angular/*`, `rxjs`, `zone.js`, `primeng`, `@primeng/*`, `@ngrx/*`, `@ngxs/*`, `react`, `react-dom`, `vue`) are compared. **Nx shares every dependency as a singleton**, so pass `--singletons "*"` there.

### Config file

Drop a `mfe-guard.config.json` in the repo and just run `npx mfe-guard check`:

```json
{
  "participants": [
    { "name": "shell", "manifest": "https://app.test.example.com/mf-manifest.json" },
    { "name": "orders", "manifest": "https://orders.test.example.com/mf-manifest.json" },
    { "name": "inventory", "project": "../inventory-app" }
  ],
  "ignore": ["version-drift", "exact-pin:@acme/ui-kit"],
  "failOn": "error"
}
```

CLI flags are merged on top of the config.

## Rules

| Rule | Severity | What it catches |
|---|---|---|
| `singleton-unsatisfied` | error | The version that wins a singleton (the highest provided) does not satisfy another participant's `requiredVersion`. With `strictVersion` it throws at runtime; without it, you silently run on a version you never tested. |
| `major-mismatch` | error | Participants ship different major versions of the same shared package. |
| `duplicate-name` | error | Two participants share a federation `name` or global/chunk name, so they overwrite each other's modules. |
| `exact-pin` | warn | A singleton is required as an exact version (`"19.2.1"`), so any patch bump elsewhere breaks it. |
| `not-singleton` | warn | Framework packages (`@angular/core`, `rxjs`, `zone.js`, `react`, …) shared without `singleton: true`. |
| `version-drift` | info | Versions differ but are still compatible. Minor drift is listed with a note on what will actually run; patch-only drift is folded into one line (`--verbose` lists it). |

Secondary entry points (`@angular/material/autocomplete`, `@angular/common/http`, …) are collapsed into their root package, so you get one finding instead of forty.

Ignore by rule (`exact-pin`), by package (`leaflet`), or by both (`exact-pin:leaflet`).

## CI

```yaml
# .github/workflows/mfe-guard.yml
name: mfe-guard
on: [pull_request]
jobs:
  federation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx mfe-guard check   # reads mfe-guard.config.json
```

Exit codes: `0` ok · `1` findings at or above `--fail-on` (default `error`) · `2` usage or load error. Use `--json` for machine-readable output (always includes every finding) and `--verbose` to list patch-only drift in the text report.

## Programmatic API

```ts
import { check, loadManifest, formatText } from 'mfe-guard';

const result = check([
  await loadManifest('https://orders.test.example.com/mf-manifest.json', 'orders'),
  await loadManifest('./dist/inventory/mf-manifest.json', 'inventory'),
]);
console.log(result.summary); // { error: 2, warn: 3, info: 1 }
```

## How resolution is modelled

For a singleton, the Module Federation runtime picks the **highest** version offered by any loaded participant (default `shareStrategy`). mfe-guard assumes every listed participant is loaded together, which is the worst case and therefore the one worth guarding against in CI.

## How it differs from config linters

Tools like [mf-doctor](https://www.npmjs.com/package/mf-doctor) parse your bundler config files inside one workspace. mfe-guard reads the `mf-manifest.json` each remote actually deployed, so it works across separate repos and teams without their source, and it models which singleton version wins at runtime. They complement each other: lint configs in each repo, guard the deployed combination in CI.

## Roadmap

- Lockfile parsing (pnpm / npm / yarn) for exact versions without `node_modules`
- Nx executor and a ready-made GitHub Action
- HTML report
- Classic webpack `remoteEntry.js` (no manifest) support

## License

MIT © Aneeq Rehman

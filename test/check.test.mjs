import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { check, loadManifest, loadProject, parseManifest } from '../dist/index.js';

const fx = (f) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const byRule = (r, rule, pkg) => r.findings.filter((f) => f.rule === rule && (pkg === undefined || f.package === pkg));

test('reproduces the orders + inventory material crash', async () => {
  const r = check([await loadManifest(fx('orders.mf-manifest.json')), await loadManifest(fx('inventory.mf-manifest.json'))]);
  const [f] = byRule(r, 'singleton-unsatisfied', '@angular/material');
  assert.ok(f, '@angular/material conflict must be reported');
  assert.equal(f.severity, 'error');
  assert.equal(f.entryPoints, 3, '@angular/material entry points are collapsed into one finding');
  assert.match(f.details[0], /inventory provides 19\.2\.3/);
  assert.match(f.fix, /in orders: change @angular\/material "19\.2\.1" → "\^19\.2\.1"/);
});

test('flags every other real issue between the two remotes', async () => {
  const r = check([await loadManifest(fx('orders.mf-manifest.json')), await loadManifest(fx('inventory.mf-manifest.json'))]);
  // orders pins @acme/core 1.1.0, inventory ships 1.2.1
  assert.equal(byRule(r, 'singleton-unsatisfied', '@acme/core').length, 1);
  // orders needs ^2.13.1 → 2.16.0 satisfies it; but inventory pins 2.16.0 exactly
  assert.equal(byRule(r, 'singleton-unsatisfied', '@acme/ui-kit').length, 0);
  assert.equal(byRule(r, 'exact-pin', '@acme/ui-kit').length, 1);
  // rxjs is not a singleton in inventory
  assert.deepEqual(byRule(r, 'not-singleton', 'rxjs')[0].participants, ['inventory']);
  // leaflet only in one remote → not compared
  assert.equal(r.findings.some((f) => f.package === 'leaflet'), false);
  assert.ok(r.summary.error >= 2);
});

test('the fixed manifests come back clean (info only)', async () => {
  const r = check([await loadManifest(fx('orders-fixed.mf-manifest.json')), await loadManifest(fx('inventory-fixed.mf-manifest.json'))]);
  assert.equal(r.summary.error, 0);
  assert.equal(r.summary.warn, 0);
  assert.ok(byRule(r, 'version-drift', '@angular/material').length === 1, 'drift is still reported as info');
});

test('duplicate federation name and major mismatch', async () => {
  const r = check([await loadManifest(fx('orders.mf-manifest.json')), await loadManifest(fx('legacy-orders.mf-manifest.json'), 'legacy')]);
  const dup = byRule(r, 'duplicate-name');
  assert.ok(dup.length >= 1);
  assert.deepEqual(dup[0].participants, ['orders', 'legacy']);
  const major = byRule(r, 'major-mismatch', '@angular/core');
  assert.equal(major.length, 1);
  assert.equal(byRule(r, 'singleton-unsatisfied', '@angular/core').length, 0, 'major mismatch suppresses duplicate noise');
});

test('ignore list silences rules', async () => {
  const ps = [await loadManifest(fx('orders.mf-manifest.json')), await loadManifest(fx('inventory.mf-manifest.json'))];
  const r = check(ps, { ignore: ['not-singleton', 'singleton-unsatisfied:@angular/material'] });
  assert.equal(byRule(r, 'not-singleton').length, 0);
  assert.equal(byRule(r, 'singleton-unsatisfied', '@angular/material').length, 0);
  assert.equal(byRule(r, 'singleton-unsatisfied', '@acme/core').length, 1);
});

test('project mode reads package.json + node_modules', async () => {
  const r = check([await loadProject(fx('proj-orders'), 'orders'), await loadProject(fx('proj-inventory'), 'inventory')]);
  const [f] = byRule(r, 'singleton-unsatisfied', '@angular/material');
  assert.ok(f);
  assert.match(f.details[0], /inventory provides 19\.2\.3 →/);
});

test('rejects a remoteEntry-like payload with a helpful message', () => {
  assert.throws(() => parseManifest({ name: 'x' }, 'remoteEntry.js'), /mf-manifest\.json/);
});

test('accepts a manifest saved with a UTF-8 BOM and CRLF (Windows Notepad)', async () => {
  const p = await loadManifest(fx('inventory-bom.mf-manifest.json'));
  assert.equal(p.name, 'inventory');
  assert.ok(p.shared.length > 0);
});

test('broken JSON reports line and column', async () => {
  await assert.rejects(loadManifest(fx('broken.mf-manifest.json')), /invalid JSON: .*line 4/);
});

test('version-drift is tagged patch or minor', async () => {
  const r = check([await loadManifest(fx('orders-fixed.mf-manifest.json')), await loadManifest(fx('inventory-fixed.mf-manifest.json'))]);
  assert.equal(byRule(r, 'version-drift', '@angular/material')[0].drift, 'patch');
  const minor = byRule(r, 'version-drift', '@acme/ui-kit')[0];
  assert.equal(minor.drift, 'minor');
  assert.match(minor.fix, /orders will run on @acme\/ui-kit@2\.16\.0/);
});

test('pnpm monorepo: versions from pnpm-lock.yaml, catalog: resolved, no node_modules needed', async () => {
  const orders = await loadProject(fx('pnpm-mono/apps/orders'), 'orders');
  const inventory = await loadProject(fx('pnpm-mono/apps/inventory'), 'inventory');
  const mat = orders.shared.find((s) => s.name === '@angular/material');
  assert.equal(mat.requiredVersion, '19.2.1', 'catalog: resolved from pnpm-workspace.yaml');
  assert.equal(mat.version, '19.2.1', 'peer suffix stripped from lockfile version');
  assert.equal(mat.versionGuessed, false);
  assert.match(orders.notes.join(' '), /pnpm-lock\.yaml/);
  assert.equal(inventory.shared.some((s) => s.name === 'shared-lib'), false, 'workspace: deps skipped');

  const r = check([orders, inventory]);
  const [f] = byRule(r, 'singleton-unsatisfied', '@angular/material');
  assert.ok(f, 'conflict found from lockfile versions');
  assert.match(f.details[0], /inventory provides 19\.2\.3 →/);
  assert.doesNotMatch(f.details[0], /guessed/);
  assert.equal(byRule(r, 'version-drift', '@angular/core')[0].drift, 'patch');
});

test('pnpm: unknown named catalog is reported, not silently dropped', async () => {
  const p = await loadProject(fx('pnpm-mono/apps/catalog-missing'), 'x');
  assert.match(p.notes.join(' '), /skipped unresolved catalog entries: @angular\/core \(catalog:ng19\)/);
  assert.equal(p.shared.find((s) => s.name === 'rxjs').requiredVersion, '~7.8.0');
});

test('pnpm lockfile v6 single project (top-level dependencies)', async () => {
  const p = await loadProject(fx('pnpm-v6-single'), 'v6app');
  assert.equal(p.shared.find((s) => s.name === 'primeng').version, '19.1.4');
  assert.equal(p.shared.find((s) => s.name === 'rxjs').version, '7.8.1');
});

test('fix message points at the pnpm catalog when the range comes from it', async () => {
  const r = check([await loadProject(fx('pnpm-mono/apps/orders'), 'orders'), await loadProject(fx('pnpm-mono/apps/inventory'), 'inventory')]);
  const [f] = byRule(r, 'singleton-unsatisfied', '@angular/material');
  assert.match(f.fix, /\(set in pnpm-workspace\.yaml catalog\)/);
});

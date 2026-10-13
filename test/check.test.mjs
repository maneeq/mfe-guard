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

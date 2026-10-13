import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const fx = (f) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

test('exit 1 and readable report on conflicts', () => {
  const r = run('check', '-m', `orders=${fx('orders.mf-manifest.json')}`, '-m', `inventory=${fx('inventory.mf-manifest.json')}`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✖ error singleton-unsatisfied @angular\/material \(3 entry points\)/);
  assert.match(r.stdout, /fix: in orders: change @angular\/material/);
});

test('exit 0 on clean manifests, --json is valid', () => {
  const r = run('check', '--json', '-m', `orders=${fx('orders-fixed.mf-manifest.json')}`, '-m', `inventory=${fx('inventory-fixed.mf-manifest.json')}`);
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.equal(json.summary.error, 0);
});

test('--fail-on never always exits 0', () => {
  const r = run('check', '--fail-on', 'never', '-m', `orders=${fx('orders.mf-manifest.json')}`, '-m', `s=${fx('inventory.mf-manifest.json')}`);
  assert.equal(r.status, 0);
});

test('usage errors exit 2', () => {
  assert.equal(run('check', '-m', `orders=${fx('orders.mf-manifest.json')}`).status, 2);
  assert.equal(run('check', '-m', 'oops').status, 2);
  assert.equal(run('check', '-m', 'a=/nope.json', '-m', 'b=/nope2.json').status, 2);
});

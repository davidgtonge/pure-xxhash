// The runtime-neutral suite, here and in Deno when it is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSuite } from './portable/suite.mjs';

test('portable suite on Node', () => {
  assert.deepEqual(runSuite(), []);
});

function has(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const runner = fileURLToPath(new URL('./portable/run.mjs', import.meta.url));
test('portable suite on Deno', { skip: has('deno') ? false : 'deno not installed' }, () => {
  assert.match(execFileSync('deno', ['run', '--allow-read', runner], { encoding: 'utf8' }), /ok/);
});
test('portable suite on Bun', { skip: has('bun') ? false : 'bun not installed' }, () => {
  assert.match(execFileSync('bun', [runner], { encoding: 'utf8' }), /ok/);
});

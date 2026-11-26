// xxHash's own sanity-test vectors, when present (they are not committed; see
// test/vectors/README.md). `npm run vectors:official` downloads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readOfficialVectors, sanityBuffer } from './official.mjs';
import { xxh32, xxh64, xxh3, xxh128, xxh3Secret } from '../dist/index.js';

const path = fileURLToPath(new URL('./vectors/official/sanity_test_vectors.h', import.meta.url));
const present = existsSync(path);

test('xxHash sanity_test_vectors.h', { skip: present ? false : 'not downloaded (npm run vectors:official)' }, () => {
  const tables = readOfficialVectors(path);
  const buffer = sanityBuffer(4096 + 64 + 1);
  // xsum_sanity_check.c: the secret is the sanity buffer from byte 7, XXH3_SECRET_SIZE_MIN + 11 bytes long.
  const secret = xxh3Secret(buffer.subarray(7, 7 + 136 + 11));
  const hex = (value, digits) => value.toString(16).padStart(digits, '0');
  const hashes = {
    XXH32: row => hex(xxh32(buffer.subarray(0, row.length), Number(row.seed)), 8),
    XXH64: row => hex(xxh64(buffer.subarray(0, row.length), row.seed), 16),
    XXH3: row => hex(xxh3(buffer.subarray(0, row.length), row.seed), 16),
    XXH3_withSecret: row => hex(xxh3(buffer.subarray(0, row.length), secret), 16),
    XXH128: row => hex(xxh128(buffer.subarray(0, row.length), row.seed), 32),
    XXH128_withSecret: row => hex(xxh128(buffer.subarray(0, row.length), secret), 32),
  };
  let checked = 0;
  for (const [name, rows] of Object.entries(tables)) {
    assert.ok(hashes[name], `unknown table ${name}`);
    for (const row of rows) {
      assert.equal(hashes[name](row), row.result, `${name} length ${row.length} seed ${row.seed.toString(16)}`);
      checked++;
    }
  }
  assert.ok(checked > 40000, `${checked} vectors`);
});

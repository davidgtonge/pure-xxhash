// Argument checking, result forms, and inputs from other realms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import * as xxhash from '../dist/index.js';

const { xxh32, xxh64, xxh64Pair, xxh3, xxh3Pair, xxh128, xxh128Pair, xxh3Secret, xxh32Create, xxh64Create, xxh3Create } = xxhash;
const bytes = new TextEncoder().encode('pure-xxhash');

test('known values for a short string', () => {
  // xxhsum -H0/-H1/-H3/-H2 of the 11 bytes "pure-xxhash"
  assert.equal(xxh32('pure-xxhash'), xxh32(bytes));
  assert.equal(xxh32(new Uint8Array(0)), 0x02cc5d05);
  assert.equal(xxh64(new Uint8Array(0)), 0xef46db3751d8e999n);
  assert.equal(xxh3(new Uint8Array(0)), 0x2d06800538d394c2n);
  assert.equal(xxh128(new Uint8Array(0)), 0x99aa06d3014798d86001c324468d497fn);
});

test('pair forms are the bigint split into unsigned halves', () => {
  for (const input of [new Uint8Array(0), bytes, new Uint8Array(1000).fill(255)]) {
    const wide = xxh64(input, 9n);
    assert.deepEqual(xxh64Pair(input, 9n), { high: Number(wide >> 32n), low: Number(wide & 0xffffffffn) });
    const three = xxh3(input, 9n);
    assert.deepEqual(xxh3Pair(input, 9n), { high: Number(three >> 32n), low: Number(three & 0xffffffffn) });
    const wider = xxh128(input, 9n);
    const word = shift => Number((wider >> BigInt(shift)) & 0xffffffffn);
    assert.deepEqual(xxh128Pair(input, 9n), { high: { high: word(96), low: word(64) }, low: { high: word(32), low: word(0) } });
  }
});

test('results are independent of the calls around them', () => {
  const first = xxh64(bytes);
  const pair = xxh3Pair(bytes);
  xxh128(new Uint8Array(500));
  assert.equal(xxh64(bytes), first);
  assert.deepEqual(xxh3Pair(bytes), pair);
  assert.equal(typeof first, 'bigint');
  assert.ok(first >= 0n && first < 1n << 64n);
});

test('seeds: numbers and bigints agree, and bad seeds are RangeErrors', () => {
  assert.equal(xxh64(bytes, 7), xxh64(bytes, 7n));
  assert.equal(xxh3(bytes, 2 ** 40), xxh3(bytes, 2n ** 40n));
  assert.equal(xxh128(bytes, Number.MAX_SAFE_INTEGER), xxh128(bytes, BigInt(Number.MAX_SAFE_INTEGER)));
  for (const seed of [-1, 0.5, 2 ** 32, NaN, Infinity, '1']) assert.throws(() => xxh32(bytes, seed), RangeError, `xxh32 seed ${seed}`);
  for (const seed of [-1, -1n, 1n << 64n, 0.5, 2 ** 53, NaN, '1', null]) {
    assert.throws(() => xxh64(bytes, seed), RangeError, `xxh64 seed ${String(seed)}`);
    assert.throws(() => xxh3(bytes, seed), seed === null ? TypeError : RangeError, `xxh3 seed ${String(seed)}`);
    assert.throws(() => xxh64Create(seed), RangeError);
  }
  assert.throws(() => xxh32Create(-1), RangeError);
  assert.throws(() => xxh3Create(1n << 64n), RangeError);
  assert.equal(xxh64(bytes, (1n << 64n) - 1n), xxh64(bytes, 0xffffffffffffffffn));
});

test('inputs: Uint8Array and its subclasses, other realms, strings; nothing else', () => {
  assert.equal(xxh3(Buffer.from(bytes)), xxh3(bytes));
  const foreign = runInNewContext('new Uint8Array([112, 117, 114, 101, 45, 120, 120, 104, 97, 115, 104])');
  assert.ok(!(foreign instanceof Uint8Array));
  assert.equal(xxh32(foreign), xxh32(bytes));
  assert.equal(xxh128(foreign), xxh128(bytes));
  for (const input of [[1, 2, 3], new Uint16Array(4), new ArrayBuffer(4), new DataView(new ArrayBuffer(4)), 42, null, undefined, {}]) {
    assert.throws(() => xxh32(input), TypeError);
    assert.throws(() => xxh64(input), TypeError);
    assert.throws(() => xxh3(input), TypeError);
    assert.throws(() => xxh128(input), TypeError);
  }
});

test('custom secrets: checked, copied, and only from xxh3Secret', () => {
  const secretBytes = new Uint8Array(192).map((_, index) => (index * 151 + 7) & 255);
  const secret = xxh3Secret(secretBytes);
  const before = xxh3(new Uint8Array(1000), secret);
  secretBytes.fill(0);
  assert.equal(xxh3(new Uint8Array(1000), secret), before, 'the secret is a copy');
  assert.notEqual(before, xxh3(new Uint8Array(1000)));
  assert.throws(() => xxh3Secret(new Uint8Array(135)), RangeError);
  assert.throws(() => xxh3Secret('a'.repeat(200)), TypeError);
  assert.throws(() => xxh3(bytes, { size: 192, words: [] }), TypeError);
  assert.throws(() => xxh128(bytes, { size: 100, words: new Int32Array(97) }), TypeError);
});

test('the package exports only functions, and no classes', () => {
  for (const [name, value] of Object.entries(xxhash)) {
    assert.equal(typeof value, 'function', name);
    assert.ok(!/^class\b/.test(Function.prototype.toString.call(value)), `${name} is not a class`);
  }
});

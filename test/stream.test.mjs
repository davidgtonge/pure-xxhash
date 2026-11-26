// Streaming must equal one-shot hashing however the input is split, and
// states must behave as immutable values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  xxh32, xxh32Create, xxh32Update, xxh32Digest,
  xxh64, xxh64Create, xxh64Update, xxh64Digest, xxh64DigestPair, xxh64Pair,
  xxh3, xxh3Create, xxh3Update, xxh3Digest, xxh3DigestPair, xxh3Pair,
  xxh128, xxh128Digest, xxh128DigestPair, xxh128Pair, xxh3Secret,
} from '../dist/index.js';

let state = 0x2545f491;
function random(limit) {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) % limit;
}
function randomBytes(length) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) bytes[index] = random(256);
  return bytes;
}

const secret = xxh3Secret(randomBytes(200));
const algorithms = [
  { name: 'xxh32', create: () => xxh32Create(0x9e3779b1), update: xxh32Update, digest: xxh32Digest, oneShot: bytes => xxh32(bytes, 0x9e3779b1) },
  { name: 'xxh64', create: () => xxh64Create(0xfedcba9876543210n), update: xxh64Update, digest: xxh64Digest, oneShot: bytes => xxh64(bytes, 0xfedcba9876543210n) },
  { name: 'xxh3', create: () => xxh3Create(0xfedcba9876543210n), update: xxh3Update, digest: xxh3Digest, oneShot: bytes => xxh3(bytes, 0xfedcba9876543210n) },
  { name: 'xxh128', create: () => xxh3Create(0xfedcba9876543210n), update: xxh3Update, digest: xxh128Digest, oneShot: bytes => xxh128(bytes, 0xfedcba9876543210n) },
  { name: 'xxh3 with a secret', create: () => xxh3Create(secret), update: xxh3Update, digest: xxh3Digest, oneShot: bytes => xxh3(bytes, secret) },
  { name: 'xxh128 with a secret', create: () => xxh3Create(secret), update: xxh3Update, digest: xxh128Digest, oneShot: bytes => xxh128(bytes, secret) },
];

function streamed(algorithm, bytes, sizes) {
  let current = algorithm.create();
  let position = 0;
  for (let index = 0; position < bytes.length; index++) {
    const size = sizes[index % sizes.length];
    current = algorithm.update(current, bytes.subarray(position, position + size));
    position += size;
  }
  return algorithm.digest(current);
}

for (const algorithm of algorithms) {
  test(`${algorithm.name}: every two-chunk split, 0–300 bytes`, () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytes(length);
      const expected = algorithm.oneShot(bytes);
      for (let split = 0; split <= length; split++) {
        let current = algorithm.update(algorithm.create(), bytes.subarray(0, split));
        current = algorithm.update(current, bytes.subarray(split));
        assert.equal(algorithm.digest(current), expected, `length ${length}, split at ${split}`);
      }
    }
  });

  test(`${algorithm.name}: every three-chunk split up to 70 bytes`, () => {
    for (const length of [17, 33, 64, 70]) {
      const bytes = randomBytes(length);
      const expected = algorithm.oneShot(bytes);
      for (let first = 0; first <= length; first++) {
        for (let second = first; second <= length; second++) {
          let current = algorithm.create();
          current = algorithm.update(current, bytes.subarray(0, first));
          current = algorithm.update(current, bytes.subarray(first, second));
          current = algorithm.update(current, bytes.subarray(second));
          assert.equal(algorithm.digest(current), expected, `length ${length}, splits ${first} ${second}`);
        }
      }
    }
  });

  test(`${algorithm.name}: 1-byte, block-sized and random chunks`, () => {
    for (const length of [0, 1, 255, 256, 257, 1000, 1024, 1025, 4097, 20000, 70001]) {
      const bytes = randomBytes(length);
      const expected = algorithm.oneShot(bytes);
      if (length <= 4097) assert.equal(streamed(algorithm, bytes, [1]), expected, `${length} bytes, 1-byte chunks`);
      for (const sizes of [[16], [31], [32], [63], [64], [240], [256], [257], [1024], [65536], [1, 255], [300, 7, 64]]) {
        assert.equal(streamed(algorithm, bytes, sizes), expected, `${length} bytes, chunks ${sizes}`);
      }
      for (let trial = 0; trial < 8; trial++) {
        const sizes = Array.from({ length: 6 }, () => 1 + random(trial < 4 ? 80 : 3000));
        assert.equal(streamed(algorithm, bytes, sizes), expected, `${length} bytes, chunks ${sizes}`);
      }
    }
  });

  test(`${algorithm.name}: states are immutable values`, () => {
    const prefix = randomBytes(700);
    const left = randomBytes(300);
    const right = randomBytes(5);
    const base = algorithm.update(algorithm.create(), prefix);
    const baseDigest = algorithm.digest(base);
    const viaLeft = algorithm.update(base, left);
    const viaRight = algorithm.update(base, right);
    assert.equal(algorithm.digest(base), baseDigest, 'updating did not change the old state');
    assert.equal(algorithm.digest(base), algorithm.oneShot(prefix));
    assert.equal(algorithm.digest(viaLeft), algorithm.oneShot(new Uint8Array([...prefix, ...left])));
    assert.equal(algorithm.digest(viaRight), algorithm.oneShot(new Uint8Array([...prefix, ...right])));
    assert.equal(algorithm.digest(viaRight), algorithm.digest(viaRight), 'digest leaves the state as it was');
    assert.equal(algorithm.update(base, new Uint8Array(0)), base, 'an empty update returns the same state');
  });

  test(`${algorithm.name}: a state keeps no reference to its input`, () => {
    const bytes = randomBytes(1500);
    const expected = algorithm.oneShot(bytes);
    for (const cut of [5, 100, 1000, 1499]) {
      const reused = bytes.slice(0, cut);
      const first = algorithm.update(algorithm.create(), reused);
      reused.fill(0xaa);
      assert.equal(algorithm.digest(algorithm.update(first, bytes.subarray(cut))), expected, `cut at ${cut}`);
    }
  });
}

test('streaming accepts strings, as UTF-8', () => {
  const text = 'stream ✓ 😀 '.repeat(50);
  const bytes = new TextEncoder().encode(text);
  assert.equal(xxh32Digest(xxh32Update(xxh32Update(xxh32Create(), text.slice(0, 13)), text.slice(13))), xxh32(bytes));
  assert.equal(xxh64Digest(xxh64Update(xxh64Create(), text)), xxh64(bytes));
  assert.equal(xxh3Digest(xxh3Update(xxh3Create(), text)), xxh3(bytes));
  assert.equal(xxh128Digest(xxh3Update(xxh3Create(), text)), xxh128(bytes));
});

test('pair digests match the one-shot pair forms', () => {
  for (const length of [0, 20, 200, 2000]) {
    const bytes = randomBytes(length);
    assert.deepEqual(xxh64DigestPair(xxh64Update(xxh64Create(3n), bytes)), xxh64Pair(bytes, 3n));
    assert.deepEqual(xxh3DigestPair(xxh3Update(xxh3Create(3n), bytes)), xxh3Pair(bytes, 3n));
    assert.deepEqual(xxh128DigestPair(xxh3Update(xxh3Create(3n), bytes)), xxh128Pair(bytes, 3n));
  }
});

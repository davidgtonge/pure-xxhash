// The generated vectors (test/vectors/README.md): every algorithm, seed and
// custom secret, at every length 0–300 and at large and odd sizes, as whole
// arrays, as unaligned subarrays, and in both result forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanityBuffer } from './official.mjs';
import { xxh32, xxh64, xxh64Pair, xxh3, xxh3Pair, xxh128, xxh128Pair, xxh3Secret } from '../dist/index.js';

const vectors = JSON.parse(readFileSync(new URL('./vectors/xxhash-vectors.json', import.meta.url), 'utf8'));
const buffer = sanityBuffer(1048577 + 64);
const hex = (value, digits) => value.toString(16).padStart(digits, '0');
const pairHex = pair => hex(pair.high, 8) + hex(pair.low, 8);

/** A key from the vectors file: a hex seed, or secretSIZE@OFFSET. */
function keyOf(key) {
  const secret = /^secret(\d+)@(\d+)$/.exec(key);
  if (!secret) return BigInt(`0x${key}`);
  const [size, offset] = [Number(secret[1]), Number(secret[2])];
  return xxh3Secret(buffer.slice(offset, offset + size));
}

/** The same bytes at a different alignment, as a subarray of a larger array. */
function unaligned(length, shift) {
  const holder = new Uint8Array(length + shift + 3);
  holder.set(buffer.subarray(0, length), shift);
  return holder.subarray(shift, shift + length);
}

const algorithms = {
  xxh32: { digits: 8, forms: [(input, seed) => xxh32(input, Number(seed))] },
  xxh64: { digits: 16, forms: [xxh64, (input, seed) => xxh64Pair(input, seed)] },
  xxh3: { digits: 16, forms: [xxh3, (input, seed) => xxh3Pair(input, seed)] },
  xxh128: { digits: 32, forms: [xxh128, (input, seed) => xxh128Pair(input, seed)] },
};

function render(result, digits) {
  if (typeof result === 'number' || typeof result === 'bigint') return hex(result, digits);
  if ('high' in result && typeof result.high === 'object') return pairHex(result.high) + pairHex(result.low);
  return pairHex(result);
}

for (const [name, { digits, forms }] of Object.entries(algorithms)) {
  test(`${name}: generated vectors`, () => {
    let checked = 0;
    for (const [key, hashes] of Object.entries(vectors.results[name])) {
      const seedOrSecret = keyOf(key);
      vectors.lengths.forEach((length, index) => {
        const input = buffer.subarray(0, length);
        for (const form of forms) {
          assert.equal(render(form(input, seedOrSecret), digits), hashes[index], `${name} ${key} length ${length}`);
          checked++;
        }
        // A seed that is a safe integer also works as a number.
        if (typeof seedOrSecret === 'bigint' && seedOrSecret <= BigInt(Number.MAX_SAFE_INTEGER) && name !== 'xxh32') {
          assert.equal(render(forms[0](input, Number(seedOrSecret)), digits), hashes[index], `${name} ${key} as a number`);
        }
      });
    }
    assert.ok(checked > 1000);
  });

  test(`${name}: unaligned subarrays give the same hashes`, () => {
    const hashes = vectors.results[name]['0'];
    vectors.lengths.forEach((length, index) => {
      if (length > 70000) return;
      for (const shift of [1, 2, 3, 5]) {
        assert.equal(render(forms[0](unaligned(length, shift), 0n), digits), hashes[index], `${name} length ${length} at offset ${shift}`);
      }
    });
  });
}

test('strings hash as their UTF-8 bytes', () => {
  const encoder = new TextEncoder();
  const pieces = ['a', 'Zz', 'é', 'ß', '€', '中文', '😀', '\ud800', 'x\udc00y', '\ud83d', '\u0000', '\u007f\u0080߿ࠀ￿'];
  const strings = [''];
  for (const length of [1, 7, 31, 63, 64, 65, 100, 240, 241, 1000, 4095, 4096, 4097, 5000, 20000]) {
    for (const piece of pieces) strings.push(piece.repeat(Math.ceil(length / piece.length)).slice(0, length));
    strings.push(Array.from({ length }, (_, index) => pieces[(index * 7) % pieces.length]).join('').slice(0, length));
  }
  for (const text of strings) {
    const bytes = encoder.encode(text);
    assert.equal(xxh32(text, 5), xxh32(bytes, 5), `xxh32 of a ${text.length}-unit string`);
    assert.equal(xxh64(text, 5n), xxh64(bytes, 5n));
    assert.equal(xxh3(text, 5n), xxh3(bytes, 5n));
    assert.equal(xxh128(text, 5n), xxh128(bytes, 5n));
  }
});

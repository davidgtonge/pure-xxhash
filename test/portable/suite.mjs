// A runtime-neutral check: no Node APIs, so it runs as is in Deno, Bun,
// workerd and browsers. Expected values are from xxHash 0.8.4 (C), seed 7,
// over bytes (i * 131 + 7) & 255.
import * as xxhash from '../../dist/index.js';

const expected = [
  [0, 'd7adaff8', '95f0626f6f0a4409', '913ae0873e9b7eb8', '76a30bdf56cdfa2ccb4aa04fe72c771f'],
  [5, '090cf529', 'a82ad9d395e93210', 'cebf8f21b18bbea5', 'dfa7f6cb84603738d7c9a23d5666aae1'],
  [16, '2f36a00e', 'df205676bb7d877c', 'd26595541d6a442d', '4f96569a4ed5205100b177268c5e62c0'],
  [100, '4fbbae49', '5734ab74bed9b5d6', 'a53b987cc4f7eb41', '7871cd5eef6432d36c5ac54eb771f1d6'],
  [240, '23f2c25e', 'a61e9a0bb607710c', '328d9b3964bb9438', '6372a1653641eec06212bf37b7d654df'],
  [1000, 'da38d795', 'f1fe030c99644f72', '96b56672548fd140', '728f06e95bcc83cc96b56672548fd140'],
  [3000, 'c62468e2', '8e91994ef520c63f', '98608ae2c94a482f', '0854c1a0cd6d109a98608ae2c94a482f'],
];

/** Returns a list of failures; empty when everything matches. */
export function runSuite() {
  const failures = [];
  const bytes = new Uint8Array(3000);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 131 + 7) & 255;
  const hex = (value, digits) => value.toString(16).padStart(digits, '0');
  for (const [length, h32, h64, h3, h128] of expected) {
    const input = bytes.subarray(0, length);
    const got = [hex(xxhash.xxh32(input, 7), 8), hex(xxhash.xxh64(input, 7n), 16), hex(xxhash.xxh3(input, 7n), 16), hex(xxhash.xxh128(input, 7n), 32)];
    [h32, h64, h3, h128].forEach((want, index) => {
      if (got[index] !== want) failures.push(`${['xxh32', 'xxh64', 'xxh3', 'xxh128'][index]} length ${length}: ${got[index]} != ${want}`);
    });
    let state = xxhash.xxh3Create(7n);
    for (let offset = 0; offset < length; offset += 97) state = xxhash.xxh3Update(state, input.subarray(offset, offset + 97));
    if (hex(xxhash.xxh128Digest(state), 32) !== h128) failures.push(`streamed xxh128 length ${length}`);
  }
  if (xxhash.xxh32('héllo') !== xxhash.xxh32(new TextEncoder().encode('héllo'))) failures.push('string input');
  return failures;
}

// Streaming adapters for bench.mjs: hash `input` in `chunk`-byte updates.
import { createRequire } from 'node:module';
import * as pure from '../dist/index.js';

const require = createRequire(import.meta.url);

export function streamers(libraries, algorithm) {
  const list = [];
  const updates = (input, chunk, start, update, digest) => {
    let state = start();
    for (let offset = 0; offset < input.length; offset += chunk) state = update(state, input.subarray(offset, offset + chunk));
    return digest(state);
  };
  const ours = {
    xxh32: [pure.xxh32Create, pure.xxh32Update, pure.xxh32Digest],
    xxh64: [pure.xxh64Create, pure.xxh64Update, pure.xxh64DigestPair],
    xxh3: [pure.xxh3Create, pure.xxh3Update, pure.xxh3DigestPair],
    xxh128: [pure.xxh3Create, pure.xxh3Update, pure.xxh128DigestPair],
  }[algorithm];
  list.push({ name: 'pure-xxhash', hash: (input, chunk) => updates(input, chunk, () => ours[0](), ours[1], ours[2]) });
  const names = libraries.map(library => library.name);
  if (names.includes('@node-rs/xxhash')) {
    const api = require('@node-rs/xxhash');
    const create = { xxh32: () => new api.Xxh32(), xxh64: () => new api.Xxh64(), xxh3: () => api.xxh3.Xxh3.withSeed() }[algorithm];
    if (create) list.push({ name: '@node-rs/xxhash', hash: (input, chunk) => updates(input, chunk, create, (hasher, part) => hasher.update(part), hasher => hasher.digest()) });
  }
  if (names.includes('xxhash-wasm')) {
    const library = libraries.find(entry => entry.name === 'xxhash-wasm');
    const create = { xxh32: () => library.api.create32(0), xxh64: () => library.api.create64(0n) }[algorithm];
    if (create) list.push({ name: 'xxhash-wasm', hash: (input, chunk) => updates(input, chunk, create, (hasher, part) => hasher.update(part), hasher => hasher.digest()) });
  }
  if (names.includes('hash-wasm')) {
    const library = libraries.find(entry => entry.name === 'hash-wasm');
    const hasher = library.hashers[algorithm];
    if (hasher) list.push({ name: 'hash-wasm', hash: (input, chunk) => updates(input, chunk, () => hasher.init(), (state, part) => state.update(part), state => state.digest('binary')) });
  }
  return list;
}

// The libraries bench.mjs compares, each behind the same small adapter per algorithm:
//   wrap(bytes)  -> the input in the form the library takes (a Buffer for
//                   xxhashjs and xxh3-ts), applied to every input, fresh ones included;
//   hash(input)  -> the library's result for seed 0, in its own form;
//   hex(result)  -> that result as canonical hex, for checking before timing.
// Libraries that aren't installed are skipped. Install them with:
//   npm install --no-save --package-lock=false xxhash-wasm xxhashjs hash-wasm @node-rs/xxhash xxh3-ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as pure from '../dist/index.js';

const require = createRequire(import.meta.url);

function optional(name) {
  try {
    const module = require(name);
    const manifest = new URL(`../node_modules/${name}/package.json`, import.meta.url);
    return { module, version: JSON.parse(readFileSync(manifest, 'utf8')).version };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

const same = bytes => bytes;
const asBuffer = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
const hex = digits => result => result.toString(16).padStart(digits, '0');
const pairHex = pair => pair.high.toString(16).padStart(8, '0') + pair.low.toString(16).padStart(8, '0');
const bytesHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const ownPackage = require('../package.json');

export async function loadLibraries() {
  const libraries = [{
    name: 'pure-xxhash', version: ownPackage.version, kind: 'JS',
    algorithms: {
      xxh32: { wrap: same, hash: pure.xxh32, hex: hex(8) },
      xxh64: { wrap: same, hash: pure.xxh64, hex: hex(16) },
      xxh3: { wrap: same, hash: pure.xxh3, hex: hex(16) },
      xxh128: { wrap: same, hash: pure.xxh128, hex: hex(32) },
    },
  }, {
    name: 'pure-xxhash (pair)', version: ownPackage.version, kind: 'JS',
    algorithms: {
      xxh64: { wrap: same, hash: pure.xxh64Pair, hex: pairHex },
      xxh3: { wrap: same, hash: pure.xxh3Pair, hex: pairHex },
      xxh128: { wrap: same, hash: pure.xxh128Pair, hex: pair => pairHex(pair.high) + pairHex(pair.low) },
    },
  }];

  const wasm = optional('xxhash-wasm');
  if (wasm) {
    const api = await wasm.module();
    libraries.push({
      name: 'xxhash-wasm', version: wasm.version, kind: 'WASM', api,
      algorithms: {
        xxh32: { wrap: same, hash: bytes => api.h32Raw(bytes, 0), hex: hex(8) },
        xxh64: { wrap: same, hash: bytes => api.h64Raw(bytes, 0n), hex: hex(16) },
      },
    });
  }

  const hashWasm = optional('hash-wasm');
  if (hashWasm) {
    // The one-shot functions return promises; the hasher objects are the sync API.
    const [hasher32, hasher64, hasher3, hasher128] = await Promise.all([
      hashWasm.module.createXXHash32(0), hashWasm.module.createXXHash64(0, 0),
      hashWasm.module.createXXHash3(0, 0), hashWasm.module.createXXHash128(0, 0),
    ]);
    const viaHasher = hasher => bytes => hasher.init().update(bytes).digest('binary');
    libraries.push({
      name: 'hash-wasm', version: hashWasm.version, kind: 'WASM',
      hashers: { xxh32: hasher32, xxh64: hasher64, xxh3: hasher3, xxh128: hasher128 },
      algorithms: {
        xxh32: { wrap: same, hash: viaHasher(hasher32), hex: bytesHex },
        xxh64: { wrap: same, hash: viaHasher(hasher64), hex: bytesHex },
        xxh3: { wrap: same, hash: viaHasher(hasher3), hex: bytesHex },
        xxh128: { wrap: same, hash: viaHasher(hasher128), hex: bytesHex },
      },
    });
  }

  const native = optional('@node-rs/xxhash');
  if (native) {
    const api = native.module;
    libraries.push({
      name: '@node-rs/xxhash', version: native.version, kind: 'native',
      algorithms: {
        xxh32: { wrap: same, hash: bytes => api.xxh32(bytes), hex: hex(8) },
        xxh64: { wrap: same, hash: bytes => api.xxh64(bytes), hex: hex(16) },
        xxh3: { wrap: same, hash: bytes => api.xxh3.xxh64(bytes), hex: hex(16) },
        xxh128: { wrap: same, hash: bytes => api.xxh3.xxh128(bytes), hex: hex(32) },
      },
    });
  }

  const xxhashjs = optional('xxhashjs');
  if (xxhashjs) {
    const api = xxhashjs.module;
    libraries.push({
      name: 'xxhashjs', version: xxhashjs.version, kind: 'JS',
      algorithms: {
        xxh32: { wrap: asBuffer, hash: buffer => api.h32(buffer, 0).toNumber(), hex: hex(8) },
        xxh64: { wrap: asBuffer, hash: buffer => api.h64(buffer, 0), hex: result => result.toString(16).padStart(16, '0') },
      },
    });
  }

  const xxh3ts = optional('xxh3-ts');
  if (xxh3ts) {
    const api = xxh3ts.module;
    libraries.push({
      name: 'xxh3-ts', version: xxh3ts.version, kind: 'JS, BigInt',
      algorithms: {
        xxh64: { wrap: asBuffer, hash: buffer => api.XXH64(buffer, 0n), hex: hex(16) },
        xxh128: { wrap: asBuffer, hash: buffer => api.XXH3_128(buffer, 0n), hex: hex(32) },
      },
    });
  }
  return libraries;
}

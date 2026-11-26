# pure-xxhash

xxHash (XXH32, XXH64, XXH3-64 and XXH3-128) for JavaScript and TypeScript, with two promises:

1. **Clean, functional code.** Pure functions over explicit state, in the spirit of OCaml: no classes, streaming states that are immutable values, and no state kept between calls apart from a few documented scratch registers and one cached derived secret. About 1,400 lines of strict TypeScript, with no runtime dependencies, no Node APIs and no generated code (CSP-safe).
2. **The fastest pure-JS xxHash.** No WASM and no native addon, so it runs where those aren't allowed: browsers with a strict CSP, web workers, edge runtimes. It is 13–90× faster than xxhashjs and 6–62× faster than xxh3-ts, the other pure-JS libraries. Against WASM and native code, XXH32 is ahead or level at every size (1.02–3.5×), and small inputs from a fresh buffer hash 4–13× faster than with hash-wasm or the native addon. It isn't ahead everywhere: XXH64 is 2–7× slower than WASM from 64 bytes up, and XXH3 2–2.5× slower than hash-wasm from 4 KiB. Details below and in [BENCHMARK.md](BENCHMARK.md).

It was written for [pure-lz4](https://github.com/davidgtonge/pure-lz4), whose frame format checksums with XXH32, and is checked against 9,280 generated vectors that four reference implementations agree on, and against xxHash's own 45,771 sanity-test vectors.

## Why pure-xxhash

- **Runs anywhere.** Pure JavaScript, with no WASM, no native addon, no `eval` or `new Function`, and no Node APIs. Strict-CSP pages, web workers and edge runtimes can all use it, and nothing needs compiling or loading before the first hash.
- **Fast where messages are small.** A Uint8Array that has just arrived costs hash-wasm and the native addon about 0.4 µs before they can read it (V8 moves its bytes off the JS heap); pure-xxhash reads it in place, as xxhash-wasm nearly does. Hashing 16 bytes from a fresh buffer takes 37–121 ns, against 470–490 ns for hash-wasm and @node-rs/xxhash.
- **Fast enough where they're large.** XXH32 is ahead of or level with every library measured at every size, WASM and native included. XXH3 runs at 5.2 GB/s, ahead of the native addon and behind hash-wasm. XXH64 is the weak spot (below).
- **Checked.** Four reference implementations agree on its 9,280 generated vectors, and it passes xxHash's own 45,771 sanity-test vectors.
- **Small to load, small to read.** 1.5 KB gzipped for XXH32 alone (what pure-lz4 needs), 8.0 KB for everything, and about 1,400 lines of strict TypeScript.

### Speed

Throughput in GB/s, the same input every call; higher is better. "Best other" is the fastest other library at that size (WASM or native unless noted).

| Size | XXH32 | best other | XXH64 | best other | XXH3-64 | best other | XXH3-128 | best other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B | **1.81** | 0.51 | 0.40 | 0.41 | **0.37** | 0.22 | **0.18** | 0.12 |
| 64 B | **2.35** | 1.99 | 0.74 | 1.49 | **0.82** | 0.62 | **0.58** | 0.47 |
| 256 B | **6.20** | 5.69 | 1.74 | 4.53 | 1.32 | 1.79 | 1.06 | 1.52 |
| 4 KiB | 10.32 | 10.08 | 3.05 | 17.49 | 4.31 | 8.83 | 4.22 | 9.07 |
| 64 KiB | **11.37** | 10.63 | 3.36 | 23.91 | 5.11 | 13.59 | 5.15 | 13.37 |
| 1 MiB | **11.59** | 10.14 | 3.33 | 24.69 | 5.20 | 13.14 | 5.17 | 12.53 |

Latency from a fresh buffer (a new copy every call, like a just-received message; the copy alone takes 33 ns and is included for everyone). Lower is better.

| Input | pure-xxhash | xxhash-wasm | hash-wasm | @node-rs/xxhash | xxhashjs | xxh3-ts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XXH32, 16 B | **37 ns** | 55 ns | 487 ns | 483 ns | 556 ns | – |
| XXH32, 64 B | **54 ns** | 58 ns | 483 ns | 468 ns | 584 ns | – |
| XXH64, 16 B | 75 ns | **66 ns** | 469 ns | 480 ns | 1,963 ns | 621 ns |
| XXH64, 64 B | 118 ns | **72 ns** | 469 ns | 469 ns | 3,980 ns | 1,531 ns |
| XXH3-64, 16 B | **80 ns** | – | 484 ns | 476 ns | – | – |
| XXH3-64, 64 B | **106 ns** | – | 477 ns | 458 ns | – | – |
| XXH3-128, 16 B | **121 ns** | – | 473 ns | 475 ns | – | 760 ns |
| XXH3-128, 64 B | **140 ns** | – | 483 ns | 496 ns | – | 1,666 ns |

From 256 bytes up, copying the input costs as much as hashing it (V8 allocates arrays over 64 bytes off-heap, ~0.5 µs), so all libraries are level there.

**Where it loses, plainly:**
- **XXH64 beyond 16 bytes:** WASM is 2× faster at 64 bytes and 5–7× faster from 4 KiB (xxhash-wasm 18 GB/s, @node-rs/xxhash 25 GB/s, pure-xxhash 3.3 GB/s). Each 8 bytes needs two 64 × 64-bit multiplies, 14 `Math.imul`s and their carries in 32-bit JavaScript, against one instruction each in WASM. From a fresh buffer xxhash-wasm is also faster (66 against 75 ns at 16 bytes), because it copies input into its own memory without touching `.buffer`.
- **XXH3 from 256 bytes:** @node-rs/xxhash is 1.36× faster at 256 bytes; hash-wasm is 2× faster at 4 KiB and 2.5× faster at 1 MiB. pure-xxhash stays 1.25–1.45× ahead of the native addon from 4 KiB up.
- **Streaming in small updates:** each update allocates a new state (about 100–250 ns). In 64-byte updates WASM hashers, which mutate in place, are 1.2–2.1× faster; with 64 KiB updates (an LZ4 block) streaming costs the same as one-shot hashing. See [BENCHMARK.md](BENCHMARK.md#streaming).

Against the other pure-JS libraries it is 13–90× faster than xxhashjs and 6–62× faster than xxh3-ts.

**How this was measured:**
- pure-xxhash 0.1.0 on Node 22.19, Apple M4, macOS 15, 26 November 2026. xxhash-wasm 1.1.0, hash-wasm 4.13.0, @node-rs/xxhash 1.7.8 (native), xxhashjs 0.2.2, xxh3-ts 3.0.0, each with seed 0 and checked against pure-xxhash's result first.
- Each workload runs in its own process; within it, each library's median of 5 rounds of 100 ms. The tables are the median of three full runs.
- The machine was shared: load average 2.1–2.8 during these runs, after other benchmarks had finished. Two earlier runs, made while the machine was busier, measured every library (and the plain copy) about 1.9× slower, with the same ratios between them; they're kept in `bench/results` but not used. Treat differences under about ±10% as level.
- Everything, including streaming and the choice of DataView, is in [BENCHMARK.md](BENCHMARK.md).

### When another library fits better

- **XXH64 or XXH3 over large inputs, where WASM is allowed:** hash-wasm (all four algorithms) or xxhash-wasm (XXH32 and XXH64) are 2.5–7× faster from a few KiB up. On Node, @node-rs/xxhash is fastest for XXH64 (25 GB/s).
- **Smallest bundle:** xxhash-wasm is 1.5 KB gzipped for XXH32 and XXH64, its WASM inlined. pure-xxhash is 1.5 KB for XXH32 alone and 8.0 KB for all four algorithms.
- **Many tiny streaming updates:** a WASM hasher's mutable state beats pure-xxhash's immutable one.

### Compared with other xxHash libraries

| Library | Version | Kind | Algorithms | Runtime dependencies | Minified + gzip |
| --- | --- | --- | --- | --- | ---: |
| **pure-xxhash** | 0.1.0 | pure JS | XXH32, XXH64, XXH3-64, XXH3-128 | none | 8.0 KB (1.5 KB for XXH32 alone) |
| xxhash-wasm | 1.1.0 | WASM (inlined) | XXH32, XXH64 | none | 1.5 KB |
| hash-wasm | 4.13.0 | WASM (inlined) | all four, and many other hashes | none | 80 KB for the whole package |
| @node-rs/xxhash | 1.7.8 | native addon | all four | a prebuilt binary per platform (13 optional packages) | – (Node only) |
| xxhashjs | 0.2.2 | pure JS | XXH32, XXH64 | `cuint` | 4.3 KB, needs `Buffer` |
| xxh3-ts | 3.0.0 | pure JS, BigInt | XXH64, XXH3-128 | none (needs `Buffer`) | 11 KB |

Sizes: each package's whole public API (`export * from …`) bundled with esbuild 0.25 as minified ESM, then gzip -9.


## Install

```sh
npm install pure-xxhash
```

Plain ESM with TypeScript declarations, needing only ES2020 (BigInt) and `TextEncoder`. Tested in CI on Node 22, 24 and the latest release, Deno, Bun, workerd, and Chromium, Firefox and WebKit, both on the page and in web workers.

## Usage

```ts
import { xxh32, xxh64, xxh64Pair, xxh3, xxh128 } from 'pure-xxhash';

xxh32('hello');                     // 4211111929: an unsigned 32-bit number
xxh32(bytes, 0x9e3779b1);           // any Uint8Array (or Buffer), any subarray; a uint32 seed
xxh64(bytes);                       // 64-bit hashes are bigints...
xxh64Pair(bytes);                   // ...or { high, low } uint32 halves, with no bigint
xxh3(bytes, 42n);                   // 64-bit seeds: a bigint, or a safe nonnegative integer
xxh128(bytes).toString(16).padStart(32, '0'); // canonical hex, as xxhsum prints it
```

Strings are hashed as their UTF-8 bytes, with `TextEncoder`'s handling of lone surrogates (each becomes U+FFFD), so `xxh3(text) === xxh3(new TextEncoder().encode(text))`.

### Streaming

```ts
import { xxh32Create, xxh32Update, xxh32Digest } from 'pure-xxhash';

let state = xxh32Create(0);
for await (const chunk of stream) state = xxh32Update(state, chunk);
const checksum = xxh32Digest(state);
```

Every algorithm has the same three functions: `xxh32Create` / `xxh32Update` / `xxh32Digest`, `xxh64Create` / … / `xxh64Digest` (and `xxh64DigestPair`), and `xxh3Create` / `xxh3Update`, whose state digests as XXH3-64 (`xxh3Digest`, `xxh3DigestPair`) or XXH3-128 (`xxh128Digest`, `xxh128DigestPair`), as in the C library.

**States are immutable values.** `update` returns a new state and never changes the one it was given, and `digest` changes nothing, so a state can be kept, digested at any point, or updated along two branches:

```ts
const header = xxh3Update(xxh3Create(), commonPrefix);    // hash the prefix once
const first = xxh3Digest(xxh3Update(header, bodyA));
const second = xxh3Digest(xxh3Update(header, bodyB));
```

What a state holds, and what that costs:
- A state is a plain record: the seed, the length so far, the accumulators (a small `Int32Array`), and the bytes not yet consumed (at most 15 for XXH32, 31 for XXH64, and 64 for XXH3 after its first 256 bytes). It shares no memory with your input, so you can reuse an input buffer as soon as `update` returns.
- Its typed arrays are never written after the state is built. They aren't frozen (typed arrays can't be), so don't write to them yourself.
- The price of immutability is a few small allocations per update: about 130 ns for XXH32, 170 ns for XXH64 and 260 ns for XXH3. With 64 KiB updates (an LZ4 block) streaming is as fast as one-shot hashing; with 4 KiB updates it is about a third slower; with 64-byte updates WASM hashers, which mutate in place, are 1.2–2.1× faster (see [BENCHMARK.md](BENCHMARK.md#streaming)).

### LZ4 frame checksums

The [LZ4 frame format](https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md) uses XXH32 with seed 0 three ways; `test/lz4.test.mjs` checks all three against frames written by the `lz4` tool:

```ts
import { xxh32, xxh32Create, xxh32Update, xxh32Digest } from 'pure-xxhash';

// Header checksum: the second byte of the XXH32 of the descriptor (FLG through
// the optional content size and dictionary ID, not the magic number).
const headerChecksum = (xxh32(frame.subarray(4, descriptorEnd), 0) >>> 8) & 0xff;

// Block checksum (FLG bit 4): the XXH32 of the block's data as stored, compressed or not.
const blockChecksum = xxh32(frame.subarray(blockStart, blockEnd), 0);

// Content checksum (FLG bit 2): the XXH32 of the decompressed content, streamed block by block.
let content = xxh32Create(0);
for (const block of decompressedBlocks) content = xxh32Update(content, block);
const contentChecksum = xxh32Digest(content);   // compare with the 4 little-endian bytes after the EndMark
```

Results are unsigned (`0` to `0xffffffff`), so compare them with a stored checksum read as unsigned too: `(b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0`.

### Custom secrets (XXH3)

```ts
import { xxh3, xxh128, xxh3Create, xxh3Secret } from 'pure-xxhash';

const secret = xxh3Secret(secretBytes);   // at least 136 bytes; copied and prepared once
xxh3(bytes, secret);
xxh128(bytes, secret);
xxh3Create(secret);
```

The second argument of `xxh3`, `xxh128` and `xxh3Create` is a seed or a secret, as with `XXH3_64bits_withSeed` and `XXH3_64bits_withSecret`. A secret should be high-entropy; xxHash's documentation explains what that means.

## Result forms

| Algorithm | Default | Cheap form |
| --- | --- | --- |
| XXH32 | `number` (uint32) | — |
| XXH64, XXH3-64 | `bigint` | `{ high, low }`: two uint32 numbers (`Uint64Pair`) |
| XXH3-128 | `bigint` | `{ high: Uint64Pair, low: Uint64Pair }` (`Uint128Pair`) |

**Why a pair, not a hex string.** The brief allowed either. Measured on this machine, making a bigint from two halves costs 23 ns (by reading a `BigUint64Array` that aliases the two words) and a pair object about 5 ns, while the fastest hex string tried cost 73 ns: `toString(16)` and `padStart` cost 350 ns, and a lookup table 93–109 ns. A hex string would have been the most expensive form, not the cheap one. For canonical hex, `xxh64(bytes).toString(16).padStart(16, '0')`.

In practice the bigint costs little: the benchmarks time both forms, and for the 64-bit hashes they're within noise of each other (V8 often removes the pair's allocation, and sometimes doesn't). For XXH3-128, whose bigint is built from two, the pair saves about 10 ns per small hash. The pair is mainly for code that wants numbers, such as a hash-table index from `low`, without BigInt.

## How it's built

- **One job per file.** `input.ts` (strings and argument checks), `words.ts` (where words are read from), `uint64.ts` (64-bit halves), and per algorithm a one-shot file and a streaming file; XXH3's secret, long-input loop and shared mixing steps each have their own.
- **No BigInt arithmetic.** 64-bit values are pairs of int32 halves. Multiplies use `Math.imul` for the low half, and for the high half of a 32 × 32-bit product, (a × b − low) × 2^-32 rounded: the double product is within 2^12 of the exact one, so the rounding is exact. Carries are computed from bits, `((a & b) | ((a | b) & ~sum)) >>> 31`: written as a comparison, V8 branched on it, and the unpredictable branch cost more than half of XXH64's time.
- **Reading words.** Large inputs are read through a DataView, one load per word and about 3.3× faster than four byte loads. Making a DataView costs about 65 ns, and on a Uint8Array of 64 bytes or less (which V8 keeps on the JS heap) the first `.buffer` access costs about 900 ns more, as pure-cbor found. So inputs up to 1 KiB are copied into a scratch area that already has a view (`set` copies 256 bytes in about 16 ns), and short tails are read with byte loads. The measurements are in [BENCHMARK.md](BENCHMARK.md#reading-words).
- **XXH3's long loop** never works out a carry per stripe. Each accumulator gathers its additions in three running sums (weights 1, 2^16 and 2^32) that stay exact in a double for 16 stripes, and folds them into 64 bits once per call.
- **Hot loops are spelled out.** V8 inlines only within a bytecode budget per function, and an int32 passed to a call that wasn't inlined gets boxed. So the stripe loops and short-input paths are written out in full, with names for every intermediate.

**State kept between calls.** No hash keeps anything between calls except:
- scratch areas used within one synchronous call and never returned: the string and small-input scratch (12 KiB, with its DataView), the accumulator arrays of the stripe loops, and the result registers through which a 64- or 128-bit result comes back (an `Int32Array` holds int32s unboxed, which a returned object or a module variable would not);
- the last seed's derived XXH3 secret (XXH3 hashes inputs over 240 bytes with a secret derived from the seed), an immutable 189-word table, so a run of long inputs with one seed derives it once.

## API

| Function | Returns |
| --- | --- |
| `xxh32(input, seed = 0)` | `number`: the XXH32, unsigned |
| `xxh64(input, seed = 0)` / `xxh64Pair` | `bigint` / `Uint64Pair` |
| `xxh3(input, seedOrSecret = 0)` / `xxh3Pair` | XXH3-64: `bigint` / `Uint64Pair` |
| `xxh128(input, seedOrSecret = 0)` / `xxh128Pair` | XXH3-128: `bigint` / `Uint128Pair` |
| `xxh3Secret(bytes)` | `Xxh3Secret`: a prepared custom secret (at least 136 bytes) |
| `xxh32Create(seed)`, `xxh32Update(state, input)`, `xxh32Digest(state)` | Streaming XXH32 |
| `xxh64Create(seed)`, `xxh64Update`, `xxh64Digest`, `xxh64DigestPair` | Streaming XXH64 |
| `xxh3Create(seedOrSecret)`, `xxh3Update`, `xxh3Digest`, `xxh3DigestPair`, `xxh128Digest`, `xxh128DigestPair` | Streaming XXH3-64 and XXH3-128 |

- **Inputs:** a `Uint8Array` (including a `Buffer`, a subarray at any offset, or one from another realm) or a string. Anything else is a `TypeError`.
- **Seeds:** XXH32 takes an integer from 0 to 0xffffffff. The others take a bigint from 0 to 2^64 − 1, or a safe nonnegative integer. Anything else is a `RangeError` rather than silently wrapped: a seed is part of the hash, and a wrapped one gives a different hash without warning. The only errors thrown are `TypeError` and `RangeError`.
- Inputs must not change during a call.

## Correctness

- **Generated vectors** ([test/vectors](test/vectors/README.md)): 9,280 results at every length from 0 to 300 and at sizes up to 1 MiB + 1, with six seeds (five for XXH32) and three custom secrets. xxHash 0.8.4 (C), the xxHash 0.6.5 bundled with lz4, the Rust crate twox-hash 2.1.2 and the `xxhsum` tool all agree on them. They're checked in both result forms, and on subarrays at offsets 1, 2, 3 and 5.
- **xxHash's sanity-test vectors:** all 45,771 pass (downloaded by `npm run vectors:official`; not committed, see the vectors README).
- **Streaming:** for every length from 0 to 300, every split into two chunks; every split into three for several lengths; 1-byte chunks; and random chunkings up to 70 KB. Each must equal the one-shot hash, for all four algorithms, seeded and with a custom secret. Separate tests check that updates never change the state they're given and that states don't alias their input.
- **LZ4:** header, block and content checksums of frames written by `lz4` 1.10.0.

```sh
npm test        # build, then node --test
npm run lint    # tsc --noEmit with the strict extras, then oxlint
```

## Not yet

- **Faster XXH64 beyond 16 bytes.** It runs at 3.3 GB/s, against 18–25 GB/s for WASM and native code. Its two 64 × 64-bit multiplies per 8 bytes cost 14 `Math.imul`s; 16-bit limbs, float high halves, and one lane per pass all measured the same or slower.
- **XXH3 at large sizes** (5.2 GB/s) trails hash-wasm's 13 GB/s.
- **Streaming with small updates:** an immutable state costs an allocation or two per update. A mutable hasher, as an explicit opt-in, would help callers who feed bytes a few at a time.
- **XXH3 with a seed and a secret together** (`XXH3_64bits_withSecretandSeed`), and `XXH3_generateSecret`.
- **Canonical byte forms** (`XXH64_canonicalFromHash`) and comparison helpers.

## Licence

MIT. xxHash is by Yann Collet; the algorithms and the default XXH3 secret come from its reference implementation (BSD 2-Clause).

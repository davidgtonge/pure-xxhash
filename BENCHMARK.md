# pure-xxhash benchmarks

pure-xxhash 0.1.0 against every xxHash library for JavaScript that installed cleanly, measured on 26 November 2026.

**Machine.** Apple M4 (macOS 15, arm64, 10 cores), Node v22.19.0. The machine was shared: other benchmarks (pure-cbor, pure-lz4, pure-cose) ran on it earlier in the day. They had finished before these runs, but the load average stayed between 2.1 and 2.8; it's recorded for each run below. Treat differences under about ±10% as level.

**Two runs set aside.** Five full runs were made between 06:37 and 06:52 UTC. In the first one and a half, every library, and the plain copy of the input, measured about 1.9× slower than in the rest, with the same ratios between libraries (most likely the process was scheduled on the efficiency cores while the machine was busier). The tables use the three later runs, which agree with each other within 15% in every cell but two (pure-xxhash's XXH32 at 64 bytes and XXH3-128 from a fresh 256-byte buffer, each with one outlying run; the median sets it aside). All five result files are in `bench/results` (`slow-run-*.json` are the two set aside).

**Libraries** (installed with `npm install --no-save`):

| Library | Version | Kind | Algorithms |
| --- | --- | --- | --- |
| **pure-xxhash** | 0.1.0 | pure JS | XXH32, XXH64, XXH3-64, XXH3-128 |
| xxhash-wasm | 1.1.0 | WASM | XXH32, XXH64 |
| hash-wasm | 4.13.0 | WASM | all four (its synchronous hasher objects: `init().update(bytes).digest('binary')`; its one-shot functions return promises) |
| @node-rs/xxhash | 1.7.8 | native addon (Rust, N-API) | all four |
| xxhashjs | 0.2.2 | pure JS (`cuint` objects) | XXH32, XXH64 |
| xxh3-ts | 3.0.0 | pure JS (BigInt arithmetic) | XXH64, XXH3-128 (it has no XXH3-64) |

xxhashjs and xxh3-ts take a Node `Buffer`, so they're given a Buffer view of the same bytes (made outside the timing, except for fresh inputs, where the view is part of each call).

**Method:**
- Each workload (one algorithm, one size, one mode) runs in its **own Node process**, as in pure-cbor: workloads sharing a process skew each other's V8 type feedback.
- Within a workload every library is timed in turn: a warm-up, then 5 rounds of 100 ms, and the median round.
- Before timing, every library's result is checked against pure-xxhash's, with seed 0.
- The tables show the median, cell by cell, of three full runs.
- **Throughput** (GB/s, 10^9 bytes per second): the same input every call.
- **Fresh buffer:** a new copy of the input every call, like a just-received message. The copy is included for every library, and its own cost is the "copy only" column.
- **Streaming:** 1 MiB fed in updates of the given size, through each library's incremental API, then digested.
- pure-xxhash's 64- and 128-bit hashes are timed in both result forms: the bigint (`xxh64`) and the pair of uint32 halves (`xxh64Pair`).

Reproduce:

```sh
npm install --no-save --package-lock=false xxhash-wasm xxhashjs hash-wasm @node-rs/xxhash xxh3-ts
BENCH_MS=100 BENCH_ROUNDS=5 npm run bench     # one run; writes bench/last-results.json
node bench/report.mjs run1.json run2.json run3.json   # medians of several runs
```

## Reading the results

- **XXH32 is level with or ahead of everything**, WASM and native included: 3.5× faster than xxhash-wasm at 16 bytes, 1.02–1.18× from 64 bytes to 4 KiB (level at 4 KiB), 1.07–1.14× from 64 KiB. The stripe loop is four `Math.imul` pairs, four rotates and four DataView loads per 16 bytes, which V8 compiles about as well as WASM does.
- **XXH64 is where pure JS pays for 32-bit arithmetic.** Level with xxhash-wasm at 16 bytes; from 64 bytes WASM is 2× faster, from 4 KiB 5–7× faster. Each 8 bytes needs two 64 × 64-bit multiplies (14 `Math.imul`s with their carries). Other formulations tried measured the same or slower: 16-bit limbs for every partial product, float high halves throughout, and one lane per pass to cut register pressure.
- **XXH3 is faster than XXH64 in JavaScript,** as its design intends: its inner loop needs only 32 × 32-bit products. pure-xxhash is ahead of hash-wasm and the native addon up to 64 bytes, behind both at 256 bytes, then 1.3–1.4× ahead of the native addon and 2–2.5× behind hash-wasm from 4 KiB.
- **Fresh buffers.** hash-wasm and @node-rs/xxhash take about 0.45 µs to start on a Uint8Array that has just been allocated (V8 moves a small array's bytes off the JS heap when its `.buffer` is first read). xxhash-wasm avoids most of that by copying input into its memory with `set`, and pure-xxhash by never reading `.buffer` for inputs up to 1 KiB. From 256 bytes, allocating the copy itself costs about as much as hashing (V8 allocates arrays over 64 bytes off-heap), so every library is level.
- **Bigint against pair.** For XXH64 and XXH3-64 the two result forms are within noise of each other: making the bigint takes about 20 ns (by reading a `BigUint64Array` that aliases two words), and V8 usually removes the pair's allocation. For XXH3-128 the pair is about 10 ns faster on small inputs.
- **@node-rs/xxhash** is the fastest XXH64 (25 GB/s), but has a call cost of 60–70 ns even on a reused buffer, and its XXH3 is slower than pure-xxhash's from 4 KiB.

## Results

Node v22.19.0, darwin/arm64, Apple M4; 3 full runs, 2026-11-26T06:43, 2026-11-26T06:46, 2026-11-26T06:49 UTC.
Load average (1, 5, 15 min) at the start and end of each run: 2.75 2.13 2.37 → 2.37 2.28 2.39; 2.10 2.22 2.37 → 2.83 2.45 2.43; 2.83 2.45 2.43 → 2.30 2.39 2.40.


#### xxh32: throughput, GB/s (same input every call; higher is better)

| Size | pure-xxhash | xxhash-wasm | hash-wasm | @node-rs/xxhash | xxhashjs |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 B | 1.81 | 0.51 | 0.13 | 0.26 | 0.060 |
| 64 B | 2.35 | 1.99 | 0.52 | 0.92 | 0.20 |
| 256 B | 6.20 | 5.69 | 1.88 | 2.65 | 0.51 |
| 4 KiB | 10.32 | 10.08 | 8.34 | 6.19 | 0.88 |
| 64 KiB | 11.37 | 10.28 | 10.63 | 6.90 | 0.92 |
| 1 MiB | 11.59 | 9.96 | 10.14 | 6.92 | 0.88 |

#### xxh32: latency from a fresh buffer (a new copy every call, copy included; lower is better)

| Size | pure-xxhash | xxhash-wasm | hash-wasm | @node-rs/xxhash | xxhashjs | copy only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B | 37 ns | 55 ns | 487 ns | 483 ns | 556 ns | 33 ns |
| 64 B | 54 ns | 58 ns | 483 ns | 468 ns | 584 ns | 32 ns |
| 256 B | 486 ns | 470 ns | 495 ns | 463 ns | 770 ns | 491 ns |

#### xxh32: streaming 1 MiB in fixed-size updates, time per MiB (lower is better)

| Update size | pure-xxhash | @node-rs/xxhash | xxhash-wasm | hash-wasm |
| --- | ---: | ---: | ---: | ---: |
| 64 B | 1627 µs | 3408 µs | 1392 µs | 1441 µs |
| 4 KiB | 123 µs | 228 µs | 126 µs | 119 µs |
| 64 KiB | 91 µs | 179 µs | 110 µs | 103 µs |

#### xxh64: throughput, GB/s (same input every call; higher is better)

| Size | pure-xxhash | pure-xxhash (pair) | xxhash-wasm | hash-wasm | @node-rs/xxhash | xxhashjs | xxh3-ts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B | 0.40 | 0.41 | 0.41 | 0.12 | 0.22 | 0.0092 | 0.049 |
| 64 B | 0.74 | 0.75 | 1.49 | 0.50 | 0.86 | 0.017 | 0.049 |
| 256 B | 1.74 | 1.67 | 4.53 | 1.91 | 3.25 | 0.028 | 0.079 |
| 4 KiB | 3.05 | 3.10 | 16.43 | 12.52 | 17.49 | 0.035 | 0.10 |
| 64 KiB | 3.36 | 3.35 | 16.46 | 18.72 | 23.91 | 0.036 | 0.10 |
| 1 MiB | 3.33 | 3.34 | 18.11 | 17.81 | 24.69 | 0.037 | 0.10 |

#### xxh64: latency from a fresh buffer (a new copy every call, copy included; lower is better)

| Size | pure-xxhash | pure-xxhash (pair) | xxhash-wasm | hash-wasm | @node-rs/xxhash | xxhashjs | xxh3-ts | copy only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B | 75 ns | 78 ns | 66 ns | 469 ns | 480 ns | 1963 ns | 621 ns | 34 ns |
| 64 B | 118 ns | 109 ns | 72 ns | 469 ns | 469 ns | 3980 ns | 1531 ns | 31 ns |
| 256 B | 470 ns | 486 ns | 488 ns | 498 ns | 455 ns | 9485 ns | 3505 ns | 426 ns |

#### xxh64: streaming 1 MiB in fixed-size updates, time per MiB (lower is better)

| Update size | pure-xxhash | @node-rs/xxhash | xxhash-wasm | hash-wasm |
| --- | ---: | ---: | ---: | ---: |
| 64 B | 1980 µs | 3443 µs | 1337 µs | 1467 µs |
| 4 KiB | 358 µs | 94 µs | 80 µs | 76 µs |
| 64 KiB | 318 µs | 47 µs | 68 µs | 60 µs |

#### xxh3: throughput, GB/s (same input every call; higher is better)

| Size | pure-xxhash | pure-xxhash (pair) | hash-wasm | @node-rs/xxhash |
| --- | ---: | ---: | ---: | ---: |
| 16 B | 0.37 | 0.31 | 0.12 | 0.22 |
| 64 B | 0.82 | 0.73 | 0.48 | 0.62 |
| 256 B | 1.32 | 1.27 | 1.65 | 1.79 |
| 4 KiB | 4.31 | 4.24 | 8.83 | 3.36 |
| 64 KiB | 5.11 | 5.16 | 13.59 | 3.65 |
| 1 MiB | 5.20 | 5.20 | 13.14 | 3.66 |

#### xxh3: latency from a fresh buffer (a new copy every call, copy included; lower is better)

| Size | pure-xxhash | pure-xxhash (pair) | hash-wasm | @node-rs/xxhash | copy only |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 B | 80 ns | 72 ns | 484 ns | 476 ns | 33 ns |
| 64 B | 106 ns | 106 ns | 477 ns | 458 ns | 32 ns |
| 256 B | 509 ns | 512 ns | 497 ns | 477 ns | 515 ns |

#### xxh3: streaming 1 MiB in fixed-size updates, time per MiB (lower is better)

| Update size | pure-xxhash | @node-rs/xxhash | hash-wasm |
| --- | ---: | ---: | ---: |
| 64 B | 3200 µs | 3482 µs | 1514 µs |
| 4 KiB | 268 µs | 86 µs | 103 µs |
| 64 KiB | 205 µs | 38 µs | 80 µs |

#### xxh128: throughput, GB/s (same input every call; higher is better)

| Size | pure-xxhash | pure-xxhash (pair) | hash-wasm | @node-rs/xxhash | xxh3-ts |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 B | 0.18 | 0.20 | 0.12 | 0.097 | 0.031 |
| 64 B | 0.58 | 0.66 | 0.47 | 0.31 | 0.044 |
| 256 B | 1.06 | 1.14 | 1.52 | 1.00 | 0.056 |
| 4 KiB | 4.22 | 4.29 | 9.07 | 3.14 | 0.090 |
| 64 KiB | 5.15 | 5.16 | 13.37 | 3.43 | 0.092 |
| 1 MiB | 5.17 | 5.21 | 12.53 | 3.58 | 0.084 |

#### xxh128: latency from a fresh buffer (a new copy every call, copy included; lower is better)

| Size | pure-xxhash | pure-xxhash (pair) | hash-wasm | @node-rs/xxhash | xxh3-ts | copy only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B | 121 ns | 107 ns | 473 ns | 475 ns | 760 ns | 33 ns |
| 64 B | 140 ns | 117 ns | 483 ns | 496 ns | 1666 ns | 32 ns |
| 256 B | 542 ns | 538 ns | 543 ns | 538 ns | 4870 ns | 503 ns |

#### xxh128: streaming 1 MiB in fixed-size updates, time per MiB (lower is better)

| Update size | pure-xxhash | hash-wasm |
| --- | ---: | ---: |
| 64 B | 3209 µs | 1492 µs |
| 4 KiB | 268 µs | 103 µs |
| 64 KiB | 205 µs | 81 µs |


<a id="streaming"></a>
### Streaming

Each update returns a new, immutable state, so it allocates: the new state, a copy of the accumulators, and a copy of the unconsumed bytes (at most 15, 31 or 64 bytes, kept small because typed arrays over 64 bytes are allocated off-heap and cost far more). That is about 130 ns per update for XXH32, 170 ns for XXH64 and 260 ns for XXH3, on top of the hashing:
- with 64 KiB updates (an LZ4 block), streaming 1 MiB takes the same time as hashing it in one call;
- with 4 KiB updates, about a third longer;
- with 64-byte updates, the WASM hashers, which mutate one state in place, are 1.2× (XXH32), 1.5× (XXH64) and 2.1× (XXH3) faster. @node-rs/xxhash pays its call cost on every update and is slower than pure-xxhash there.

<a id="reading-words"></a>
## Reading words: why a DataView, and why not always

`npm run bench:words` times the XXH32 stripe loop with four ways of reading little-endian words, each variant in its own process (median of 5 rounds), measured just after the runs above (load average 3.1). `copy` copies 4 KiB chunks into an aligned scratch Int32Array first.

**Reused buffer**, ns per call:

| Variant | 16 B | 64 B | 256 B | 4096 B | 65536 B | 1048576 B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bytes | 9 ns | 23 ns | 78 ns | 1171 ns | 18.5 µs | 295.7 µs |
| int32view | 24 ns | 28 ns | 42 ns | 358 ns | 5460 ns | 87.3 µs |
| dataview | 35 ns | 40 ns | 55 ns | 377 ns | 5468 ns | 88.7 µs |
| copy | 33 ns | 36 ns | 49 ns | 398 ns | 6366 ns | 102.7 µs |

**A fresh copy each call** (up to 4 KiB; larger sizes reuse one buffer, and the copy is included), ns per call:

| Variant | 16 B | 64 B | 256 B | 4096 B | 65536 B | 1048576 B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bytes | 41 ns | 55 ns | 489 ns | 1566 ns | 18.5 µs | 295.1 µs |
| int32view | 538 ns | 541 ns | 523 ns | 725 ns | 5511 ns | 88.2 µs |
| dataview | 541 ns | 531 ns | 513 ns | 746 ns | 5706 ns | 88.9 µs |
| copy | 536 ns | 529 ns | 520 ns | 771 ns | 6424 ns | 103.8 µs |

- **Byte loads** (four loads, three shifts, three ors) need nothing but the Uint8Array, so they win below about 128 bytes, but they are 3.3× slower over large inputs.
- **An Int32Array view or a DataView** reads a word in one load and runs the loop equally fast; the DataView also handles unaligned subarrays and big-endian hosts, so it's the one used.
- **Making either view costs** 15–30 ns on an array that's already off the JS heap, and on a fresh array of 64 bytes or less, whose bytes V8 keeps on the heap, about 500 ns more: the first `.buffer` read moves them. That's the cost pure-cbor found with DataViews, and it applies to any view.
- **So pure-xxhash** copies inputs of up to 1 KiB into a scratch area that already has a DataView (`set` copied 256 bytes in about 16 ns), makes a DataView only for larger inputs, which V8 already keeps off-heap, and reads short inputs and tails with byte loads. XXH32 inputs of 16 to 63 bytes use byte loads too, which measured faster than the copy at those sizes.

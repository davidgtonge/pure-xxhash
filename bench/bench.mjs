// Times one workload: an algorithm at one input size, for every library that
// has that algorithm. bench/isolated.mjs runs each workload in its own process.
//
//   BENCH_ALGORITHM  xxh32 | xxh64 | xxh3 | xxh128
//   BENCH_SIZE       input bytes
//   BENCH_MODE       reused: the same input every call
//                    fresh:  a new copy every call, like a just-received message
//                    stream: BENCH_SIZE bytes in BENCH_CHUNK-byte updates
//   BENCH_MS, BENCH_ROUNDS  round length and count (default 100 ms, 5 rounds)
import { performance } from 'node:perf_hooks';
import { loadLibraries } from './libraries.mjs';
import { streamers } from './streamers.mjs';

const algorithm = process.env.BENCH_ALGORITHM ?? 'xxh32';
const size = Number(process.env.BENCH_SIZE ?? 1024);
const mode = process.env.BENCH_MODE ?? 'reused';
const chunk = Number(process.env.BENCH_CHUNK ?? 65536);
const durationMs = Number(process.env.BENCH_MS ?? 100);
const rounds = Number(process.env.BENCH_ROUNDS ?? 5);
let sink = 0;

/** Touch a result so the work can't be optimized away. */
function consume(result) {
  if (typeof result === 'number') return result | 0;
  if (typeof result === 'bigint') return Number(result & 0xffn);
  if (result instanceof Uint8Array) return result[0];
  if (typeof result.low === 'number') return result.low | 0;
  if (typeof result.low === 'object') return result.low.low | 0;
  return result._a00 | 0; // xxhashjs's UINT64 object
}

/** Median ns per call over `rounds` timed runs, after a warm-up run. */
function measure(run) {
  const batch = size >= 65536 ? 1 : size >= 4096 ? 16 : 256;
  const timeRun = duration => {
    let calls = 0;
    const start = performance.now();
    let now = start;
    do {
      for (let index = 0; index < batch; index++) sink = (sink + run(calls + index)) | 0;
      calls += batch;
      now = performance.now();
    } while (now - start < duration);
    return (now - start) * 1e6 / calls;
  };
  timeRun(Math.min(200, durationMs * 2));
  const results = Array.from({ length: rounds }, () => timeRun(durationMs)).sort((left, right) => left - right);
  return results[Math.floor(results.length / 2)];
}

// Deterministic, incompressible-looking input.
const input = new Uint8Array(size);
for (let index = 0, state = 0x2545f491; index < size; index++) {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  input[index] = state & 255;
}

const rows = [];
const libraries = await loadLibraries();
if (mode === 'stream') {
  for (const streamer of streamers(libraries, algorithm)) {
    rows.push({ library: streamer.name, ns: measure(() => consume(streamer.hash(input, chunk))) });
  }
} else {
  const expected = libraries[0].algorithms[algorithm].hex(libraries[0].algorithms[algorithm].hash(input));
  for (const library of libraries) {
    const adapter = library.algorithms[algorithm];
    if (!adapter) continue;
    const prepared = adapter.wrap(input);
    const got = adapter.hex(adapter.hash(prepared));
    if (got !== expected) throw new Error(`${library.name} ${algorithm} disagrees: ${got} vs ${expected}`);
    // Fresh inputs: a pool of copies made outside the timing would be reused
    // after a while, so each call makes its own copy; the copy's cost is
    // reported separately as "copy only".
    const run = mode === 'fresh'
      ? () => consume(adapter.hash(adapter.wrap(input.slice())))
      : () => consume(adapter.hash(prepared));
    rows.push({ library: library.name, ns: measure(run) });
  }
  if (mode === 'fresh') rows.push({ library: 'copy only', ns: measure(() => input.slice()[0]) });
}
console.log(JSON.stringify({ algorithm, size, mode, chunk, rows, libraries: libraries.map(({ name, version, kind }) => ({ name, version, kind })) }));
if (sink === 0.5) console.log(sink);

import { bytesOf } from './input.js';
import type { Input } from './input.js';
import { wordsOf } from './words.js';
import { checkSeed64, loadBigInt, loadHigh, loadLow, loadPair, seedHigh, seedLow } from './uint64.js';
import type { Seed64, Uint64Pair } from './uint64.js';
import { consumeStripes64, finish64, lanes64, mergeLanes64, resetLanes64, shortStart64, stripes64 } from './xxh64.js';

/** A streaming XXH64 state: an immutable value, like `Xxh32State`. Its typed
 * arrays belong to it, are never written after it is built, and share no
 * memory with your input. */
export interface Xxh64State {
  /** The seed's high and low 32 bits, as int32. */
  readonly seedHigh: number;
  readonly seedLow: number;
  /** Total bytes hashed so far. */
  readonly length: number;
  /** The four 64-bit lanes as [high, low] int32 pairs, after every whole 32-byte stripe so far. */
  readonly lanes: Int32Array;
  /** The 0–31 bytes after the last whole stripe. */
  readonly pending: Uint8Array;
}

const NOTHING = new Uint8Array(0);

export function xxh64Create(seed: Seed64 = 0): Xxh64State {
  checkSeed64(seed);
  const high = seedHigh(seed);
  const low = seedLow(seed);
  resetLanes64(high, low);
  return { seedHigh: high, seedLow: low, length: 0, lanes: lanes64.slice(), pending: NOTHING };
}

export function xxh64Update(state: Xxh64State, input: Input): Xxh64State {
  const bytes = bytesOf(input);
  const count = bytes.length;
  if (count === 0) return state;
  const pending = state.pending;
  const length = state.length + count;
  if (pending.length + count < 32) {
    const joined = new Uint8Array(pending.length + count);
    joined.set(pending);
    joined.set(bytes, pending.length);
    return { seedHigh: state.seedHigh, seedLow: state.seedLow, length, lanes: state.lanes, pending: joined };
  }
  lanes64.set(state.lanes);
  let position = 0;
  if (pending.length > 0) {
    // Complete the pending stripe from the front of the input.
    position = 32 - pending.length;
    const stripe = new Uint8Array(32);
    stripe.set(pending);
    stripe.set(bytes.subarray(0, position), pending.length);
    stripes64(wordsOf(stripe, 32), 0, 1);
  }
  const stripeCount = Math.floor((count - position) / 32);
  if (stripeCount > 0) consumeStripes64(wordsOf(bytes, count), position, stripeCount);
  return {
    seedHigh: state.seedHigh, seedLow: state.seedLow, length,
    lanes: lanes64.slice(), pending: bytes.slice(position + stripeCount * 32),
  };
}

function digest(state: Xxh64State): void {
  if (state.length >= 32) mergeLanes64(state.lanes, state.length);
  else shortStart64(state.seedHigh, state.seedLow, state.length);
  finish64(state.pending, 0, state.pending.length, loadHigh(), loadLow());
}

/** The XXH64 of everything passed to update so far, as a bigint. The state is unchanged. */
export function xxh64Digest(state: Xxh64State): bigint {
  digest(state);
  return loadBigInt();
}

/** As `xxh64Digest`, as two unsigned 32-bit halves. */
export function xxh64DigestPair(state: Xxh64State): Uint64Pair {
  digest(state);
  return loadPair();
}

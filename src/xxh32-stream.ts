import { bytesOf } from './input.js';
import type { Input } from './input.js';
import { wordsOf } from './words.js';
import { checkSeed32, consumeStripes32, finish32, lanes32, mergeLanes32, PRIME32_5, resetLanes32, stripes32 } from './xxh32.js';

/** A streaming XXH32 state: an immutable value. `xxh32Update` returns a new
 * state and never changes the one it was given, so any state can be digested,
 * kept, or updated again along a different branch.
 *
 * Its typed arrays belong to it and are never written after it is built; an
 * update that completes no stripe shares `lanes` with the state it came from.
 * They share no memory with your input. */
export interface Xxh32State {
  readonly seed: number;
  /** Total bytes hashed so far. */
  readonly length: number;
  /** The four accumulator lanes, after every whole 16-byte stripe so far. */
  readonly lanes: Int32Array;
  /** The 0–15 bytes after the last whole stripe. */
  readonly pending: Uint8Array;
}

const NOTHING = new Uint8Array(0);

export function xxh32Create(seed = 0): Xxh32State {
  checkSeed32(seed);
  resetLanes32(seed);
  return { seed, length: 0, lanes: lanes32.slice(), pending: NOTHING };
}

export function xxh32Update(state: Xxh32State, input: Input): Xxh32State {
  const bytes = bytesOf(input);
  const count = bytes.length;
  if (count === 0) return state;
  const pending = state.pending;
  const length = state.length + count;
  if (pending.length + count < 16) {
    const joined = new Uint8Array(pending.length + count);
    joined.set(pending);
    joined.set(bytes, pending.length);
    return { seed: state.seed, length, lanes: state.lanes, pending: joined };
  }
  lanes32.set(state.lanes);
  let position = 0;
  if (pending.length > 0) {
    // Complete the pending stripe from the front of the input.
    position = 16 - pending.length;
    const stripe = new Uint8Array(16);
    stripe.set(pending);
    stripe.set(bytes.subarray(0, position), pending.length);
    stripes32(wordsOf(stripe, 16), 0, 1);
  }
  const stripeCount = Math.floor((count - position) / 16);
  if (stripeCount > 0) consumeStripes32(wordsOf(bytes, count), position, stripeCount);
  return { seed: state.seed, length, lanes: lanes32.slice(), pending: bytes.slice(position + stripeCount * 16) };
}

/** The XXH32 of everything passed to update so far. The state is unchanged. */
export function xxh32Digest(state: Xxh32State): number {
  const hash = state.length >= 16 ? mergeLanes32(state.lanes) : (state.seed + PRIME32_5) | 0;
  return finish32(state.pending, 0, state.pending.length, (hash + state.length) | 0);
}

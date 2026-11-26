import { bytesOf } from './input.js';
import type { Input } from './input.js';
import { COPY_LIMIT, scratch, wordsOf } from './words.js';
import { loadBigInt, loadBigInt128, loadPair, store64 } from './uint64.js';
import type { Seed64, Uint64Pair } from './uint64.js';
import { wide } from './xxh3-math.js';
import { seededSecret } from './xxh3-secret.js';
import type { Xxh3Secret } from './xxh3-secret.js';
import { accumulateLastStripe, accumulators, consumeStripes, resetAccumulators } from './xxh3-long.js';
import { hash3, keyHalves, keySecretOf, mergeLong64, useKey } from './xxh3.js';
import { longResult128, pairOf128, shortResult128, storeResult128 } from './xxh128.js';
import type { Uint128Pair } from './xxh128.js';

/** A streaming XXH3 state, digested as XXH3-64 or XXH3-128 (the two share the
 * state, as in the C library). An immutable value, like `Xxh32State`: update
 * returns a new state, and the typed arrays belong to the state, are never
 * written after it is built, and share no memory with your input.
 *
 * Like XXH3_update, it holds the first 256 bytes back, so an input of 240
 * bytes or less can still be hashed by the short-input code at the end, and
 * consumes a stripe only once a later byte shows it isn't the last. */
export interface Xxh3State {
  /** The seed's high and low 32 bits, as int32 (0 with a custom secret). */
  readonly seedHigh: number;
  readonly seedLow: number;
  /** The custom secret, if the state was created with one. */
  readonly secret: Xxh3Secret | undefined;
  /** Total bytes hashed so far. */
  readonly length: number;
  /** The eight 64-bit accumulators as [high, low] int32 pairs. */
  readonly accumulators: Int32Array;
  /** Stripes consumed in the current block. */
  readonly stripesDone: number;
  /** The bytes not yet consumed: all of them up to 256 bytes in all, then 1–64. */
  readonly pending: Uint8Array;
  /** The 64 bytes consumed just before `pending` (empty until a stripe is consumed),
   * from which the last stripe is completed when fewer than 64 bytes are pending. */
  readonly previous: Uint8Array;
}

const BUFFER_SIZE = 256;
const NOTHING = new Uint8Array(0);

/** Start a streaming XXH3 hash with a seed, or a secret from `xxh3Secret`. */
export function xxh3Create(seedOrSecret: Seed64 | Xxh3Secret = 0): Xxh3State {
  useKey(seedOrSecret);
  resetAccumulators();
  return {
    seedHigh: keyHalves[0], seedLow: keyHalves[1], secret: keySecretOf(), length: 0,
    accumulators: accumulators.slice(), stripesDone: 0, pending: NOTHING, previous: NOTHING,
  };
}

function longSecretOf(state: Xxh3State): Xxh3Secret {
  return state.secret ?? seededSecret(state.seedHigh, state.seedLow);
}

export function xxh3Update(state: Xxh3State, input: Input): Xxh3State {
  const bytes = bytesOf(input);
  const count = bytes.length;
  if (count === 0) return state;
  const pending = state.pending;
  const length = state.length + count;
  if (length <= BUFFER_SIZE) {
    // Up to 256 bytes in all: hold them, as the short-input code may need them all.
    const joined = new Uint8Array(pending.length + count);
    joined.set(pending);
    joined.set(bytes, pending.length);
    return { ...state, length, pending: joined };
  }
  // Past 256 bytes the input is long, so any stripe followed by at least one
  // more byte can be consumed now (XXH3_update consumes the same stripes, just
  // later). Pending bytes and the front of the input are joined in the scratch
  // area, which keeps every array the state holds at 64 bytes or less: larger
  // typed arrays live off V8's heap and cost far more to allocate.
  const secret = longSecretOf(state);
  accumulators.set(state.accumulators);
  let stripesDone = state.stripesDone;
  let previous = state.previous;
  const held = pending.length;
  // Join up to the next stripe boundary, or the whole input if that's smaller.
  const front = Math.min(count, (64 - (held % 64)) % 64 + (held + count <= COPY_LIMIT ? count : 0));
  scratch.set(pending);
  scratch.set(bytes.subarray(0, front), held);
  const joinedLength = held + front;
  let stripeCount = Math.floor((joinedLength - (front === count ? 1 : 0)) / 64);
  if (stripeCount > 0) {
    stripesDone = consumeStripes(wordsOf(scratch, joinedLength), 0, stripeCount, stripesDone, secret);
    previous = scratch.slice(stripeCount * 64 - 64, stripeCount * 64);
  }
  if (front === count) {
    return {
      seedHigh: state.seedHigh, seedLow: state.seedLow, secret: state.secret, length,
      accumulators: accumulators.slice(), stripesDone, pending: scratch.slice(stripeCount * 64, joinedLength), previous,
    };
  }
  // The rest of the input, straight from it, keeping at least one byte back.
  stripeCount = Math.floor((count - front - 1) / 64);
  const position = front + stripeCount * 64;
  if (stripeCount > 0) {
    stripesDone = consumeStripes(wordsOf(bytes, count), front, stripeCount, stripesDone, secret);
    previous = bytes.slice(position - 64, position);
  }
  return {
    seedHigh: state.seedHigh, seedLow: state.seedLow, secret: state.secret, length,
    accumulators: accumulators.slice(), stripesDone, pending: bytes.slice(position), previous,
  };
}

/** XXH3_digest_long: the accumulators with the pending stripes and the last
 * stripe added, in `accumulators`. The state is unchanged. */
function digestLong(state: Xxh3State, secret: Xxh3Secret): void {
  accumulators.set(state.accumulators);
  const pending = state.pending;
  if (pending.length >= 64) {
    const view = wordsOf(pending, pending.length);
    consumeStripes(view, 0, Math.floor((pending.length - 1) / 64), state.stripesDone, secret);
    accumulateLastStripe(view, pending.length - 64, secret);
  } else {
    const lastStripe = new Uint8Array(64);
    lastStripe.set(state.previous.subarray(pending.length));
    lastStripe.set(pending, 64 - pending.length);
    accumulateLastStripe(wordsOf(lastStripe, 64), 0, secret);
  }
}

function digest64(state: Xxh3State): void {
  if (state.length <= 240) {
    hash3(state.pending, state.length, state.seedHigh, state.seedLow, state.secret);
  } else {
    const secret = longSecretOf(state);
    digestLong(state, secret);
    mergeLong64(state.length, secret);
  }
  store64(wide[0], wide[1]);
}

function digest128(state: Xxh3State): Int32Array {
  if (state.length <= 240) return shortResult128(state.pending, state.length, state.seedHigh, state.seedLow, state.secret);
  const secret = longSecretOf(state);
  digestLong(state, secret);
  return longResult128(state.length, secret);
}

/** The XXH3-64 of everything passed to update so far, as a bigint. The state is unchanged. */
export function xxh3Digest(state: Xxh3State): bigint {
  digest64(state);
  return loadBigInt();
}

/** As `xxh3Digest`, as two unsigned 32-bit halves. */
export function xxh3DigestPair(state: Xxh3State): Uint64Pair {
  digest64(state);
  return loadPair();
}

/** The XXH3-128 of everything passed to update so far, as a bigint. The state is unchanged. */
export function xxh128Digest(state: Xxh3State): bigint {
  storeResult128(digest128(state));
  return loadBigInt128();
}

/** As `xxh128Digest`, as 64-bit halves of uint32 pairs. */
export function xxh128DigestPair(state: Xxh3State): Uint128Pair {
  return pairOf128(digest128(state));
}

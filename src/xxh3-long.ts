import type { Xxh3Secret } from './xxh3-secret.js';
import { multiplyHigh32 } from './uint64.js';
import { avalanche3, foldedMultiply, wide } from './xxh3-math.js';

/** XXH3's long-input loop (over 240 bytes): eight 64-bit accumulators, fed
 * 64-byte stripes, scrambled after each block of (secret size - 64) / 8
 * stripes, then merged.
 *
 * The accumulators live in `accumulators` as [high, low] pairs: working space
 * for one synchronous call, copied in and out by the streaming state.
 *
 * Each stripe adds to accumulator i the input's 64-bit word i ^ 1 and the
 * 32 × 32-bit product of the halves of (word i ^ secret word i). Nothing here
 * works out a carry per stripe: an accumulator's additions are gathered in
 * three running sums, `low` (weight 1), `middle` (weight 2^16) and `high`
 * (weight 2^32, wrapping), with the product split at the high key's 16-bit
 * halves so each term is below 2^48 and every sum stays exact in a double for
 * 16 stripes. `settle` folds them back into 64 bits once per call. This was
 * about 1.4× faster than carrying on every stripe, and two accumulators per
 * pass (four passes over a block, which stays in L1) beat all eight in one
 * loop, where V8 ran out of registers. */
export const accumulators = new Int32Array(16);

const TWO_TO_MINUS_16 = 0.0000152587890625;
const TWO_TO_MINUS_32 = 2.3283064365386963e-10;
/** Stripes per pass: keeps the running sums below 2^53. */
const SETTLE_STRIPES = 16;

/** XXH3_INIT_ACC: PRIME32_3, PRIME64_1, PRIME64_2, PRIME64_3, PRIME64_4, PRIME32_2, PRIME64_5, PRIME32_1. */
export function resetAccumulators(): void {
  accumulators[0] = 0; accumulators[1] = 0xc2b2ae3d | 0;
  accumulators[2] = 0x9e3779b1 | 0; accumulators[3] = 0x85ebca87 | 0;
  accumulators[4] = 0xc2b2ae3d | 0; accumulators[5] = 0x27d4eb4f;
  accumulators[6] = 0x165667b1; accumulators[7] = 0x9e3779f9 | 0;
  accumulators[8] = 0x85ebca77 | 0; accumulators[9] = 0xc2b2ae63 | 0;
  accumulators[10] = 0; accumulators[11] = 0x85ebca77 | 0;
  accumulators[12] = 0x27d4eb2f; accumulators[13] = 0x165667c5;
  accumulators[14] = 0; accumulators[15] = 0x9e3779b1 | 0;
}

/** Fold one accumulator's running sums into it. */
function settle(index: number, low: number, middle: number, high: number): void {
  const middleHigh = Math.floor(middle * TWO_TO_MINUS_16);
  const lowSum = (accumulators[index + 1] >>> 0) + low + (middle - middleHigh * 65536) * 65536;
  accumulators[index] = accumulators[index] + high + (middleHigh | 0) + Math.floor(lowSum * TWO_TO_MINUS_32);
  accumulators[index + 1] = lowSum;
}

/** Accumulators 0 and 1 over `stripeCount` (at most 16) stripes. */
function accumulatePair0(view: DataView, start: number, stripeCount: number, secret: Int32Array, secretStart: number): void {
  let low0 = 0, middle0 = 0, high0 = 0, low1 = 0, middle1 = 0, high1 = 0;
  const end = start + stripeCount * 64;
  for (let position = start, secretPosition = secretStart; position < end; position += 64, secretPosition += 8) {
    const dataLow0 = view.getInt32(position + 0, true);
    const dataHigh0 = view.getInt32(position + 4, true);
    const dataLow1 = view.getInt32(position + 8, true);
    const dataHigh1 = view.getInt32(position + 12, true);
    let keyLow = (dataLow0 ^ secret[secretPosition + 0]) >>> 0;
    let keyHigh = dataHigh0 ^ secret[secretPosition + 4];
    low0 += keyLow * (keyHigh & 0xffff) + (dataLow1 >>> 0);
    middle0 += keyLow * (keyHigh >>> 16);
    high0 = (high0 + dataHigh1) | 0;
    keyLow = (dataLow1 ^ secret[secretPosition + 8]) >>> 0;
    keyHigh = dataHigh1 ^ secret[secretPosition + 12];
    low1 += keyLow * (keyHigh & 0xffff) + (dataLow0 >>> 0);
    middle1 += keyLow * (keyHigh >>> 16);
    high1 = (high1 + dataHigh0) | 0;
  }
  settle(0, low0, middle0, high0);
  settle(2, low1, middle1, high1);
}

/** Accumulators 2 and 3 over `stripeCount` (at most 16) stripes. */
function accumulatePair1(view: DataView, start: number, stripeCount: number, secret: Int32Array, secretStart: number): void {
  let low2 = 0, middle2 = 0, high2 = 0, low3 = 0, middle3 = 0, high3 = 0;
  const end = start + stripeCount * 64;
  for (let position = start, secretPosition = secretStart; position < end; position += 64, secretPosition += 8) {
    const dataLow2 = view.getInt32(position + 16, true);
    const dataHigh2 = view.getInt32(position + 20, true);
    const dataLow3 = view.getInt32(position + 24, true);
    const dataHigh3 = view.getInt32(position + 28, true);
    let keyLow = (dataLow2 ^ secret[secretPosition + 16]) >>> 0;
    let keyHigh = dataHigh2 ^ secret[secretPosition + 20];
    low2 += keyLow * (keyHigh & 0xffff) + (dataLow3 >>> 0);
    middle2 += keyLow * (keyHigh >>> 16);
    high2 = (high2 + dataHigh3) | 0;
    keyLow = (dataLow3 ^ secret[secretPosition + 24]) >>> 0;
    keyHigh = dataHigh3 ^ secret[secretPosition + 28];
    low3 += keyLow * (keyHigh & 0xffff) + (dataLow2 >>> 0);
    middle3 += keyLow * (keyHigh >>> 16);
    high3 = (high3 + dataHigh2) | 0;
  }
  settle(4, low2, middle2, high2);
  settle(6, low3, middle3, high3);
}

/** Accumulators 4 and 5 over `stripeCount` (at most 16) stripes. */
function accumulatePair2(view: DataView, start: number, stripeCount: number, secret: Int32Array, secretStart: number): void {
  let low4 = 0, middle4 = 0, high4 = 0, low5 = 0, middle5 = 0, high5 = 0;
  const end = start + stripeCount * 64;
  for (let position = start, secretPosition = secretStart; position < end; position += 64, secretPosition += 8) {
    const dataLow4 = view.getInt32(position + 32, true);
    const dataHigh4 = view.getInt32(position + 36, true);
    const dataLow5 = view.getInt32(position + 40, true);
    const dataHigh5 = view.getInt32(position + 44, true);
    let keyLow = (dataLow4 ^ secret[secretPosition + 32]) >>> 0;
    let keyHigh = dataHigh4 ^ secret[secretPosition + 36];
    low4 += keyLow * (keyHigh & 0xffff) + (dataLow5 >>> 0);
    middle4 += keyLow * (keyHigh >>> 16);
    high4 = (high4 + dataHigh5) | 0;
    keyLow = (dataLow5 ^ secret[secretPosition + 40]) >>> 0;
    keyHigh = dataHigh5 ^ secret[secretPosition + 44];
    low5 += keyLow * (keyHigh & 0xffff) + (dataLow4 >>> 0);
    middle5 += keyLow * (keyHigh >>> 16);
    high5 = (high5 + dataHigh4) | 0;
  }
  settle(8, low4, middle4, high4);
  settle(10, low5, middle5, high5);
}

/** Accumulators 6 and 7 over `stripeCount` (at most 16) stripes. */
function accumulatePair3(view: DataView, start: number, stripeCount: number, secret: Int32Array, secretStart: number): void {
  let low6 = 0, middle6 = 0, high6 = 0, low7 = 0, middle7 = 0, high7 = 0;
  const end = start + stripeCount * 64;
  for (let position = start, secretPosition = secretStart; position < end; position += 64, secretPosition += 8) {
    const dataLow6 = view.getInt32(position + 48, true);
    const dataHigh6 = view.getInt32(position + 52, true);
    const dataLow7 = view.getInt32(position + 56, true);
    const dataHigh7 = view.getInt32(position + 60, true);
    let keyLow = (dataLow6 ^ secret[secretPosition + 48]) >>> 0;
    let keyHigh = dataHigh6 ^ secret[secretPosition + 52];
    low6 += keyLow * (keyHigh & 0xffff) + (dataLow7 >>> 0);
    middle6 += keyLow * (keyHigh >>> 16);
    high6 = (high6 + dataHigh7) | 0;
    keyLow = (dataLow7 ^ secret[secretPosition + 56]) >>> 0;
    keyHigh = dataHigh7 ^ secret[secretPosition + 60];
    low7 += keyLow * (keyHigh & 0xffff) + (dataLow6 >>> 0);
    middle7 += keyLow * (keyHigh >>> 16);
    high7 = (high7 + dataHigh6) | 0;
  }
  settle(12, low6, middle6, high6);
  settle(14, low7, middle7, high7);
}

/** XXH3_accumulate: `stripeCount` stripes from `start`, with the secret
 * advancing 8 bytes per stripe from `secretStart`. */
function accumulate(view: DataView, start: number, stripeCount: number, secret: Int32Array, secretStart: number): void {
  while (stripeCount > 0) {
    const count = stripeCount < SETTLE_STRIPES ? stripeCount : SETTLE_STRIPES;
    accumulatePair0(view, start, count, secret, secretStart);
    accumulatePair1(view, start, count, secret, secretStart);
    accumulatePair2(view, start, count, secret, secretStart);
    accumulatePair3(view, start, count, secret, secretStart);
    start += count * 64;
    secretStart += count * 8;
    stripeCount -= count;
  }
}

/** XXH3_scrambleAcc: acc = (acc ^ (acc >> 47) ^ secret word) * PRIME32_1. */
function scramble(secret: Int32Array, secretStart: number): void {
  for (let index = 0; index < 16; index += 2) {
    const high = accumulators[index] ^ secret[secretStart + index * 4 + 4];
    const low = accumulators[index + 1] ^ (accumulators[index] >>> 15) ^ secret[secretStart + index * 4];
    accumulators[index] = multiplyHigh32(low, 0x9e3779b1) + Math.imul(high, 0x9e3779b1);
    accumulators[index + 1] = Math.imul(low, 0x9e3779b1);
  }
}

/** XXH3_consumeStripes: feed whole stripes, scrambling at each block's end.
 * Returns how many stripes of the current block are done. */
export function consumeStripes(view: DataView, start: number, stripeCount: number, stripesDone: number, secret: Xxh3Secret): number {
  const stripesPerBlock = Math.floor((secret.size - 64) / 8);
  while (stripeCount > 0) {
    const left = stripesPerBlock - stripesDone;
    const count = stripeCount < left ? stripeCount : left;
    accumulate(view, start, count, secret.words, stripesDone * 8);
    start += count * 64;
    stripeCount -= count;
    stripesDone += count;
    if (stripesDone === stripesPerBlock) {
      scramble(secret.words, secret.size - 64);
      stripesDone = 0;
    }
  }
  return stripesDone;
}

/** The last stripe: the input's final 64 bytes, with the secret 7 bytes
 * before its scramble words (XXH_SECRET_LASTACC_START). */
export function accumulateLastStripe(view: DataView, start: number, secret: Xxh3Secret): void {
  accumulate(view, start, 1, secret.words, secret.size - 64 - 7);
}

/** XXH3_mergeAccs, into wide[0..1]: avalanche(start + the sum, over the four
 * pairs of accumulators, of mul128_fold64(acc[2i] ^ secret, acc[2i + 1] ^ secret)). */
export function mergeAccumulators(secret: Int32Array, secretStart: number, startHigh: number, startLow: number): void {
  let high = startHigh;
  let low = startLow;
  for (let pair = 0; pair < 4; pair++) {
    const offset = secretStart + pair * 16;
    foldedMultiply(
      accumulators[pair * 4] ^ secret[offset + 4], accumulators[pair * 4 + 1] ^ secret[offset],
      accumulators[pair * 4 + 2] ^ secret[offset + 12], accumulators[pair * 4 + 3] ^ secret[offset + 8],
    );
    const termLow = wide[1];
    const sumLow = (low + termLow) | 0;
    high = (high + wide[0] + (((low & termLow) | ((low | termLow) & ~sumLow)) >>> 31)) | 0;
    low = sumLow;
  }
  avalanche3(high, low);
}

/** Run an input over 240 bytes through the accumulators, last stripe included. */
export function hashLong(view: DataView, length: number, secret: Xxh3Secret): void {
  resetAccumulators();
  consumeStripes(view, 0, Math.floor((length - 1) / 64), 0, secret);
  accumulateLastStripe(view, length - 64, secret);
}

/** length × a 64-bit prime, into wide[0..1]. `length` is a safe integer. */
export function lengthTimes(length: number, primeHigh: number, primeLow: number): void {
  const lengthLow = length | 0;
  const lengthHigh = Math.floor(length * TWO_TO_MINUS_32) | 0;
  wide[0] = multiplyHigh32(lengthLow, primeLow) + Math.imul(lengthHigh, primeLow) + Math.imul(lengthLow, primeHigh);
  wide[1] = Math.imul(lengthLow, primeLow);
}

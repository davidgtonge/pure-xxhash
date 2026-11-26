import { checkBytes, encodeOwned, encodeToScratch } from './input.js';
import type { Input } from './input.js';
import { readWord, scratch, wordsOf } from './words.js';
import { borrowOut, carryOut, checkSeed64, loadBigInt, loadHigh, loadLow, loadPair, seedHigh, seedLow, store64 } from './uint64.js';
import type { Seed64, Uint64Pair } from './uint64.js';

// The five XXH64 primes, as int32 halves, and the 16-bit limbs of the low halves
// of the two that the stripe loop multiplies by.
const PRIME64_1_HIGH = 0x9e3779b1 | 0;
const PRIME64_1_LOW = 0x85ebca87 | 0;
const PRIME64_2_HIGH = 0xc2b2ae3d | 0;
const PRIME64_2_LOW = 0x27d4eb4f | 0;
const PRIME64_3_HIGH = 0x165667b1 | 0;
const PRIME64_3_LOW = 0x9e3779f9 | 0;
const PRIME64_4_HIGH = 0x85ebca77 | 0;
const PRIME64_4_LOW = 0xc2b2ae63 | 0;
const PRIME64_5_HIGH = 0x27d4eb2f | 0;
const PRIME64_5_LOW = 0x165667c5 | 0;
const TWO_TO_MINUS_32 = 2.3283064365386963e-10;
const PRIME64_1_LOW_LIMB = 0xca87;
const PRIME64_1_HIGH_LIMB = 0x85eb;
const PRIME64_2_LOW_LIMB = 0xeb4f;
const PRIME64_2_HIGH_LIMB = 0x27d4;

/** The four accumulator lanes as [high, low] pairs, as working space for one
 * synchronous call: the stripe loop reads them at its start and writes them
 * back at its end. */
export const lanes64 = new Int32Array(8);

/** Lanes for a seed: seed + P1 + P2, seed + P2, seed, seed - P1. */
export function resetLanes64(seedHighWord: number, seedLowWord: number): void {
  // P1 + P2 = 0x60ea27eeadc0b5d6 (mod 2^64)
  let low = (seedLowWord + (0xadc0b5d6 | 0)) | 0;
  lanes64[0] = (seedHighWord + (0x60ea27ee | 0) + carryOut(seedLowWord, 0xadc0b5d6 | 0, low)) | 0;
  lanes64[1] = low;
  low = (seedLowWord + PRIME64_2_LOW) | 0;
  lanes64[2] = (seedHighWord + PRIME64_2_HIGH + carryOut(seedLowWord, PRIME64_2_LOW, low)) | 0;
  lanes64[3] = low;
  lanes64[4] = seedHighWord;
  lanes64[5] = seedLowWord;
  lanes64[6] = (seedHighWord - PRIME64_1_HIGH - borrowOut(seedLowWord, PRIME64_1_LOW, (seedLowWord - PRIME64_1_LOW) | 0)) | 0;
  lanes64[7] = (seedLowWord - PRIME64_1_LOW) | 0;
}

/** Run whole 32-byte stripes, from `start`, through the lanes in `lanes64`.
 *
 * Each lane does XXH64_round: lane = rotl64(lane + input * PRIME64_2, 31) * PRIME64_1.
 * Spelled out on 32-bit halves, with no helper calls: V8 would not inline them
 * all within its budget, and every call left out boxes its int32 arguments.
 * A 64 × 64-bit product's low 64 bits are
 *   low  = imul(aLow, bLow)
 *   high = mulhi32(aLow, bLow) + imul(aHigh, bLow) + imul(aLow, bHigh)
 * with mulhi32 from 16-bit limbs of aLow and the constant bLow, so every
 * partial product is exact. The carry out of a low-half sum is computed from
 * bits, ((a & b) | ((a | b) & ~sum)) >>> 31: written as a comparison, V8
 * branched on it, and the unpredictable branch cost more than half the time. */
export function stripes64(view: DataView, start: number, stripeCount: number): void {
  let lane1High = lanes64[0], lane1Low = lanes64[1], lane2High = lanes64[2], lane2Low = lanes64[3];
  let lane3High = lanes64[4], lane3Low = lanes64[5], lane4High = lanes64[6], lane4Low = lanes64[7];
  let inputLow = 0, inputHigh = 0, productLow = 0, productHigh = 0, sumLow = 0, sumHigh = 0;
  let rotatedLow = 0, rotatedHigh = 0, lowLimb = 0, highLimb = 0, lowByLow = 0, lowByHigh = 0, highByLow = 0;
  const end = start + stripeCount * 32;
  for (let position = start; position < end; position += 32) {
    // lane 1
    inputLow = view.getInt32(position + 0, true);
    inputHigh = view.getInt32(position + 4, true);
    productLow = Math.imul(inputLow, PRIME64_2_LOW);
    lowLimb = inputLow & 0xffff;
    highLimb = inputLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_2_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_2_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_2_LOW_LIMB);
    productHigh = (Math.imul(highLimb, PRIME64_2_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(inputHigh, PRIME64_2_LOW) + Math.imul(inputLow, PRIME64_2_HIGH)) | 0;
    sumLow = (lane1Low + productLow) | 0;
    sumHigh = (lane1High + productHigh + (((lane1Low & productLow) | ((lane1Low | productLow) & ~sumLow)) >>> 31)) | 0;
    rotatedHigh = (sumHigh << 31) | (sumLow >>> 1);
    rotatedLow = (sumLow << 31) | (sumHigh >>> 1);
    lowLimb = rotatedLow & 0xffff;
    highLimb = rotatedLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_1_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_1_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_1_LOW_LIMB);
    lane1High = (Math.imul(highLimb, PRIME64_1_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    lane1Low = Math.imul(rotatedLow, PRIME64_1_LOW);
    // lane 2
    inputLow = view.getInt32(position + 8, true);
    inputHigh = view.getInt32(position + 12, true);
    productLow = Math.imul(inputLow, PRIME64_2_LOW);
    lowLimb = inputLow & 0xffff;
    highLimb = inputLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_2_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_2_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_2_LOW_LIMB);
    productHigh = (Math.imul(highLimb, PRIME64_2_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(inputHigh, PRIME64_2_LOW) + Math.imul(inputLow, PRIME64_2_HIGH)) | 0;
    sumLow = (lane2Low + productLow) | 0;
    sumHigh = (lane2High + productHigh + (((lane2Low & productLow) | ((lane2Low | productLow) & ~sumLow)) >>> 31)) | 0;
    rotatedHigh = (sumHigh << 31) | (sumLow >>> 1);
    rotatedLow = (sumLow << 31) | (sumHigh >>> 1);
    lowLimb = rotatedLow & 0xffff;
    highLimb = rotatedLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_1_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_1_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_1_LOW_LIMB);
    lane2High = (Math.imul(highLimb, PRIME64_1_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    lane2Low = Math.imul(rotatedLow, PRIME64_1_LOW);
    // lane 3
    inputLow = view.getInt32(position + 16, true);
    inputHigh = view.getInt32(position + 20, true);
    productLow = Math.imul(inputLow, PRIME64_2_LOW);
    lowLimb = inputLow & 0xffff;
    highLimb = inputLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_2_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_2_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_2_LOW_LIMB);
    productHigh = (Math.imul(highLimb, PRIME64_2_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(inputHigh, PRIME64_2_LOW) + Math.imul(inputLow, PRIME64_2_HIGH)) | 0;
    sumLow = (lane3Low + productLow) | 0;
    sumHigh = (lane3High + productHigh + (((lane3Low & productLow) | ((lane3Low | productLow) & ~sumLow)) >>> 31)) | 0;
    rotatedHigh = (sumHigh << 31) | (sumLow >>> 1);
    rotatedLow = (sumLow << 31) | (sumHigh >>> 1);
    lowLimb = rotatedLow & 0xffff;
    highLimb = rotatedLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_1_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_1_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_1_LOW_LIMB);
    lane3High = (Math.imul(highLimb, PRIME64_1_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    lane3Low = Math.imul(rotatedLow, PRIME64_1_LOW);
    // lane 4
    inputLow = view.getInt32(position + 24, true);
    inputHigh = view.getInt32(position + 28, true);
    productLow = Math.imul(inputLow, PRIME64_2_LOW);
    lowLimb = inputLow & 0xffff;
    highLimb = inputLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_2_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_2_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_2_LOW_LIMB);
    productHigh = (Math.imul(highLimb, PRIME64_2_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(inputHigh, PRIME64_2_LOW) + Math.imul(inputLow, PRIME64_2_HIGH)) | 0;
    sumLow = (lane4Low + productLow) | 0;
    sumHigh = (lane4High + productHigh + (((lane4Low & productLow) | ((lane4Low | productLow) & ~sumLow)) >>> 31)) | 0;
    rotatedHigh = (sumHigh << 31) | (sumLow >>> 1);
    rotatedLow = (sumLow << 31) | (sumHigh >>> 1);
    lowLimb = rotatedLow & 0xffff;
    highLimb = rotatedLow >>> 16;
    lowByLow = Math.imul(lowLimb, PRIME64_1_LOW_LIMB);
    lowByHigh = Math.imul(lowLimb, PRIME64_1_HIGH_LIMB);
    highByLow = Math.imul(highLimb, PRIME64_1_LOW_LIMB);
    lane4High = (Math.imul(highLimb, PRIME64_1_HIGH_LIMB) + (lowByHigh >>> 16) + (highByLow >>> 16)
      + (((lowByLow >>> 16) + (lowByHigh & 0xffff) + (highByLow & 0xffff)) >>> 16)
      + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    lane4Low = Math.imul(rotatedLow, PRIME64_1_LOW);
  }
  lanes64[0] = lane1High; lanes64[1] = lane1Low; lanes64[2] = lane2High; lanes64[3] = lane2Low;
  lanes64[4] = lane3High; lanes64[5] = lane3Low; lanes64[6] = lane4High; lanes64[7] = lane4Low;
}

/** `stripes64` in calls of at most 512 stripes (16 KiB), for the reason given
 * at STRIPES_PER_CALL in xxh32.ts. */
export function consumeStripes64(view: DataView, start: number, stripeCount: number): void {
  for (; stripeCount > 512; stripeCount -= 512, start += 512 * 32) stripes64(view, start, 512);
  stripes64(view, start, stripeCount);
}

/* The rest runs a few times per hash, not per stripe. It is spelled out too,
 * with multiplyHigh32 (uint64.ts) written in place as
 * (x * constant - low) * 2^-32 rounded: as calls, the short-input paths ran
 * past V8's inlining budget, and every call left out boxed its int32 arguments.
 * Only carryOut, which is tiny, stays a call. */

/** Merge the lanes and add the length: the running hash before the tail,
 * left in the result register. */
export function mergeLanes64(lanes: Int32Array, length: number): void {
  // rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)
  let high = (lanes[0] << 1) | (lanes[1] >>> 31);
  let low = (lanes[1] << 1) | (lanes[0] >>> 31);
  let termHigh = (lanes[2] << 7) | (lanes[3] >>> 25);
  let termLow = (lanes[3] << 7) | (lanes[2] >>> 25);
  let sumLow = (low + termLow) | 0;
  high = (high + termHigh + carryOut(low, termLow, sumLow)) | 0;
  low = sumLow;
  termHigh = (lanes[4] << 12) | (lanes[5] >>> 20);
  termLow = (lanes[5] << 12) | (lanes[4] >>> 20);
  sumLow = (low + termLow) | 0;
  high = (high + termHigh + carryOut(low, termLow, sumLow)) | 0;
  low = sumLow;
  termHigh = (lanes[6] << 18) | (lanes[7] >>> 14);
  termLow = (lanes[7] << 18) | (lanes[6] >>> 14);
  sumLow = (low + termLow) | 0;
  high = (high + termHigh + carryOut(low, termLow, sumLow)) | 0;
  low = sumLow;
  for (let index = 0; index < 8; index += 2) {
    // mergeRound(hash, lane): hash ^= round(0, lane); hash = hash * P1 + P4,
    // where round(0, lane) = rotl(lane * P2, 31) * P1.
    const laneHigh = lanes[index];
    const laneLow = lanes[index + 1];
    const productHigh = (((((laneLow >>> 0) * 0x27d4eb4f - (Math.imul(laneLow, 0x27d4eb4f) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(laneHigh, PRIME64_2_LOW) + Math.imul(laneLow, PRIME64_2_HIGH)) | 0;
    const productLow = Math.imul(laneLow, PRIME64_2_LOW);
    const rotatedHigh = (productHigh << 31) | (productLow >>> 1);
    const rotatedLow = (productLow << 31) | (productHigh >>> 1);
    high ^= (((((rotatedLow >>> 0) * 0x85ebca87 - (Math.imul(rotatedLow, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    low ^= Math.imul(rotatedLow, PRIME64_1_LOW);
    const mixedHigh = (((((low >>> 0) * 0x85ebca87 - (Math.imul(low, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(high, PRIME64_1_LOW) + Math.imul(low, PRIME64_1_HIGH)) | 0;
    const mixedLow = Math.imul(low, PRIME64_1_LOW);
    low = (mixedLow + PRIME64_4_LOW) | 0;
    high = (mixedHigh + PRIME64_4_HIGH + carryOut(mixedLow, PRIME64_4_LOW, low)) | 0;
  }
  addLength(high, low, length);
}

/** Store hash + length (a safe integer, so its high half is exact). */
function addLength(high: number, low: number, length: number): void {
  const lengthLow = length | 0;
  const sumLow = (low + lengthLow) | 0;
  store64((high + Math.floor(length / 4294967296) + carryOut(low, lengthLow, sumLow)) | 0, sumLow);
}

/** Mix the last 0–31 bytes, bytes[position, end), into the running hash
 * (high, low), then avalanche, leaving the final hash in the result register. */
export function finish64(bytes: Uint8Array, position: number, end: number, high: number, low: number): void {
  for (; position + 8 <= end; position += 8) {
    // hash ^= round(0, input), where round(0, input) = rotl(input * P2, 31) * P1
    const inputLow = readWord(bytes, position);
    const inputHigh = readWord(bytes, position + 4);
    const productHigh = (((((inputLow >>> 0) * 0x27d4eb4f - (Math.imul(inputLow, 0x27d4eb4f) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(inputHigh, PRIME64_2_LOW) + Math.imul(inputLow, PRIME64_2_HIGH)) | 0;
    const productLow = Math.imul(inputLow, PRIME64_2_LOW);
    let rotatedHigh = (productHigh << 31) | (productLow >>> 1);
    let rotatedLow = (productLow << 31) | (productHigh >>> 1);
    high ^= (((((rotatedLow >>> 0) * 0x85ebca87 - (Math.imul(rotatedLow, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    low ^= Math.imul(rotatedLow, PRIME64_1_LOW);
    // hash = rotl(hash, 27) * P1 + P4
    rotatedHigh = (high << 27) | (low >>> 5);
    rotatedLow = (low << 27) | (high >>> 5);
    const mixedHigh = (((((rotatedLow >>> 0) * 0x85ebca87 - (Math.imul(rotatedLow, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    const mixedLow = Math.imul(rotatedLow, PRIME64_1_LOW);
    low = (mixedLow + PRIME64_4_LOW) | 0;
    high = (mixedHigh + PRIME64_4_HIGH + carryOut(mixedLow, PRIME64_4_LOW, low)) | 0;
  }
  if (position + 4 <= end) {
    // hash ^= uint32 * P1; hash = rotl(hash, 23) * P2 + P3
    const word = readWord(bytes, position);
    high ^= (((((word >>> 0) * 0x85ebca87 - (Math.imul(word, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(word, PRIME64_1_HIGH)) | 0;
    low ^= Math.imul(word, PRIME64_1_LOW);
    const rotatedHigh = (high << 23) | (low >>> 9);
    const rotatedLow = (low << 23) | (high >>> 9);
    const mixedHigh = (((((rotatedLow >>> 0) * 0x27d4eb4f - (Math.imul(rotatedLow, 0x27d4eb4f) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(rotatedHigh, PRIME64_2_LOW) + Math.imul(rotatedLow, PRIME64_2_HIGH)) | 0;
    const mixedLow = Math.imul(rotatedLow, PRIME64_2_LOW);
    low = (mixedLow + PRIME64_3_LOW) | 0;
    high = (mixedHigh + PRIME64_3_HIGH + carryOut(mixedLow, PRIME64_3_LOW, low)) | 0;
    position += 4;
  }
  for (; position < end; position++) {
    // hash ^= byte * P5; hash = rotl(hash, 11) * P1. A byte times P5's low half
    // stays below 2^40, so its high half is a plain division.
    const byte = bytes[position];
    high ^= (Math.floor((byte * 0x165667c5) / 4294967296) + Math.imul(byte, PRIME64_5_HIGH)) | 0;
    low ^= Math.imul(byte, PRIME64_5_LOW);
    const rotatedHigh = (high << 11) | (low >>> 21);
    const rotatedLow = (low << 11) | (high >>> 21);
    high = (((((rotatedLow >>> 0) * 0x85ebca87 - (Math.imul(rotatedLow, 0x85ebca87) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(rotatedHigh, PRIME64_1_LOW) + Math.imul(rotatedLow, PRIME64_1_HIGH)) | 0;
    low = Math.imul(rotatedLow, PRIME64_1_LOW);
  }
  avalanche64(high, low);
}

/** XXH64_avalanche: h ^= h >> 33; h *= P2; h ^= h >> 29; h *= P3; h ^= h >> 32.
 * Leaves the final hash in the result register. */
function avalanche64(high: number, low: number): void {
  low ^= high >>> 1;
  let nextHigh = (((((low >>> 0) * 0x27d4eb4f - (Math.imul(low, 0x27d4eb4f) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(high, PRIME64_2_LOW) + Math.imul(low, PRIME64_2_HIGH)) | 0;
  low = Math.imul(low, PRIME64_2_LOW);
  high = nextHigh;
  low ^= (low >>> 29) | (high << 3);
  high ^= high >>> 29;
  nextHigh = (((((low >>> 0) * 0x9e3779f9 - (Math.imul(low, 0x9e3779f9) >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0) + Math.imul(high, PRIME64_3_LOW) + Math.imul(low, PRIME64_3_HIGH)) | 0;
  low = Math.imul(low, PRIME64_3_LOW);
  store64(nextHigh, low ^ nextHigh);
}

/** The running hash before the tail, when no stripe was hashed: seed + P5 + length. */
export function shortStart64(seedHighWord: number, seedLowWord: number, length: number): void {
  const low = (seedLowWord + PRIME64_5_LOW) | 0;
  addLength((seedHighWord + PRIME64_5_HIGH + carryOut(seedLowWord, PRIME64_5_LOW, low)) | 0, low, length);
}

/** XXH64 of bytes[0, length), left in the result register. */
function hash64(bytes: Uint8Array, length: number, seedHighWord: number, seedLowWord: number): void {
  let position = 0;
  if (length >= 32) {
    resetLanes64(seedHighWord, seedLowWord);
    const stripeCount = Math.floor(length / 32);
    consumeStripes64(wordsOf(bytes, length), 0, stripeCount);
    position = stripeCount * 32;
    mergeLanes64(lanes64, length);
  } else {
    shortStart64(seedHighWord, seedLowWord, length);
  }
  finish64(bytes, position, length, loadHigh(), loadLow());
}

function hashInput(input: Input, seed: Seed64): void {
  checkSeed64(seed);
  const highWord = seed === 0 ? 0 : seedHigh(seed);
  const lowWord = seed === 0 ? 0 : seedLow(seed);
  if (typeof input === 'string') {
    const length = encodeToScratch(input);
    if (length >= 0) return hash64(scratch, length, highWord, lowWord);
    const encoded = encodeOwned(input);
    return hash64(encoded, encoded.length, highWord, lowWord);
  }
  const bytes = checkBytes(input);
  hash64(bytes, bytes.length, highWord, lowWord);
}

/** XXH64 of bytes or a string's UTF-8, as an unsigned 64-bit bigint. */
export function xxh64(input: Input, seed: Seed64 = 0): bigint {
  hashInput(input, seed);
  return loadBigInt();
}

/** XXH64 as two unsigned 32-bit halves: no bigint, for hot paths. */
export function xxh64Pair(input: Input, seed: Seed64 = 0): Uint64Pair {
  hashInput(input, seed);
  return loadPair();
}

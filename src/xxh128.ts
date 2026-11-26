import { checkBytes, encodeOwned, encodeToScratch } from './input.js';
import type { Input } from './input.js';
import { readWord, scratch, wordsOf } from './words.js';
import { borrowOut, carryOut, loadBigInt128, multiplyHigh32, store128, swap32 } from './uint64.js';
import type { Seed64, Uint64Pair } from './uint64.js';
import { avalanche3, avalanche64Wide, multiply128, wide } from './xxh3-math.js';
import { DEFAULT_SECRET, seededSecret } from './xxh3-secret.js';
import type { Xxh3Secret } from './xxh3-secret.js';
import { hashLong, lengthTimes, mergeAccumulators } from './xxh3-long.js';
import { keyHalves, keySecretOf, mixPieces, useKey } from './xxh3.js';

/** A 128-bit hash as its two 64-bit halves, each a pair of uint32s. */
export interface Uint128Pair {
  readonly high: Uint64Pair;
  readonly low: Uint64Pair;
}

const TWO_TO_MINUS_32 = 2.3283064365386963e-10;

/** The result's halves, as they are worked out: [0] [1] high 64 bits, [2] [3] low. */
const result = new Int32Array(4);

/** XXH3_len_1to3_128b, XXH3_len_4to8_128b, XXH3_len_9to16_128b and the empty input. */
function hashShort(bytes: Uint8Array, length: number, secret: Int32Array, seedHigh: number, seedLow: number): void {
  if (length > 8) {
    // bitflipLow = (secret[32..40) ^ secret[40..48)) - seed; bitflipHigh = (secret[48..56) ^ secret[56..64)) + seed
    const flipLow = secret[32] ^ secret[40];
    const bitflipLowLow = (flipLow - seedLow) | 0;
    const bitflipLowHigh = (secret[36] ^ secret[44]) - seedHigh - borrowOut(flipLow, seedLow, bitflipLowLow);
    const flipHigh = secret[48] ^ secret[56];
    const bitflipHighLow = (flipHigh + seedLow) | 0;
    const bitflipHighHigh = (secret[52] ^ secret[60]) + seedHigh + carryOut(flipHigh, seedLow, bitflipHighLow);
    const firstLow = readWord(bytes, 0);
    const firstHigh = readWord(bytes, 4);
    const lastLow = readWord(bytes, length - 8);
    const lastHigh = readWord(bytes, length - 4);
    // m128 = mult64to128(first ^ last ^ bitflipLow, PRIME64_1)
    multiply128(firstHigh ^ lastHigh ^ bitflipLowHigh, firstLow ^ lastLow ^ bitflipLowLow, 0x9e3779b1, 0x85ebca87);
    let productHighHigh = wide[0];
    let productHighLow = wide[1];
    // m128.low += (length - 1) << 54
    const productLowHigh = (wide[2] + ((length - 1) << 22)) | 0;
    let productLowLow = wide[3];
    // m128.high += last' + mult32to64(low32(last'), PRIME32_2 - 1), last' = last ^ bitflipHigh
    const keyedHigh = lastHigh ^ bitflipHighHigh;
    const keyedLow = lastLow ^ bitflipHighLow;
    const sum = (productHighLow >>> 0) + (keyedLow >>> 0) + (Math.imul(keyedLow, 0x85ebca76) >>> 0);
    productHighHigh = (productHighHigh + keyedHigh + multiplyHigh32(keyedLow, 0x85ebca76) + Math.floor(sum * TWO_TO_MINUS_32)) | 0;
    productHighLow = sum | 0;
    // m128.low ^= swap64(m128.high)
    const mixedLowHigh = productLowHigh ^ swap32(productHighLow);
    productLowLow ^= swap32(productHighHigh);
    // h128 = mult64to128(m128.low, PRIME64_2); h128.high += m128.high * PRIME64_2
    multiply128(mixedLowHigh, productLowLow, 0xc2b2ae3d | 0, 0x27d4eb4f);
    const hashHighHigh = (wide[0] + multiplyHigh32(productHighLow, 0x27d4eb4f) + Math.imul(productHighHigh, 0x27d4eb4f) + Math.imul(productHighLow, 0xc2b2ae3d)) | 0;
    const hashHighLow = (wide[1] + Math.imul(productHighLow, 0x27d4eb4f)) | 0;
    const hashHighCarry = carryOut(wide[1], Math.imul(productHighLow, 0x27d4eb4f), hashHighLow);
    avalanche3(wide[2], wide[3]);
    result[2] = wide[0];
    result[3] = wide[1];
    avalanche3((hashHighHigh + hashHighCarry) | 0, hashHighLow);
    result[0] = wide[0];
    result[1] = wide[1];
  } else if (length >= 4) {
    // seed ^= swap32(low32(seed)) << 32; bitflip = (secret[16..24) ^ secret[24..32)) + seed
    const seedHighMixed = seedHigh ^ swap32(seedLow);
    const flip = secret[16] ^ secret[24];
    const bitflipLow = (flip + seedLow) | 0;
    const bitflipHigh = (secret[20] ^ secret[28]) + seedHighMixed + carryOut(flip, seedLow, bitflipLow);
    // input64 = first word + (last word << 32); m128 = mult64to128(keyed, PRIME64_1 + (length << 2))
    multiply128(readWord(bytes, length - 4) ^ bitflipHigh, readWord(bytes, 0) ^ bitflipLow, 0x9e3779b1, 0x85ebca87 + length * 4);
    let highHigh = wide[0];
    let highLow = wide[1];
    let lowHigh = wide[2];
    let lowLow = wide[3];
    // m128.high += m128.low << 1
    const shiftedHigh = (lowHigh << 1) | (lowLow >>> 31);
    const shiftedLow = lowLow << 1;
    const sumLow = (highLow + shiftedLow) | 0;
    highHigh = (highHigh + shiftedHigh + carryOut(highLow, shiftedLow, sumLow)) | 0;
    highLow = sumLow;
    // m128.low ^= m128.high >> 3; then xorshift 35, * PRIME_MX2, xorshift 28
    lowLow ^= (highLow >>> 3) | (highHigh << 29);
    lowHigh ^= highHigh >>> 3;
    lowLow ^= lowHigh >>> 3;
    const mixedHigh = (multiplyHigh32(lowLow, 0x1e98df25) + Math.imul(lowHigh, 0x1e98df25) + Math.imul(lowLow, 0x9fb21c65)) | 0;
    const mixedLow = Math.imul(lowLow, 0x1e98df25);
    result[2] = mixedHigh ^ (mixedHigh >>> 28);
    result[3] = mixedLow ^ ((mixedLow >>> 28) | (mixedHigh << 4));
    avalanche3(highHigh, highLow);
    result[0] = wide[0];
    result[1] = wide[1];
  } else if (length > 0) {
    // combinedLow = { input[length - 1], length, input[0], input[length >> 1] };
    // combinedHigh = rotl32(swap32(combinedLow), 13)
    const combinedLow = (bytes[0] << 16) | (bytes[length >> 1] << 24) | bytes[length - 1] | (length << 8);
    const swapped = swap32(combinedLow);
    const combinedHigh = (swapped << 13) | (swapped >>> 19);
    // bitflipLow = (secret[0..4) ^ secret[4..8)) + seed; bitflipHigh = (secret[8..12) ^ secret[12..16)) - seed
    const flipLow = (secret[0] ^ secret[4]) >>> 0;
    const flippedLow = flipLow + (seedLow >>> 0);
    const flipHigh = (secret[8] ^ secret[12]) >>> 0;
    const flippedHigh = flipHigh - (seedLow >>> 0);
    avalanche64Wide((seedHigh + Math.floor(flippedLow * TWO_TO_MINUS_32)) | 0, combinedLow ^ (flippedLow | 0));
    result[2] = wide[0];
    result[3] = wide[1];
    avalanche64Wide((Math.floor(flippedHigh * TWO_TO_MINUS_32) - seedHigh) | 0, combinedHigh ^ (flippedHigh | 0));
    result[0] = wide[0];
    result[1] = wide[1];
  } else {
    avalanche64Wide(seedHigh ^ secret[68] ^ secret[76], seedLow ^ secret[64] ^ secret[72]);
    result[2] = wide[0];
    result[3] = wide[1];
    avalanche64Wide(seedHigh ^ secret[84] ^ secret[92], seedLow ^ secret[80] ^ secret[88]);
    result[0] = wide[0];
    result[1] = wide[1];
  }
}

/** XXH128_mix32B on the accumulator in result[0..3]:
 *   acc.low  += mix16B(first, secret);      acc.low  ^= read64(second) + read64(second + 8)
 *   acc.high += mix16B(second, secret + 16); acc.high ^= read64(first) + read64(first + 8) */
function mix32(view: DataView, first: number, second: number, secret: Int32Array, secretStart: number, seedHigh: number, seedLow: number): void {
  mixPieces(view, first, 0, secret, secretStart, 0, 1, seedHigh, seedLow, result[2], result[3]);
  let sum = (view.getInt32(second, true) >>> 0) + (view.getInt32(second + 8, true) >>> 0);
  result[2] = wide[0] ^ (view.getInt32(second + 4, true) + view.getInt32(second + 12, true) + Math.floor(sum * TWO_TO_MINUS_32));
  result[3] = wide[1] ^ sum;
  mixPieces(view, second, 0, secret, secretStart + 16, 0, 1, seedHigh, seedLow, result[0], result[1]);
  sum = (view.getInt32(first, true) >>> 0) + (view.getInt32(first + 8, true) >>> 0);
  result[0] = wide[0] ^ (view.getInt32(first + 4, true) + view.getInt32(first + 12, true) + Math.floor(sum * TWO_TO_MINUS_32));
  result[1] = wide[1] ^ sum;
}

/** The 17–240-byte finish: low = acc.low + acc.high;
 * high = acc.low * PRIME64_1 + acc.high * PRIME64_4 + (length - seed) * PRIME64_2;
 * then avalanche both and negate the high half. */
function finishMiddle(length: number, seedHigh: number, seedLow: number): void {
  const accHighHigh = result[0];
  const accHighLow = result[1];
  const accLowHigh = result[2];
  const accLowLow = result[3];
  // (length - seed) as 64 bits; length is at most 240.
  const differenceLow = (length - seedLow) | 0;
  const differenceHigh = -seedHigh - borrowOut(length, seedLow, differenceLow);
  const termLow1 = Math.imul(accLowLow, 0x85ebca87);
  const termLow2 = Math.imul(accHighLow, 0xc2b2ae63);
  const termLow3 = Math.imul(differenceLow, 0x27d4eb4f);
  const lowSum = (termLow1 >>> 0) + (termLow2 >>> 0) + (termLow3 >>> 0);
  const highSum = multiplyHigh32(accLowLow, 0x85ebca87) + Math.imul(accLowHigh, 0x85ebca87) + Math.imul(accLowLow, 0x9e3779b1)
    + multiplyHigh32(accHighLow, 0xc2b2ae63) + Math.imul(accHighHigh, 0xc2b2ae63) + Math.imul(accHighLow, 0x85ebca77)
    + multiplyHigh32(differenceLow, 0x27d4eb4f) + Math.imul(differenceHigh, 0x27d4eb4f) + Math.imul(differenceLow, 0xc2b2ae3d)
    + Math.floor(lowSum * TWO_TO_MINUS_32);
  const plainLow = (accLowLow + accHighLow) | 0;
  avalanche3((accLowHigh + accHighHigh + carryOut(accLowLow, accHighLow, plainLow)) | 0, plainLow);
  result[2] = wide[0];
  result[3] = wide[1];
  avalanche3(highSum | 0, lowSum | 0);
  // 0 - avalanche(high)
  const negatedLow = -wide[1] | 0;
  result[0] = ~wide[0] + (negatedLow === 0 ? 1 : 0);
  result[1] = negatedLow;
}

/** XXH3-128 of bytes[0, length), into `result`. */
function hash128(bytes: Uint8Array, length: number, seedHigh: number, seedLow: number, secret: Xxh3Secret | undefined): void {
  const words = (secret ?? DEFAULT_SECRET).words;
  if (length <= 16) return hashShort(bytes, length, words, seedHigh, seedLow);
  if (length <= 240) {
    lengthTimes(length, 0x9e3779b1 | 0, 0x85ebca87 | 0);
    result[0] = 0;
    result[1] = 0;
    result[2] = wide[0];
    result[3] = wide[1];
    const view = wordsOf(bytes, length);
    if (length <= 128) {
      if (length > 32) {
        if (length > 64) {
          if (length > 96) mix32(view, 48, length - 64, words, 96, seedHigh, seedLow);
          mix32(view, 32, length - 48, words, 64, seedHigh, seedLow);
        }
        mix32(view, 16, length - 32, words, 32, seedHigh, seedLow);
      }
      mix32(view, 0, length - 16, words, 0, seedHigh, seedLow);
    } else {
      for (let index = 32; index < 160; index += 32) mix32(view, index - 32, index - 16, words, index - 32, seedHigh, seedLow);
      avalanche3(result[2], result[3]);
      result[2] = wide[0];
      result[3] = wide[1];
      avalanche3(result[0], result[1]);
      result[0] = wide[0];
      result[1] = wide[1];
      for (let index = 160; index <= length; index += 32) mix32(view, index - 32, index - 16, words, index - 157, seedHigh, seedLow);
      // The last 32 bytes, in reverse order, with the seed negated.
      const negatedLow = -seedLow | 0;
      const negatedHigh = ~seedHigh + (negatedLow === 0 ? 1 : 0);
      mix32(view, length - 16, length - 32, words, 103, negatedHigh, negatedLow);
    }
    return finishMiddle(length, seedHigh, seedLow);
  }
  const longSecret = secret ?? seededSecret(seedHigh, seedLow);
  hashLong(wordsOf(bytes, length), length, longSecret);
  mergeLong128(length, longSecret);
}

/** XXH3_finalizeLong_128b, from the accumulators, into `result`. */
function mergeLong128(length: number, secret: Xxh3Secret): void {
  lengthTimes(length, 0x9e3779b1 | 0, 0x85ebca87 | 0);
  mergeAccumulators(secret.words, 11, wide[0], wide[1]);
  result[2] = wide[0];
  result[3] = wide[1];
  // ~(length * PRIME64_2)
  lengthTimes(length, 0xc2b2ae3d | 0, 0x27d4eb4f);
  mergeAccumulators(secret.words, secret.size - 64 - 11, ~wide[0], ~wide[1]);
  result[0] = wide[0];
  result[1] = wide[1];
}

function hashInput(input: Input, seedOrSecret: Seed64 | Xxh3Secret): void {
  useKey(seedOrSecret);
  const secret = keySecretOf();
  if (typeof input === 'string') {
    const length = encodeToScratch(input);
    if (length >= 0) return hash128(scratch, length, keyHalves[0], keyHalves[1], secret);
    const encoded = encodeOwned(input);
    return hash128(encoded, encoded.length, keyHalves[0], keyHalves[1], secret);
  }
  const bytes = checkBytes(input);
  hash128(bytes, bytes.length, keyHalves[0], keyHalves[1], secret);
}

/** For streaming: XXH3-128 of a whole short input, or the long finish from the
 * accumulators. Returns the result register, [high high, high low, low high, low low]. */
export function shortResult128(bytes: Uint8Array, length: number, seedHigh: number, seedLow: number, secret: Xxh3Secret | undefined): Int32Array {
  hash128(bytes, length, seedHigh, seedLow, secret);
  return result;
}
export function longResult128(length: number, secret: Xxh3Secret): Int32Array {
  mergeLong128(length, secret);
  return result;
}

/** Store a 128-bit result register into the bigint register. */
export function storeResult128(words: Int32Array): void {
  store128(words[0], words[1], words[2], words[3]);
}

export function pairOf128(words: Int32Array): Uint128Pair {
  return {
    high: { high: words[0] >>> 0, low: words[1] >>> 0 },
    low: { high: words[2] >>> 0, low: words[3] >>> 0 },
  };
}

/** XXH3-128 of bytes or a string's UTF-8, as an unsigned 128-bit bigint.
 * The second argument is a seed, or a secret from `xxh3Secret`. */
export function xxh128(input: Input, seedOrSecret: Seed64 | Xxh3Secret = 0): bigint {
  hashInput(input, seedOrSecret);
  storeResult128(result);
  return loadBigInt128();
}

/** XXH3-128 as 64-bit halves of uint32 pairs: no bigint, for hot paths. */
export function xxh128Pair(input: Input, seedOrSecret: Seed64 | Xxh3Secret = 0): Uint128Pair {
  hashInput(input, seedOrSecret);
  return pairOf128(result);
}

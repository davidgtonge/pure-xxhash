import { checkBytes, encodeOwned, encodeToScratch } from './input.js';
import type { Input } from './input.js';
import { readWord, scratch, wordsOf } from './words.js';
import { checkSeed64, loadBigInt, loadPair, seedHigh, seedLow, store64, swap32 } from './uint64.js';
import type { Seed64, Uint64Pair } from './uint64.js';
import { avalanche3, avalanche64Wide, foldedMultiply, rrmxmx, wide } from './xxh3-math.js';
import { DEFAULT_SECRET, isSecret, seededSecret } from './xxh3-secret.js';
import type { Xxh3Secret } from './xxh3-secret.js';
import { hashLong, lengthTimes, mergeAccumulators } from './xxh3-long.js';

const TWO_TO_MINUS_32 = 2.3283064365386963e-10;

/** Sum of mix16B over `count` 16-byte pieces, added to (sumHigh, sumLow), into
 * wide[0..1]. Piece k reads the input at inputStart + k·inputStep and the
 * secret at secretStart + k·secretStep. mix16B is
 *   mul128_fold64(input64 ^ (secret64 + seed), input64' ^ (secret64' - seed))
 * spelled out, multiply-highs included, as it's the whole cost of 17–240-byte
 * inputs: with calls to multiplyHigh32 and byte loads it was about 2× slower. */
export function mixPieces(
  view: DataView, inputStart: number, inputStep: number, secret: Int32Array, secretStart: number, secretStep: number,
  count: number, seedHighWord: number, seedLowWord: number, sumHigh: number, sumLow: number,
): void {
  for (let piece = 0; piece < count; piece++) {
    const input = inputStart + piece * inputStep;
    const key = secretStart + piece * secretStep;
    // left = input[0..8) ^ (secret[0..8) + seed)
    let keyLow = secret[key];
    let addedLow = (keyLow + seedLowWord) | 0;
    const leftHigh = view.getInt32(input + 4, true) ^ ((secret[key + 4] + seedHighWord + (((keyLow & seedLowWord) | ((keyLow | seedLowWord) & ~addedLow)) >>> 31)) | 0);
    const leftLow = view.getInt32(input, true) ^ addedLow;
    // right = input[8..16) ^ (secret[8..16) - seed)
    keyLow = secret[key + 8];
    addedLow = (keyLow - seedLowWord) | 0;
    const rightHigh = view.getInt32(input + 12, true) ^ ((secret[key + 12] - seedHighWord - (((~keyLow & seedLowWord) | (~(keyLow ^ seedLowWord) & addedLow)) >>> 31)) | 0);
    const rightLow = view.getInt32(input + 8, true) ^ addedLow;
    // The 128-bit product from four 32 × 32-bit products, each high half as
    // (left * right - low) * 2^-32 rounded; then its two halves xored.
    const leftLowUnsigned = leftLow >>> 0;
    const leftHighUnsigned = leftHigh >>> 0;
    const rightLowUnsigned = rightLow >>> 0;
    const rightHighUnsigned = rightHigh >>> 0;
    const lowByLow = Math.imul(leftLow, rightLow) >>> 0;
    const highByLow = Math.imul(leftHigh, rightLow) >>> 0;
    const lowByHigh = Math.imul(leftLow, rightHigh) >>> 0;
    const highByHigh = Math.imul(leftHigh, rightHigh) >>> 0;
    const cross = Math.floor((leftLowUnsigned * rightLowUnsigned - lowByLow) * TWO_TO_MINUS_32 + 0.5) + highByLow + lowByHigh;
    const crossHigh = Math.floor((leftLowUnsigned * rightHighUnsigned - lowByHigh) * TWO_TO_MINUS_32 + 0.5) + Math.floor(cross * TWO_TO_MINUS_32);
    const upper = Math.floor((leftHighUnsigned * rightLowUnsigned - highByLow) * TWO_TO_MINUS_32 + 0.5) + crossHigh + highByHigh;
    const foldHigh = ((Math.floor((leftHighUnsigned * rightHighUnsigned - highByHigh) * TWO_TO_MINUS_32 + 0.5) + Math.floor(upper * TWO_TO_MINUS_32)) | 0) ^ (cross | 0);
    const foldLow = (upper | 0) ^ (lowByLow | 0);
    const nextLow = (sumLow + foldLow) | 0;
    sumHigh = (sumHigh + foldHigh + (((sumLow & foldLow) | ((sumLow | foldLow) & ~nextLow)) >>> 31)) | 0;
    sumLow = nextLow;
  }
  wide[0] = sumHigh;
  wide[1] = sumLow;
}

/** XXH3-64 of 0–16 bytes, into wide[0..1]. */
function hashShort(bytes: Uint8Array, length: number, secret: Int32Array, seedHighWord: number, seedLowWord: number): void {
  if (length > 8) {
    // bitflip1 = (secret[24..32) ^ secret[32..40)) + seed; bitflip2 = (secret[40..48) ^ secret[48..56)) - seed
    let flipLow = secret[24] ^ secret[32];
    let flippedLow = (flipLow + seedLowWord) | 0;
    const inputLowHigh = readWord(bytes, 4) ^ ((secret[28] ^ secret[36]) + seedHighWord + (((flipLow & seedLowWord) | ((flipLow | seedLowWord) & ~flippedLow)) >>> 31));
    const inputLowLow = readWord(bytes, 0) ^ flippedLow;
    flipLow = secret[40] ^ secret[48];
    flippedLow = (flipLow - seedLowWord) | 0;
    const inputHighHigh = readWord(bytes, length - 4) ^ ((secret[44] ^ secret[52]) - seedHighWord - (((~flipLow & seedLowWord) | (~(flipLow ^ seedLowWord) & flippedLow)) >>> 31));
    const inputHighLow = readWord(bytes, length - 8) ^ flippedLow;
    // acc = length + swap64(inputLow) + inputHigh + mul128_fold64(inputLow, inputHigh)
    foldedMultiply(inputLowHigh, inputLowLow, inputHighHigh, inputHighLow);
    const sum = length + (swap32(inputLowHigh) >>> 0) + (inputHighLow >>> 0) + (wide[1] >>> 0);
    avalanche3((swap32(inputLowLow) + inputHighHigh + wide[0] + Math.floor(sum * TWO_TO_MINUS_32)) | 0, sum | 0);
  } else if (length >= 4) {
    // seed ^= swap32(low32(seed)) << 32; bitflip = (secret[8..16) ^ secret[16..24)) - seed
    const seedHighMixed = seedHighWord ^ swap32(seedLowWord);
    const flipLow = secret[8] ^ secret[16];
    const flippedLow = (flipLow - seedLowWord) | 0;
    const flippedHigh = (secret[12] ^ secret[20]) - seedHighMixed - (((~flipLow & seedLowWord) | (~(flipLow ^ seedLowWord) & flippedLow)) >>> 31);
    // input64 = last word + (first word << 32)
    rrmxmx(readWord(bytes, 0) ^ flippedHigh, readWord(bytes, length - 4) ^ flippedLow, length);
  } else if (length > 0) {
    // combined = { input[length - 1], length, input[0], input[length >> 1] } as a uint32
    const combined = (bytes[0] << 16) | (bytes[length >> 1] << 24) | bytes[length - 1] | (length << 8);
    const flip = (secret[0] ^ secret[4]) >>> 0;
    const flipped = flip + (seedLowWord >>> 0);
    avalanche64Wide((seedHighWord + Math.floor(flipped * TWO_TO_MINUS_32)) | 0, combined ^ (flipped | 0));
  } else {
    avalanche64Wide(seedHighWord ^ secret[60] ^ secret[68], seedLowWord ^ secret[56] ^ secret[64]);
  }
}

/** XXH3-64 of bytes[0, length), into wide[0..1]. `secret` is a custom secret,
 * or undefined for the default one (derived from the seed for long inputs). */
export function hash3(bytes: Uint8Array, length: number, seedHighWord: number, seedLowWord: number, secret: Xxh3Secret | undefined): void {
  const words = (secret ?? DEFAULT_SECRET).words;
  if (length <= 16) return hashShort(bytes, length, words, seedHighWord, seedLowWord);
  lengthTimes(length, 0x9e3779b1 | 0, 0x85ebca87 | 0);
  const view = wordsOf(bytes, length);
  if (length <= 128) {
    // Front pieces 0, 16, 32, 48 with secret 0, 32, 64, 96; back pieces from
    // the end with secret 16, 48, 80, 112. Addition commutes, so each side
    // can be one run.
    const count = ((length - 1) >>> 5) + 1;
    mixPieces(view, 0, 16, words, 0, 32, count, seedHighWord, seedLowWord, wide[0], wide[1]);
    mixPieces(view, length - 16, -16, words, 16, 32, count, seedHighWord, seedLowWord, wide[0], wide[1]);
    return avalanche3(wide[0], wide[1]);
  }
  if (length <= 240) {
    // The first 128 bytes, avalanched; then the rest, 3 bytes into the secret,
    // and the last 16 bytes with the secret 17 bytes before its 136th.
    mixPieces(view, 0, 16, words, 0, 16, 8, seedHighWord, seedLowWord, wide[0], wide[1]);
    avalanche3(wide[0], wide[1]);
    const firstHigh = wide[0];
    const firstLow = wide[1];
    mixPieces(view, length - 16, 0, words, 119, 0, 1, seedHighWord, seedLowWord, 0, 0);
    mixPieces(view, 128, 16, words, 3, 16, (length >>> 4) - 8, seedHighWord, seedLowWord, wide[0], wide[1]);
    const restLow = wide[1];
    const sumLow = (firstLow + restLow) | 0;
    return avalanche3((firstHigh + wide[0] + (((firstLow & restLow) | ((firstLow | restLow) & ~sumLow)) >>> 31)) | 0, sumLow);
  }
  const longSecret = secret ?? seededSecret(seedHighWord, seedLowWord);
  hashLong(wordsOf(bytes, length), length, longSecret);
  mergeLong64(length, longSecret);
}

/** XXH3_finalizeLong_64b, from the accumulators, into wide[0..1]. */
export function mergeLong64(length: number, secret: Xxh3Secret): void {
  lengthTimes(length, 0x9e3779b1 | 0, 0x85ebca87 | 0);
  mergeAccumulators(secret.words, 11, wide[0], wide[1]);
}

/** The key of the current call, written by `useKey` and read straight back:
 * the seed's halves in an Int32Array (unboxed), and the custom secret if any. */
export const keyHalves = new Int32Array(2);
let keySecret: Xxh3Secret | undefined;

/** Check a seed or secret and spread it into `keyHalves` and the key secret,
 * which `keySecretOf` returns. A custom secret means seed 0. */
export function useKey(seedOrSecret: Seed64 | Xxh3Secret): void {
  keySecret = undefined;
  if (seedOrSecret === 0) {
    keyHalves[0] = 0;
    keyHalves[1] = 0;
  } else if (typeof seedOrSecret === 'object') {
    if (!isSecret(seedOrSecret)) throw new TypeError('pure-xxhash: a secret must come from xxh3Secret()');
    keyHalves[0] = 0;
    keyHalves[1] = 0;
    keySecret = seedOrSecret;
  } else {
    checkSeed64(seedOrSecret);
    keyHalves[0] = seedHigh(seedOrSecret);
    keyHalves[1] = seedLow(seedOrSecret);
  }
}

export function keySecretOf(): Xxh3Secret | undefined {
  return keySecret;
}

function hashInput(input: Input, seedOrSecret: Seed64 | Xxh3Secret): void {
  useKey(seedOrSecret);
  if (typeof input === 'string') {
    const length = encodeToScratch(input);
    if (length >= 0) return hash3(scratch, length, keyHalves[0], keyHalves[1], keySecret);
    const encoded = encodeOwned(input);
    return hash3(encoded, encoded.length, keyHalves[0], keyHalves[1], keySecret);
  }
  const bytes = checkBytes(input);
  hash3(bytes, bytes.length, keyHalves[0], keyHalves[1], keySecret);
}

/** XXH3-64 of bytes or a string's UTF-8, as an unsigned 64-bit bigint.
 * The second argument is a seed, or a secret from `xxh3Secret`. */
export function xxh3(input: Input, seedOrSecret: Seed64 | Xxh3Secret = 0): bigint {
  hashInput(input, seedOrSecret);
  store64(wide[0], wide[1]);
  return loadBigInt();
}

/** XXH3-64 as two unsigned 32-bit halves: no bigint, for hot paths. */
export function xxh3Pair(input: Input, seedOrSecret: Seed64 | Xxh3Secret = 0): Uint64Pair {
  hashInput(input, seedOrSecret);
  store64(wide[0], wide[1]);
  return loadPair();
}


import { checkBytes, encodeOwned, encodeToScratch } from './input.js';
import type { Input } from './input.js';
import { readWord, scratch, wordsOf } from './words.js';

// The five XXH32 primes, as int32 so Math.imul and `| 0` keep them unboxed.
export const PRIME32_1 = 0x9e3779b1 | 0;
export const PRIME32_2 = 0x85ebca77 | 0;
export const PRIME32_3 = 0xc2b2ae3d | 0;
const PRIME32_4 = 0x27d4eb2f | 0;
export const PRIME32_5 = 0x165667b1 | 0;

function rotateLeft32(value: number, count: number): number {
  return (value << count) | (value >>> (32 - count));
}

/** A uint32 seed; anything else is a RangeError rather than silently wrapped. */
export function checkSeed32(seed: number): number {
  if ((seed >>> 0) !== seed) throw new RangeError('pure-xxhash: an XXH32 seed must be an integer from 0 to 0xffffffff');
  return seed;
}

/** The four accumulator lanes, as working space for one synchronous call:
 * the stripe loop reads them at its start and writes them back at its end. */
export const lanes32 = new Int32Array(4);

/** Run whole 16-byte stripes, from `start`, through the lanes in `lanes32`. */
export function stripes32(view: DataView, start: number, stripeCount: number): void {
  let lane1 = lanes32[0];
  let lane2 = lanes32[1];
  let lane3 = lanes32[2];
  let lane4 = lanes32[3];
  const end = start + stripeCount * 16;
  for (let position = start; position < end; position += 16) {
    lane1 = Math.imul(rotateLeft32((lane1 + Math.imul(view.getInt32(position, true), PRIME32_2)) | 0, 13), PRIME32_1);
    lane2 = Math.imul(rotateLeft32((lane2 + Math.imul(view.getInt32(position + 4, true), PRIME32_2)) | 0, 13), PRIME32_1);
    lane3 = Math.imul(rotateLeft32((lane3 + Math.imul(view.getInt32(position + 8, true), PRIME32_2)) | 0, 13), PRIME32_1);
    lane4 = Math.imul(rotateLeft32((lane4 + Math.imul(view.getInt32(position + 12, true), PRIME32_2)) | 0, 13), PRIME32_1);
  }
  lanes32[0] = lane1;
  lanes32[1] = lane2;
  lanes32[2] = lane3;
  lanes32[3] = lane4;
}

/** Stripes per call of `stripes32` (16 KiB). A loop that runs long on its first
 * call is compiled by V8 mid-loop (OSR), with no type feedback yet for the code
 * after it, and that code was 4× slower than a normal compile and deoptimized on
 * every call. Short calls get the normal compile after a few hashes. */
export const STRIPES_PER_CALL = 1024;

/** `stripes32` in calls of at most STRIPES_PER_CALL stripes. */
export function consumeStripes32(view: DataView, start: number, stripeCount: number): void {
  for (; stripeCount > STRIPES_PER_CALL; stripeCount -= STRIPES_PER_CALL, start += STRIPES_PER_CALL * 16) {
    stripes32(view, start, STRIPES_PER_CALL);
  }
  stripes32(view, start, stripeCount);
}

export function resetLanes32(seed: number): void {
  lanes32[0] = seed + PRIME32_1 + PRIME32_2;
  lanes32[1] = seed + PRIME32_2;
  lanes32[2] = seed;
  lanes32[3] = seed - PRIME32_1;
}

export function mergeLanes32(lanes: Int32Array): number {
  return (rotateLeft32(lanes[0], 1) + rotateLeft32(lanes[1], 7) + rotateLeft32(lanes[2], 12) + rotateLeft32(lanes[3], 18)) | 0;
}

/** Mix in the last 0–15 bytes, bytes[position, end), then avalanche. */
export function finish32(bytes: Uint8Array, position: number, end: number, hash: number): number {
  for (; position + 4 <= end; position += 4) {
    hash = Math.imul(rotateLeft32((hash + Math.imul(readWord(bytes, position), PRIME32_3)) | 0, 17), PRIME32_4);
  }
  for (; position < end; position++) {
    hash = Math.imul(rotateLeft32((hash + Math.imul(bytes[position], PRIME32_5)) | 0, 11), PRIME32_1);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, PRIME32_2);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, PRIME32_3);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** XXH32 of bytes[0, length). */
function hash32(bytes: Uint8Array, length: number, seed: number): number {
  let hash = (seed + PRIME32_5) | 0;
  let position = 0;
  if (length >= 16 && length < 64) {
    // One to three stripes: byte loads and lanes in locals beat copying into
    // the scratch view (41 ns against 22 ns at 16 bytes).
    let lane1 = (seed + PRIME32_1 + PRIME32_2) | 0;
    let lane2 = (seed + PRIME32_2) | 0;
    let lane3 = seed | 0;
    let lane4 = (seed - PRIME32_1) | 0;
    for (; position <= length - 16; position += 16) {
      lane1 = Math.imul(rotateLeft32((lane1 + Math.imul(readWord(bytes, position), PRIME32_2)) | 0, 13), PRIME32_1);
      lane2 = Math.imul(rotateLeft32((lane2 + Math.imul(readWord(bytes, position + 4), PRIME32_2)) | 0, 13), PRIME32_1);
      lane3 = Math.imul(rotateLeft32((lane3 + Math.imul(readWord(bytes, position + 8), PRIME32_2)) | 0, 13), PRIME32_1);
      lane4 = Math.imul(rotateLeft32((lane4 + Math.imul(readWord(bytes, position + 12), PRIME32_2)) | 0, 13), PRIME32_1);
    }
    hash = (rotateLeft32(lane1, 1) + rotateLeft32(lane2, 7) + rotateLeft32(lane3, 12) + rotateLeft32(lane4, 18)) | 0;
  } else if (length >= 16) {
    resetLanes32(seed);
    const stripeCount = Math.floor(length / 16);
    consumeStripes32(wordsOf(bytes, length), 0, stripeCount);
    position = stripeCount * 16;
    hash = mergeLanes32(lanes32);
  }
  return finish32(bytes, position, length, (hash + length) | 0);
}

/** XXH32 of bytes or a string's UTF-8, as an unsigned 32-bit number. */
export function xxh32(input: Input, seed = 0): number {
  checkSeed32(seed);
  if (typeof input === 'string') {
    const length = encodeToScratch(input);
    if (length >= 0) return hash32(scratch, length, seed);
    const encoded = encodeOwned(input);
    return hash32(encoded, encoded.length, seed);
  }
  const bytes = checkBytes(input);
  return hash32(bytes, bytes.length, seed);
}

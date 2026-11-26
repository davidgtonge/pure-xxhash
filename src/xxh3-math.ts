/** The XXH3 mixing steps on 32-bit halves.
 *
 * Each step's 64- or 128-bit result goes into `wide`, a four-word register
 * read straight back by the caller in the same synchronous call: JavaScript
 * can't return two numbers without allocating, and an Int32Array holds int32s
 * unboxed. Layout: [0] high, [1] low of a 64-bit result; for a 128-bit product,
 * [0] [1] the high 64 bits and [2] [3] the low 64 bits. */
export const wide = new Int32Array(4);

const TWO_TO_MINUS_32 = 2.3283064365386963e-10;

/* Each 32 × 32-bit product's high half is written out as in multiplyHigh32
 * (uint64.ts), (left * right - low) * 2^-32 rounded, reusing the low half
 * these functions need anyway. Calling multiplyHigh32 instead ran past V8's
 * inlining budget in the short-input paths, and each call that was left out
 * boxed its arguments. */

/** The full 128-bit product of two 64-bit values (XXH_mult64to128), into
 * wide[0..3], from four 32 × 32-bit products. Sums of three uint32s stay below
 * 2^34, exact in a double, so their carries are plain divisions. */
export function multiply128(leftHigh: number, leftLow: number, rightHigh: number, rightLow: number): void {
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
  wide[0] = Math.floor((leftHighUnsigned * rightHighUnsigned - highByHigh) * TWO_TO_MINUS_32 + 0.5) + Math.floor(upper * TWO_TO_MINUS_32);
  wide[1] = upper;
  wide[2] = cross;
  wide[3] = lowByLow;
}

/** XXH3_mul128_fold64: the 128-bit product's two halves xored, into wide[0..1]. */
export function foldedMultiply(leftHigh: number, leftLow: number, rightHigh: number, rightLow: number): void {
  multiply128(leftHigh, leftLow, rightHigh, rightLow);
  wide[0] ^= wide[2];
  wide[1] ^= wide[3];
}

/** XXH3_avalanche: h ^= h >> 37; h *= 0x165667919E3779F9; h ^= h >> 32. Into wide[0..1]. */
export function avalanche3(high: number, low: number): void {
  low ^= high >>> 5;
  const productLow = Math.imul(low, 0x9e3779f9);
  const mixedHigh = (((((low >>> 0) * 0x9e3779f9 - (productLow >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0)
    + Math.imul(high, 0x9e3779f9) + Math.imul(low, 0x16566791)) | 0;
  wide[0] = mixedHigh;
  wide[1] = productLow ^ mixedHigh;
}

/** XXH64_avalanche: h ^= h >> 33; h *= PRIME64_2; h ^= h >> 29; h *= PRIME64_3; h ^= h >> 32. Into wide[0..1]. */
export function avalanche64Wide(high: number, low: number): void {
  low ^= high >>> 1;
  let productLow = Math.imul(low, 0x27d4eb4f);
  let nextHigh = (((((low >>> 0) * 0x27d4eb4f - (productLow >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0)
    + Math.imul(high, 0x27d4eb4f) + Math.imul(low, 0xc2b2ae3d)) | 0;
  low = productLow;
  high = nextHigh;
  low ^= (low >>> 29) | (high << 3);
  high ^= high >>> 29;
  productLow = Math.imul(low, 0x9e3779f9);
  nextHigh = (((((low >>> 0) * 0x9e3779f9 - (productLow >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0)
    + Math.imul(high, 0x9e3779f9) + Math.imul(low, 0x165667b1)) | 0;
  wide[0] = nextHigh;
  wide[1] = productLow ^ nextHigh;
}

/** XXH3_rrmxmx, the 4–8 byte finisher, into wide[0..1]:
 * h ^= rotl(h, 49) ^ rotl(h, 24); h *= PRIME_MX2; h ^= (h >> 35) + length;
 * h *= PRIME_MX2; h ^= h >> 28. */
export function rrmxmx(high: number, low: number, length: number): void {
  const nextHigh = high ^ ((low << 17) | (high >>> 15)) ^ ((high << 24) | (low >>> 8));
  low ^= ((high << 17) | (low >>> 15)) ^ ((low << 24) | (high >>> 8));
  high = nextHigh;
  // PRIME_MX2 = 0x9FB21C651E98DF25
  let productLow = Math.imul(low, 0x1e98df25);
  let productHigh = (((((low >>> 0) * 0x1e98df25 - (productLow >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0)
    + Math.imul(high, 0x1e98df25) + Math.imul(low, 0x9fb21c65)) | 0;
  low = productLow;
  high = productHigh;
  // (h >> 35) + length is below 2^30, so adding it can't carry.
  low ^= (high >>> 3) + length;
  productLow = Math.imul(low, 0x1e98df25);
  productHigh = (((((low >>> 0) * 0x1e98df25 - (productLow >>> 0)) * TWO_TO_MINUS_32 + 0.5) | 0)
    + Math.imul(high, 0x1e98df25) + Math.imul(low, 0x9fb21c65)) | 0;
  low = productLow;
  high = productHigh;
  wide[0] = high ^ (high >>> 28);
  wide[1] = low ^ ((low >>> 28) | (high << 4));
}

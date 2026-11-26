/** 64-bit values as pairs of 32-bit halves, without BigInt.
 *
 * A 64-bit value is two int32 numbers, `high` and `low`. JavaScript can't return
 * two numbers without allocating, so the arithmetic is written out half by half
 * where it's used, with the few small helpers here, and 64- and 128-bit
 * results travel through typed-array registers (below, and `wide` in
 * xxh3-math.ts), which hold int32s unboxed. */

/** A 64-bit hash as two unsigned 32-bit halves: the cheap form of a result. */
export interface Uint64Pair {
  readonly high: number;
  readonly low: number;
}

/** A 64-bit seed: a bigint from 0 to 2^64 - 1, or a safe nonnegative integer. */
export type Seed64 = bigint | number;

/** High 32 bits of the 64-bit product of two uint32s (given as int32 or uint32).
 *
 * The float product is within 2^12 of the exact one, and Math.imul gives the
 * exact low 32 bits, so (float product - low) / 2^32 is within 2^-20 of the
 * exact high half and rounds to it. Its bytecode is a quarter the size of the
 * 16-bit-limb version, which matters: V8 inlines functions only within a
 * per-caller bytecode budget, and the limb version ran out of it, leaving calls
 * that boxed their int32 arguments. */
export function multiplyHigh32(left: number, right: number): number {
  return (((left >>> 0) * (right >>> 0) - (Math.imul(left, right) >>> 0)) * 2.3283064365386963e-10 + 0.5) | 0;
}

/** Carry out of a 32-bit sum, 0 or 1, from the bits of its terms and the
 * wrapped sum. Branch-free: written as a comparison, V8 branched on it. */
export function carryOut(left: number, right: number, sum: number): number {
  return ((left & right) | ((left | right) & ~sum)) >>> 31;
}

/** Borrow out of a 32-bit difference, 0 or 1, likewise branch-free. */
export function borrowOut(left: number, right: number, difference: number): number {
  return ((~left & right) | (~(left ^ right) & difference)) >>> 31;
}

/** Byte-swap a 32-bit word. */
export function swap32(value: number): number {
  return ((value & 0xff) << 24) | ((value & 0xff00) << 8) | ((value >>> 8) & 0xff00) | (value >>> 24);
}

/** The result register. A hash writes its result here and the public function
 * reads it straight back, in the same synchronous call, as a bigint or a pair:
 * JavaScript can't return two numbers without allocating, and reading a
 * BigUint64Array element (23 ns) is cheaper than building a bigint from two
 * halves with shifts (50 ns). Nothing keeps a reference to it. */
const resultWords = new Uint32Array(4);
const resultBigs = new BigUint64Array(resultWords.buffer);
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const LOW_WORD = littleEndian ? 0 : 1;
const HIGH_WORD = littleEndian ? 1 : 0;

export function store64(high: number, low: number): void {
  resultWords[LOW_WORD] = low;
  resultWords[HIGH_WORD] = high;
}

/** Store a 128-bit result as its high and low 64-bit halves. */
export function store128(highHigh: number, highLow: number, lowHigh: number, lowLow: number): void {
  resultWords[LOW_WORD] = lowLow;
  resultWords[HIGH_WORD] = lowHigh;
  resultWords[2 + LOW_WORD] = highLow;
  resultWords[2 + HIGH_WORD] = highHigh;
}

/** The halves of a stored 64-bit result, as int32 for further arithmetic. */
export function loadHigh(): number {
  return resultWords[HIGH_WORD] | 0;
}
export function loadLow(): number {
  return resultWords[LOW_WORD] | 0;
}

export function loadBigInt(): bigint {
  return resultBigs[0];
}

export function loadPair(): Uint64Pair {
  return { high: resultWords[HIGH_WORD], low: resultWords[LOW_WORD] };
}

export function loadBigInt128(): bigint {
  return (resultBigs[1] << 64n) | resultBigs[0];
}

const TWO_TO_32 = 4294967296;

/** Check a 64-bit seed; RangeError for anything that isn't exactly a uint64. */
export function checkSeed64(seed: Seed64): void {
  if (typeof seed === 'number') {
    if (Number.isSafeInteger(seed) && seed >= 0) return;
  } else if (typeof seed === 'bigint') {
    if (seed >= 0n && seed <= 0xffffffffffffffffn) return;
  }
  throw new RangeError('pure-xxhash: a 64-bit seed must be a bigint from 0 to 2^64 - 1 or a safe nonnegative integer');
}

/** The halves of a checked seed. */
export function seedHigh(seed: Seed64): number {
  return typeof seed === 'number' ? Math.floor(seed / TWO_TO_32) | 0 : Number(seed >> 32n) | 0;
}
export function seedLow(seed: Seed64): number {
  return typeof seed === 'number' ? seed | 0 : Number(seed & 0xffffffffn) | 0;
}

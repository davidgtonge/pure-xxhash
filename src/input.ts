import { scratch } from './words.js';

/** What every hash accepts: bytes, or a string hashed as its UTF-8 encoding. */
export type Input = Uint8Array | string;

const encoder = new TextEncoder();

// Below this many UTF-16 units, a JS loop beats TextEncoder.encodeInto's call overhead.
const SHORT_STRING = 64;
// Strings up to this many UTF-16 units are encoded into the scratch area, not a new array.
const SCRATCH_STRING = 4096;


const typedArrayName = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag,
)!.get!;

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => (unit & 0xfc00) === 0xdc00;

/** UTF-8 encode a short string into the scratch area, with TextEncoder's
 * lone-surrogate policy (a lone surrogate becomes U+FFFD). Returns the length. */
function encodeShort(value: string): number {
  let offset = 0;
  for (let index = 0; index < value.length; index++) {
    let codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) {
      scratch[offset++] = codePoint;
    } else if (codePoint < 0x800) {
      scratch[offset++] = 0xc0 | (codePoint >>> 6);
      scratch[offset++] = 0x80 | (codePoint & 63);
    } else if (isHighSurrogate(codePoint) && index + 1 < value.length && isLowSurrogate(value.charCodeAt(index + 1))) {
      codePoint = 0x10000 + ((codePoint & 1023) << 10) + (value.charCodeAt(++index) & 1023);
      scratch[offset++] = 0xf0 | (codePoint >>> 18);
      scratch[offset++] = 0x80 | ((codePoint >>> 12) & 63);
      scratch[offset++] = 0x80 | ((codePoint >>> 6) & 63);
      scratch[offset++] = 0x80 | (codePoint & 63);
    } else {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
      scratch[offset++] = 0xe0 | (codePoint >>> 12);
      scratch[offset++] = 0x80 | ((codePoint >>> 6) & 63);
      scratch[offset++] = 0x80 | (codePoint & 63);
    }
  }
  return offset;
}

/** Encode a string into `scratch` and return its UTF-8 length, or -1 when it
 * is too long for the scratch area (then use `encodeOwned`). */
export function encodeToScratch(value: string): number {
  if (value.length < SHORT_STRING) return encodeShort(value);
  if (value.length <= SCRATCH_STRING) return encoder.encodeInto(value, scratch).written;
  return -1;
}

export function encodeOwned(value: string): Uint8Array {
  return encoder.encode(value);
}

/** The input as bytes, for callers that have already handled strings. */
export function checkBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  // Another realm's Uint8Array fails instanceof; check the intrinsic tag instead.
  if (typedArrayName.call(input) === 'Uint8Array') return input as Uint8Array;
  throw new TypeError('pure-xxhash: input must be a Uint8Array or a string');
}

/** The bytes of any input, for streaming updates. A string gets its own
 * array, since the update itself uses the scratch area. */
export function bytesOf(input: Input): Uint8Array {
  return typeof input === 'string' ? encoder.encode(input) : checkBytes(input);
}

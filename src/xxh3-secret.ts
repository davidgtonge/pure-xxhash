import { readWord } from './words.js';

/** An XXH3 secret, ready to hash with: made by `xxh3Secret`, or derived from a
 * seed. `words[offset]` is the little-endian 32-bit word at every byte offset,
 * so the hash reads any secret word, aligned or not, with one load. */
export interface Xxh3Secret {
  readonly size: number;
  readonly words: Int32Array;
}

/** The smallest secret XXH3 accepts (XXH3_SECRET_SIZE_MIN). */
export const SECRET_SIZE_MIN = 136;

/** XXH3_kSecret: 192 pseudorandom bytes, taken from FARSH. */
const DEFAULT_SECRET_BYTES = new Uint8Array([
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
  0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
  0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
  0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
  0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
  0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
  0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
  0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
  0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
  0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
  0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
  0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
]);

function wordsAtEveryOffset(bytes: Uint8Array): Int32Array {
  const words = new Int32Array(bytes.length - 3);
  for (let offset = 0; offset < words.length; offset++) words[offset] = readWord(bytes, offset);
  return words;
}

export const DEFAULT_SECRET: Xxh3Secret = { size: 192, words: wordsAtEveryOffset(DEFAULT_SECRET_BYTES) };

/** Prepare a custom secret for `xxh3` and `xxh128`. It must be at least 136
 * bytes, and should look random: see the xxHash documentation on secrets.
 * The bytes are copied, so changing them later doesn't change the secret. */
export function xxh3Secret(bytes: Uint8Array): Xxh3Secret {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('pure-xxhash: a secret must be a Uint8Array');
  if (bytes.length < SECRET_SIZE_MIN) throw new RangeError(`pure-xxhash: a secret must be at least ${SECRET_SIZE_MIN} bytes`);
  return { size: bytes.length, words: wordsAtEveryOffset(bytes) };
}

/** Whether a value is a secret made here, checked cheaply by shape. */
export function isSecret(value: unknown): value is Xxh3Secret {
  if (typeof value !== 'object' || value === null) return false;
  const { size, words } = value as Xxh3Secret;
  return typeof size === 'number' && size >= SECRET_SIZE_MIN && words instanceof Int32Array && words.length === size - 3;
}

// One derived secret is kept: the last seed's, so hashing many long inputs with
// one seed derives it once. It's an immutable value, like the default secret.
let cachedSeedHigh = 0;
let cachedSeedLow = 0;
let cachedSecret = DEFAULT_SECRET;

/** XXH3_initCustomSecret: the default secret with the seed added to each even
 * 64-bit word and subtracted from each odd one. Used for inputs over 240 bytes
 * with a nonzero seed. */
export function seededSecret(seedHigh: number, seedLow: number): Xxh3Secret {
  if (seedHigh === cachedSeedHigh && seedLow === cachedSeedLow) return cachedSecret;
  const defaultWords = DEFAULT_SECRET.words;
  const aligned = new Int32Array(48);
  for (let index = 0; index < 48; index += 4) {
    // Words at 16·k: + seed. Words at 16·k + 8: - seed.
    const addLow = defaultWords[index * 4];
    const addSum = (addLow + seedLow) | 0;
    aligned[index] = addSum;
    aligned[index + 1] = defaultWords[index * 4 + 4] + seedHigh + (((addLow & seedLow) | ((addLow | seedLow) & ~addSum)) >>> 31);
    const subtractLow = defaultWords[index * 4 + 8];
    const difference = (subtractLow - seedLow) | 0;
    aligned[index + 2] = difference;
    aligned[index + 3] = defaultWords[index * 4 + 12] - seedHigh - (((~subtractLow & seedLow) | (~(subtractLow ^ seedLow) & difference)) >>> 31);
  }
  const words = new Int32Array(189);
  for (let offset = 0; offset < 189; offset++) {
    const shift = (offset & 3) * 8;
    const index = offset >>> 2;
    words[offset] = shift === 0 ? aligned[index] : (aligned[index] >>> shift) | (aligned[index + 1] << (32 - shift));
  }
  cachedSecret = { size: 192, words };
  cachedSeedHigh = seedHigh;
  cachedSeedLow = seedLow;
  return cachedSecret;
}

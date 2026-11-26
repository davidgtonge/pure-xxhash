/** Where the hot loops read their words from.
 *
 * Every stripe loop reads little-endian 32-bit words through a DataView, which
 * in V8 is one load per word: about 3.3× faster than four byte loads and
 * shifts (bench/word-read.mjs). It also handles unaligned subarrays and
 * big-endian hosts, which an Int32Array view would not.
 *
 * Making the view is the expensive part. `new DataView` costs ~65 ns, and on a
 * Uint8Array of 64 bytes or less, whose bytes V8 keeps on the JS heap, the
 * first read of `.buffer` moves them off-heap for ~900 ns more. So inputs up to
 * `COPY_LIMIT` bytes are copied into a scratch area that has a view already
 * (`set` copies 256 bytes in ~16 ns), and only larger inputs get a view of
 * their own. */

/** Inputs up to this many bytes are copied into the scratch area. */
export const COPY_LIMIT = 1024;

/** Scratch for strings' UTF-8 (at most 3 bytes per UTF-16 unit, see input.ts)
 * and for small inputs' words. It is written and read within one synchronous
 * call only: never returned, and never held by a streaming state, which copies
 * the bytes it keeps. */
export const scratch = new Uint8Array(12288);
const scratchView = new DataView(scratch.buffer);

/** A view whose offsets match `bytes`, covering bytes[0, length). */
export function wordsOf(bytes: Uint8Array, length: number): DataView {
  if (bytes === scratch) return scratchView;
  if (length <= COPY_LIMIT) {
    scratch.set(bytes);
    return scratchView;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, length);
}

/** One word by byte loads, for tails and short inputs that need no view. */
export function readWord(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

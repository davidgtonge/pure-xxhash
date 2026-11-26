// Reads xxHash's official tests/sanity_test_vectors.h (see test/vectors/README.md)
// into plain arrays. Shared by test/official.test.mjs and tools/generate-vectors.mjs.
import { readFileSync } from 'node:fs';

/** The sanity buffer: byteGen = PRIME32; each byte is byteGen >> 56; byteGen *= PRIME64. */
export function sanityBuffer(length) {
  const bytes = new Uint8Array(length);
  let generator = 2654435761n;
  for (let index = 0; index < length; index++) {
    bytes[index] = Number(generator >> 56n);
    generator = (generator * 11400714785074694797n) & 0xffffffffffffffffn;
  }
  return bytes;
}

/** Each table as [{ length, seed, result }], results as lowercase hex
 * (XXH128 results as high then low, 32 digits). */
export function readOfficialVectors(path) {
  const text = readFileSync(path, 'utf8');
  const tables = {};
  const tablePattern = /static const XSUM_testdata(32|64|128)_t XSUM_(\w+)_testdata\[\] = \{([\s\S]*?)\n\};/g;
  for (const [, , name, body] of text.matchAll(tablePattern)) {
    const rows = [];
    for (const line of body.split('\n')) {
      const numbers = [...line.replace(/\/\*.*\*\//, '').matchAll(/0x([0-9A-Fa-f]+)U?L*L?|\b(\d+)\b/g)].map(match => match[1] ?? match[2]);
      if (numbers.length < 3) continue;
      const [length, seed, ...result] = numbers;
      rows.push({
        length: Number(length),
        seed: BigInt(`0x${seed}`),
        result: result.length === 2 ? `${result[1]}${result[0]}`.toLowerCase().padStart(32, '0') : result[0].toLowerCase(),
      });
    }
    tables[name] = rows;
  }
  return tables;
}

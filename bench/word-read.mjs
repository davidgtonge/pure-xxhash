// Compares ways of reading little-endian 32-bit words in the XXH32 stripe
// loop, the design question behind src/bytes.ts. Each variant runs in its own
// process (see the bottom of the file), because variants sharing a process
// skew each other's V8 type feedback.
//
//   node bench/word-read.mjs
//
// Variants:
//   bytes     four byte loads and shifts, from the Uint8Array itself
//   int32view an Int32Array over the same memory (aligned inputs only)
//   dataview  one DataView per call, getInt32(offset, true)
//   copy      copy each 4 KiB chunk into an aligned scratch Int32Array, then read words
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const PRIME32_1 = 0x9e3779b1 | 0;
const PRIME32_2 = 0x85ebca77 | 0;

function rotateLeft(value, count) {
  return (value << count) | (value >>> (32 - count));
}

function stripesFromBytes(bytes, offset, end, accumulator) {
  let first = accumulator;
  let second = accumulator + 1;
  let third = accumulator + 2;
  let fourth = accumulator + 3;
  for (let position = offset; position <= end - 16; position += 16) {
    const word1 = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16) | (bytes[position + 3] << 24);
    const word2 = bytes[position + 4] | (bytes[position + 5] << 8) | (bytes[position + 6] << 16) | (bytes[position + 7] << 24);
    const word3 = bytes[position + 8] | (bytes[position + 9] << 8) | (bytes[position + 10] << 16) | (bytes[position + 11] << 24);
    const word4 = bytes[position + 12] | (bytes[position + 13] << 8) | (bytes[position + 14] << 16) | (bytes[position + 15] << 24);
    first = Math.imul(rotateLeft((first + Math.imul(word1, PRIME32_2)) | 0, 13), PRIME32_1);
    second = Math.imul(rotateLeft((second + Math.imul(word2, PRIME32_2)) | 0, 13), PRIME32_1);
    third = Math.imul(rotateLeft((third + Math.imul(word3, PRIME32_2)) | 0, 13), PRIME32_1);
    fourth = Math.imul(rotateLeft((fourth + Math.imul(word4, PRIME32_2)) | 0, 13), PRIME32_1);
  }
  return (first ^ second ^ third ^ fourth) >>> 0;
}

function stripesFromWords(words, wordOffset, wordEnd, accumulator) {
  let first = accumulator;
  let second = accumulator + 1;
  let third = accumulator + 2;
  let fourth = accumulator + 3;
  for (let index = wordOffset; index <= wordEnd - 4; index += 4) {
    first = Math.imul(rotateLeft((first + Math.imul(words[index], PRIME32_2)) | 0, 13), PRIME32_1);
    second = Math.imul(rotateLeft((second + Math.imul(words[index + 1], PRIME32_2)) | 0, 13), PRIME32_1);
    third = Math.imul(rotateLeft((third + Math.imul(words[index + 2], PRIME32_2)) | 0, 13), PRIME32_1);
    fourth = Math.imul(rotateLeft((fourth + Math.imul(words[index + 3], PRIME32_2)) | 0, 13), PRIME32_1);
  }
  return (first ^ second ^ third ^ fourth) >>> 0;
}

function stripesFromDataView(view, offset, end, accumulator) {
  let first = accumulator;
  let second = accumulator + 1;
  let third = accumulator + 2;
  let fourth = accumulator + 3;
  for (let position = offset; position <= end - 16; position += 16) {
    first = Math.imul(rotateLeft((first + Math.imul(view.getInt32(position, true), PRIME32_2)) | 0, 13), PRIME32_1);
    second = Math.imul(rotateLeft((second + Math.imul(view.getInt32(position + 4, true), PRIME32_2)) | 0, 13), PRIME32_1);
    third = Math.imul(rotateLeft((third + Math.imul(view.getInt32(position + 8, true), PRIME32_2)) | 0, 13), PRIME32_1);
    fourth = Math.imul(rotateLeft((fourth + Math.imul(view.getInt32(position + 12, true), PRIME32_2)) | 0, 13), PRIME32_1);
  }
  return (first ^ second ^ third ^ fourth) >>> 0;
}

const scratchWords = new Int32Array(1024);
const scratchBytes = new Uint8Array(scratchWords.buffer);

const variants = {
  bytes: bytes => stripesFromBytes(bytes, 0, bytes.length, 7),
  int32view: bytes => stripesFromWords(new Int32Array(bytes.buffer, bytes.byteOffset, bytes.length >>> 2), 0, bytes.length >>> 2, 7),
  dataview: bytes => stripesFromDataView(new DataView(bytes.buffer, bytes.byteOffset, bytes.length), 0, bytes.length, 7),
  copy: bytes => {
    let result = 7;
    for (let start = 0; start < bytes.length; start += 4096) {
      const chunkEnd = Math.min(start + 4096, bytes.length);
      scratchBytes.set(bytes.subarray(start, chunkEnd));
      result = stripesFromWords(scratchWords, 0, (chunkEnd - start) >>> 2, result);
    }
    return result;
  },
};

const sizes = [16, 64, 256, 4096, 65536, 1 << 20];

function measure(run, durationMs) {
  let sink = 0;
  const timeRun = () => {
    let calls = 0;
    const start = performance.now();
    let now = start;
    do {
      for (let index = 0; index < 64; index++) sink = (sink + run(index)) | 0;
      calls += 64;
      now = performance.now();
    } while (now - start < durationMs);
    return (now - start) * 1e6 / calls;
  };
  timeRun();
  const results = [timeRun(), timeRun(), timeRun(), timeRun(), timeRun()].sort((left, right) => left - right);
  if (sink === 0.5) console.log(sink);
  return results[2];
}

if (process.env.WORD_READ_VARIANT) {
  const variant = variants[process.env.WORD_READ_VARIANT];
  const fresh = process.env.WORD_READ_FRESH === '1';
  const rows = {};
  for (const size of sizes) {
    const source = new Uint8Array(size);
    for (let index = 0; index < size; index++) source[index] = (index * 31 + 7) & 255;
    const nanoseconds = fresh && size <= 4096
      ? measure(() => variant(source.slice()), 60)
      : measure(() => variant(source), 60);
    rows[size] = nanoseconds;
  }
  console.log(JSON.stringify(rows));
} else {
  const scriptPath = fileURLToPath(import.meta.url);
  const format = nanoseconds => nanoseconds >= 10000 ? `${(nanoseconds / 1000).toFixed(1)} µs` : `${nanoseconds.toFixed(0)} ns`;
  for (const fresh of [false, true]) {
    console.log(`\n${fresh ? 'Fresh buffer each call (up to 4 KiB)' : 'Reused buffer'}: ns per call, median of 5 rounds\n`);
    console.log(`| Variant | ${sizes.map(size => `${size} B`).join(' | ')} |`);
    console.log(`| --- |${' ---: |'.repeat(sizes.length)}`);
    for (const name of Object.keys(variants)) {
      const output = execFileSync(process.execPath, [scriptPath], { env: { ...process.env, WORD_READ_VARIANT: name, WORD_READ_FRESH: fresh ? '1' : '0' }, encoding: 'utf8' });
      const rows = JSON.parse(output);
      console.log(`| ${name} | ${sizes.map(size => format(rows[size])).join(' | ')} |`);
    }
  }
}

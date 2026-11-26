// The checksums of the LZ4 frame format (lz4_Frame_format.md), checked against
// frames written by the lz4 command line tool (test/vectors/lz4/README in
// test/vectors/README.md):
//   header checksum   (xxh32(frame descriptor, 0) >>> 8) & 0xff
//   block checksum    xxh32(block data as stored, 0)
//   content checksum  xxh32(original content, 0), streamed block by block
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { xxh32, xxh32Create, xxh32Update, xxh32Digest } from '../dist/index.js';
import { lz4Content } from './lz4-content.mjs';

const readUint32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

/** Split a frame into its parts, checking each checksum as it goes. */
function checkFrame(frame, content) {
  assert.equal(readUint32(frame, 0), 0x184d2204, 'magic number');
  const flags = frame[4];
  const hasBlockChecksums = (flags & 0x10) !== 0;
  const hasContentSize = (flags & 0x08) !== 0;
  const hasContentChecksum = (flags & 0x04) !== 0;
  const hasDictionaryId = (flags & 0x01) !== 0;
  const descriptorEnd = 6 + (hasContentSize ? 8 : 0) + (hasDictionaryId ? 4 : 0);
  // The header checksum covers the descriptor: FLG through the optional fields.
  const descriptor = frame.subarray(4, descriptorEnd);
  assert.equal((xxh32(descriptor, 0) >>> 8) & 0xff, frame[descriptorEnd], 'header checksum');
  let position = descriptorEnd + 1;
  let blocks = 0;
  for (;;) {
    const blockSize = readUint32(frame, position) & 0x7fffffff;
    position += 4;
    if (blockSize === 0) break;
    const blockData = frame.subarray(position, position + blockSize);
    position += blockSize;
    if (hasBlockChecksums) {
      assert.equal(xxh32(blockData, 0), readUint32(frame, position), `block ${blocks} checksum`);
      position += 4;
    }
    blocks++;
  }
  if (hasContentChecksum) {
    const stored = readUint32(frame, position);
    assert.equal(xxh32(content, 0), stored, 'content checksum, one-shot');
    // A decoder sees the content block by block (64 KiB blocks here).
    let state = xxh32Create(0);
    for (let offset = 0; offset < content.length; offset += 65536) state = xxh32Update(state, content.subarray(offset, offset + 65536));
    assert.equal(xxh32Digest(state), stored, 'content checksum, streamed');
    position += 4;
  }
  assert.equal(position, frame.length, 'nothing after the frame');
  return { blocks, hasBlockChecksums, hasContentChecksum };
}

test('LZ4 frame with block checksums, content size and content checksum', () => {
  const frame = new Uint8Array(readFileSync(new URL('./vectors/lz4/content-150000-block-checksums.lz4', import.meta.url)));
  const parts = checkFrame(frame, lz4Content(150000));
  assert.equal(parts.blocks, 3);
  assert.ok(parts.hasBlockChecksums && parts.hasContentChecksum);
});

test('LZ4 frame with one uncompressed block and a content checksum', () => {
  const frame = new Uint8Array(readFileSync(new URL('./vectors/lz4/content-11.lz4', import.meta.url)));
  const parts = checkFrame(frame, lz4Content(11));
  assert.equal(parts.blocks, 1);
});

test('LZ4 header checksum byte for descriptors written by the lz4 tool', () => {
  // Frame headers from lz4 v1.10.0 (magic, FLG, BD, HC):
  //   default                  04 22 4d 18 64 40 a7
  //   --no-frame-crc           04 22 4d 18 60 40 82
  //   -BX (block checksums)    04 22 4d 18 74 40 bd
  const headerChecksum = descriptor => (xxh32(new Uint8Array(descriptor), 0) >>> 8) & 0xff;
  assert.equal(headerChecksum([0x64, 0x40]), 0xa7);
  assert.equal(headerChecksum([0x60, 0x40]), 0x82);
  assert.equal(headerChecksum([0x74, 0x40]), 0xbd);
});

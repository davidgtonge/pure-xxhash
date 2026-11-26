// The content of the LZ4 frames in test/vectors/lz4: deterministic, partly
// compressible text, so the frames have compressed and multiple blocks.
export function lz4Content(length) {
  const words = ['frame', 'block', 'checksum', 'xxh32', 'stream', 'lz4', 'header', 'content', 'magic', 'size'];
  let text = '';
  for (let line = 0; text.length < length; line++) {
    text += `${line}: ${words[line % 10]} ${words[(line * 7) % 10]} ${(line * 2654435761) % 1000003}\n`;
  }
  return new TextEncoder().encode(text.slice(0, length));
}

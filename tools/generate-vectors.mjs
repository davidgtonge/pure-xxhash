// Generates test/vectors/xxhash-vectors.json from reference implementations,
// and refuses to write it unless they all agree. See test/vectors/README.md.
//
//   node tools/generate-vectors.mjs
//
// Environment (defaults are the paths on the machine that produced the file):
//   XXHASH_INCLUDE   directory holding xxHash 0.8.x's xxhash.h   (/opt/homebrew/include)
//   LZ4_XXHASH_DIR   directory holding lz4's bundled xxhash.c/.h (../lz4-reference/lib)
//   XXHSUM           the xxhsum command                           (xxhsum)
//   SKIP_TWOX=1      skip the twox-hash (Rust) cross-check
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanityBuffer } from '../test/official.mjs';

const toolsDirectory = fileURLToPath(new URL('.', import.meta.url));
const outputPath = fileURLToPath(new URL('../test/vectors/xxhash-vectors.json', import.meta.url));
const xxhashInclude = process.env.XXHASH_INCLUDE ?? '/opt/homebrew/include';
const lz4Directory = process.env.LZ4_XXHASH_DIR ?? fileURLToPath(new URL('../../../lz4-reference/lib', import.meta.url));
const xxhsum = process.env.XXHSUM ?? 'xxhsum';
const workDirectory = mkdtempSync(join(tmpdir(), 'pure-xxhash-vectors-'));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });

function linesOf(output) {
  return output.trim().split('\n');
}

try {
  // 1. xxHash 0.8.x, every algorithm.
  const mainBinary = join(workDirectory, 'vectors');
  run('cc', ['-O2', `-I${xxhashInclude}`, join(toolsDirectory, 'vectors.c'), '-o', mainBinary]);
  const version = run('sh', ['-c', `grep -E '#define XXH_VERSION_(MAJOR|MINOR|RELEASE) ' ${xxhashInclude}/xxhash.h | awk '{print $3}' | paste -sd. -`]).trim();
  const reference = linesOf(run(mainBinary, []));
  const sources = [`xxHash ${version} (C, ${xxhashInclude}/xxhash.h)`];

  // 2. lz4's bundled xxhash.c: XXH32 and XXH64 must match line for line.
  const lz4Binary = join(workDirectory, 'vectors-lz4');
  run('cc', ['-O2', '-DONLY_XXH32_XXH64', `-I${lz4Directory}`, join(toolsDirectory, 'vectors.c'), join(lz4Directory, 'xxhash.c'), '-o', lz4Binary]);
  const lz4Version = run('sh', ['-c', `grep -E '#define XXH_VERSION_(MAJOR|MINOR|RELEASE) ' ${lz4Directory}/xxhash.h | awk '{print $3}' | paste -sd. -`]).trim();
  const lz4Lines = linesOf(run(lz4Binary, []));
  const referenceOld = reference.filter(line => line.startsWith('xxh32 ') || line.startsWith('xxh64 '));
  if (lz4Lines.join('\n') !== referenceOld.join('\n')) throw new Error('lz4 xxhash.c disagrees with xxHash');
  sources.push(`xxHash ${lz4Version} as bundled with lz4 (C, XXH32 and XXH64: ${lz4Lines.length} results agree)`);

  // 3. twox-hash, the Rust crate: every line must match.
  if (!process.env.SKIP_TWOX) {
    const rustDirectory = join(toolsDirectory, 'twox-check');
    const rustLines = linesOf(run('cargo', ['run', '--quiet', '--release', '--offline'], { cwd: rustDirectory }));
    if (rustLines.join('\n') !== reference.join('\n')) throw new Error('twox-hash disagrees with xxHash');
    const crateVersion = run('cargo', ['pkgid', '-p', 'twox-hash'], { cwd: rustDirectory }).trim().split(/[@#]/).pop();
    sources.push(`twox-hash ${crateVersion} (Rust: all ${rustLines.length} results agree)`);
  }

  // 4. The xxhsum command, which has no seed option: seed 0 for every length.
  const lengths = [...new Set(reference.map(line => Number(line.split(' ')[1])))];
  const buffer = sanityBuffer(1048577 + 64);
  const inputDirectory = join(workDirectory, 'inputs');
  mkdirSync(inputDirectory);
  const files = lengths.map(length => {
    const path = join(inputDirectory, `length-${length}`);
    writeFileSync(path, buffer.subarray(0, length));
    return path;
  });
  let xxhsumChecks = 0;
  for (const [algorithm, flag] of [['xxh32', '-H0'], ['xxh64', '-H1'], ['xxh128', '-H2'], ['xxh3', '-H3']]) {
    const sums = new Map(linesOf(run(xxhsum, [flag, ...files])).map(line => {
      const [hash, path] = line.split(/\s+/);
      return [Number(path.split('length-')[1]), hash.replace(/^XXH3_/, '')];
    }));
    for (const line of reference) {
      const [name, length, seed, hash] = line.split(' ');
      if (name !== algorithm || seed !== '0') continue;
      if (sums.get(Number(length)) !== hash) throw new Error(`xxhsum ${flag} disagrees at length ${length}`);
      xxhsumChecks++;
    }
  }
  const xxhsumVersion = run('sh', ['-c', `${xxhsum} -V 2>&1`]).split('\n')[0].trim();
  sources.push(`${xxhsumVersion} (command line, seed 0: ${xxhsumChecks} results agree)`);

  // Group by algorithm and key: results[algorithm][key] is one hash per length.
  const results = {};
  for (const line of reference) {
    const [name, , key, hash] = line.split(' ');
    ((results[name] ??= {})[key] ??= []).push(hash);
  }
  const vectors = {
    description: 'xxHash results for prefixes of xxHash\'s sanity-test buffer, at every length in `lengths`. Keys are hex seeds, or secretSIZE@OFFSET for a custom secret taken from buffer[OFFSET, OFFSET + SIZE). Hashes are canonical big-endian hex, as xxhsum prints them.',
    buffer: 'byteGen = 2654435761; for each byte: byte = byteGen >> 56; byteGen = byteGen * 11400714785074694797 mod 2^64',
    generated: new Date().toISOString().slice(0, 10),
    sources,
    lengths,
    results,
  };
  writeFileSync(outputPath, `${JSON.stringify(vectors, null, 0)}\n`);
  const count = Object.values(results).reduce((total, byKey) => total + Object.values(byKey).reduce((sum, list) => sum + list.length, 0), 0);
  console.log(`Wrote ${count} results to ${outputPath}`);
  for (const source of sources) console.log(`  ${source}`);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}

# Test vectors

## `xxhash-vectors.json`: generated, committed

9,280 results: XXH32, XXH64, XXH3-64 and XXH3-128 at 320 input lengths, with several seeds and custom secrets. `test/vectors.test.mjs` checks every one, in every result form, and again on unaligned subarrays.

- **Inputs.** Prefixes of xxHash's own sanity-test buffer (`fillTestBuffer` in xxHash's `cli/xsum_sanity_check.c`): `byteGen = 2654435761`; each byte is `byteGen >> 56`, then `byteGen *= 11400714785074694797` (mod 2^64). The tests rebuild it, so only the hashes are stored.
- **Lengths.** Every length from 0 to 300, which crosses each XXH3 size class (0, 1–3, 4–8, 9–16, 17–128, 129–240, over 240) and every XXH32 and XXH64 stripe boundary, then 384, 512, 777, 1000, 1023, 1024, 1025, 2047, 2048, 4095, 4096, 4097, 10000, 65535, 65536, 65537, 100003, 1 MiB and 1 MiB + 1.
- **Seeds.** XXH32: 0, 1, 12345, 0x9E3779B1 (top bit set) and 0xFFFFFFFF. The 64-bit hashes: 0, 1, 12345, 2^32 (high half only), 0x9E3779B185EBCA8D (top bit set) and 2^64 - 1.
- **Custom secrets** (XXH3-64 and XXH3-128), taken from the same buffer: 136 bytes from offset 7 (the minimum size), 200 bytes from offset 3, and 1,024 bytes from offset 11 (120 stripes per block, more than the default 16).
- **Format.** `results[algorithm][key]` is one hash per entry of `lengths`. A key is a hex seed, or `secretSIZE@OFFSET`. Hashes are canonical big-endian hex, as `xxhsum` prints them.

### How it was produced

`node tools/generate-vectors.mjs` (on 26 November 2026, macOS arm64) builds `tools/vectors.c` and runs it, then refuses to write the file unless four independent implementations agree:

| Source | What it checked |
| --- | --- |
| xxHash 0.8.4, the C library (`/opt/homebrew/include/xxhash.h`, Homebrew) | All 9,280 results: these are the ones written |
| xxHash 0.6.5 as bundled with lz4 (`lib/xxhash.c` in an lz4 checkout) | All 3,520 XXH32 and XXH64 results, line for line |
| twox-hash 2.1.2, the Rust crate (`tools/twox-check`) | All 9,280 results, line for line |
| `xxhsum` 0.8.4, the command line tool | All 1,280 seed-0 results (it has no seed option) |

Paths are set by environment variables; see the top of `tools/generate-vectors.mjs`.

## `official/sanity_test_vectors.h`: xxHash's own vectors, not committed

xxHash's test suite ships 45,771 vectors in [`tests/sanity_test_vectors.h`](https://github.com/Cyan4973/xxHash/blob/dev/tests/sanity_test_vectors.h): XXH32, XXH64 and XXH3-64 at every length from 0 to 4,160 with two seeds, XXH3-128 with three, and XXH3-64 and XXH3-128 with a 147-byte custom secret. All of them pass.

The file isn't committed: it's 4.6 MB, and the xxHash repository licenses its library (BSD 2-Clause) and its command line tool (GPL v2) but states no licence for the tests directory. `npm run vectors:official` downloads it into this folder (git-ignored), and `test/official.test.mjs` checks it when it's present and skips otherwise.

## `lz4/`: LZ4 frames

Written with the `lz4` command line tool, v1.10.0, from the deterministic text in `test/lz4-content.mjs`:

- `content-150000-block-checksums.lz4`: `lz4 -B4 -BX --content-size`: three 64 KiB blocks, each with a block checksum, plus the content size and the content checksum.
- `content-11.lz4`: `lz4 -B4`: one stored (uncompressed) block and a content checksum.

`test/lz4.test.mjs` recomputes the header checksum, every block checksum and the content checksum (one-shot and streamed) and compares them with the bytes lz4 wrote.

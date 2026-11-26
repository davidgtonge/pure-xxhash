# Changelog

## 0.1.0 (2026-11-26)

First version.

- XXH32, XXH64, XXH3-64 and XXH3-128, one-shot and streaming, with seeds; XXH3 with custom secrets.
- 64-bit results as bigints or as `{ high, low }` uint32 pairs.
- Streaming states are immutable values.
- Checked against 9,280 generated vectors (xxHash 0.8.4 and 0.6.5 in C, twox-hash in Rust and `xxhsum` agree on them), xxHash's 45,771 sanity-test vectors, and LZ4 frames written by `lz4`.

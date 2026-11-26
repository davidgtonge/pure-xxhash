/* Prints xxHash results for the test vectors, one per line:
 *   <algorithm> <length> <seed or secret> <hash>
 * with hex seeds and canonical (big-endian) hex hashes. Built and run by
 * generate-vectors.mjs against two C implementations:
 *   - xxHash 0.8.x's single-header library (XXH_INLINE_ALL), all algorithms;
 *   - the older xxhash.c bundled with lz4 (ONLY_XXH32_XXH64), XXH32 and XXH64.
 * Inputs are prefixes of xxHash's own sanity-test buffer (fillTestBuffer). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef ONLY_XXH32_XXH64
#  define XXH_INLINE_ALL
#endif
#include "xxhash.h"

#define BUFFER_SIZE (1048577 + 64)

static const size_t extraLengths[] = { 384, 512, 777, 1000, 1023, 1024, 1025, 2047, 2048, 4095, 4096, 4097,
  10000, 65535, 65536, 65537, 100003, 1048576, 1048577 };
static const unsigned seeds32[] = { 0, 1, 12345, 0x9E3779B1u, 0xFFFFFFFFu };
static const unsigned long long seeds64[] = { 0, 1, 12345, 0x100000000ULL, 0x9E3779B185EBCA8DULL, 0xFFFFFFFFFFFFFFFFULL };
/* Custom secrets: buffer[offset, offset + size). */
static const size_t secretOffsets[] = { 7, 3, 11 };
static const size_t secretSizes[] = { 136, 200, 1024 };

int main(void) {
  unsigned char* buffer = malloc(BUFFER_SIZE);
  unsigned long long generator = 2654435761U;
  size_t index, lengthCount = 301 + sizeof(extraLengths) / sizeof(extraLengths[0]);
  for (index = 0; index < BUFFER_SIZE; index++) {
    buffer[index] = (unsigned char)(generator >> 56);
    generator *= 11400714785074694797ULL;
  }
  for (index = 0; index < lengthCount; index++) {
    size_t length = index <= 300 ? index : extraLengths[index - 301];
    size_t seedIndex;
    for (seedIndex = 0; seedIndex < sizeof(seeds32) / sizeof(seeds32[0]); seedIndex++) {
      printf("xxh32 %zu %x %08x\n", length, seeds32[seedIndex], XXH32(buffer, length, seeds32[seedIndex]));
    }
    for (seedIndex = 0; seedIndex < sizeof(seeds64) / sizeof(seeds64[0]); seedIndex++) {
      printf("xxh64 %zu %llx %016llx\n", length, seeds64[seedIndex], (unsigned long long)XXH64(buffer, length, seeds64[seedIndex]));
    }
#ifndef ONLY_XXH32_XXH64
    for (seedIndex = 0; seedIndex < sizeof(seeds64) / sizeof(seeds64[0]); seedIndex++) {
      XXH128_hash_t wide = XXH3_128bits_withSeed(buffer, length, seeds64[seedIndex]);
      printf("xxh3 %zu %llx %016llx\n", length, seeds64[seedIndex], (unsigned long long)XXH3_64bits_withSeed(buffer, length, seeds64[seedIndex]));
      printf("xxh128 %zu %llx %016llx%016llx\n", length, seeds64[seedIndex], (unsigned long long)wide.high64, (unsigned long long)wide.low64);
    }
    for (seedIndex = 0; seedIndex < sizeof(secretSizes) / sizeof(secretSizes[0]); seedIndex++) {
      const unsigned char* secret = buffer + secretOffsets[seedIndex];
      XXH128_hash_t wide = XXH3_128bits_withSecret(buffer, length, secret, secretSizes[seedIndex]);
      printf("xxh3 %zu secret%zu@%zu %016llx\n", length, secretSizes[seedIndex], secretOffsets[seedIndex],
        (unsigned long long)XXH3_64bits_withSecret(buffer, length, secret, secretSizes[seedIndex]));
      printf("xxh128 %zu secret%zu@%zu %016llx%016llx\n", length, secretSizes[seedIndex], secretOffsets[seedIndex],
        (unsigned long long)wide.high64, (unsigned long long)wide.low64);
    }
#endif
  }
  free(buffer);
  return 0;
}

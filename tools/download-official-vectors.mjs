// Downloads xxHash's tests/sanity_test_vectors.h (about 4.6 MB) for
// test/official.test.mjs. It isn't committed: it's large, and the xxHash
// repository doesn't state a licence for its tests directory.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Pinned to one commit of xxHash's dev branch, so every run checks the same file.
const source = 'https://raw.githubusercontent.com/Cyan4973/xxHash/2ec67caeb18ec15ae60c0853174331089acddfc0/tests/sanity_test_vectors.h';
const directory = fileURLToPath(new URL('../test/vectors/official/', import.meta.url));
const response = await fetch(source);
if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}sanity_test_vectors.h`, new Uint8Array(await response.arrayBuffer()));
console.log(`Saved ${source} to ${directory}`);

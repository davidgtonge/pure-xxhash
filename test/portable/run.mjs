// Entry point for other runtimes:  deno run --allow-read test/portable/run.mjs
import { runSuite } from './suite.mjs';

const failures = runSuite();
if (failures.length) throw new Error(failures.join('\n'));
console.log('pure-xxhash portable suite: ok');

// The portable suite inside a module web worker; posts its summary back.
import { runSummary } from './summary.mjs';

self.postMessage(await runSummary());

// The portable suite's failures as the summary the runners print:
// { passed, failed, results }. One check covers the whole suite.
import { runSuite } from './suite.mjs';

export async function runSummary() {
  const start = performance.now();
  let failures;
  try {
    failures = runSuite();
  } catch (error) {
    failures = [`threw: ${error?.stack ?? String(error)}`];
  }
  const milliseconds = Math.round(performance.now() - start);
  const ok = failures.length === 0;
  return {
    passed: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    results: [{ name: 'pure-xxhash portable suite', ok, milliseconds, ...(ok ? {} : { error: failures.join('\n') }) }],
  };
}

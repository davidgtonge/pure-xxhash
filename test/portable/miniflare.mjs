// Runs the portable suite in workerd, Cloudflare's Workers runtime, through
// Miniflare. Miniflare is not a dependency of the package; CI installs it for
// this job only:
//   npm install --no-save miniflare && node test/portable/miniflare.mjs
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

const miniflare = new Miniflare({
  modules: true,
  modulesRoot: fileURLToPath(new URL('../../', import.meta.url)),
  scriptPath: fileURLToPath(new URL('./workerd.mjs', import.meta.url)),
  modulesRules: [{ type: 'ESModule', include: ['**/*.mjs', '**/*.js'] }],
  compatibilityDate: '2026-01-01',
});

try {
  const response = await miniflare.dispatchFetch('http://localhost/');
  const summary = await response.json();
  for (const result of summary.results.filter((item) => !item.ok)) {
    console.log(`not ok  ${result.name}\n${result.error.replace(/^/gm, '    ')}`);
  }
  console.log(`workerd: ${summary.passed} passed, ${summary.failed} failed`);
  process.exitCode = summary.failed > 0 ? 1 : 0;
} finally {
  await miniflare.dispose();
}

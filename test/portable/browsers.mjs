// Runs the portable suite in Chromium, Firefox and WebKit, on the page and in a
// web worker, through Playwright. Playwright is not a dependency of the
// package; CI installs it for this job only:
//   npm install --no-save playwright && npx playwright install --with-deps
//   node test/portable/browsers.mjs [chromium firefox webkit]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

// A static server over the repository: the page imports dist/ and test/.
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/test/portable/browser.html`;

const browserNames = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
let failures = 0;
try {
  for (const name of browserNames) {
    const browser = await playwright[name].launch();
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.goto(url);
      await page.waitForFunction(() => window.portableResults, null, { timeout: 120_000 });
      const results = await page.evaluate(() => window.portableResults);
      const version = browser.version();
      for (const [where, summary] of Object.entries(results)) {
        for (const result of summary.results.filter((item) => !item.ok)) {
          console.log(`not ok  ${name} ${where}: ${result.name}\n${result.error.replace(/^/gm, '    ')}`);
        }
        console.log(`${name} ${version} (${where}): ${summary.passed} passed, ${summary.failed} failed`);
        failures += summary.failed;
      }
      for (const error of pageErrors) {
        console.log(`not ok  ${name}: page error ${error}`);
        failures++;
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
process.exitCode = failures > 0 ? 1 : 0;

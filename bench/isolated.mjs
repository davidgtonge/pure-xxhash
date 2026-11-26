// Runs every bench.mjs workload in its own Node process and prints markdown
// tables. Workloads sharing one process skew each other's V8 type feedback.
//   BENCH_MS=100 BENCH_ROUNDS=5 npm run bench
// ISOLATED_FILTER (a regular expression over "algorithm mode size") picks workloads.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

const benchPath = fileURLToPath(new URL('./bench.mjs', import.meta.url));
const resultsPath = fileURLToPath(new URL('./last-results.json', import.meta.url));
const run = env => JSON.parse(execFileSync(process.execPath, [benchPath], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n')[0]);
const only = process.env.ISOLATED_FILTER ? new RegExp(process.env.ISOLATED_FILTER) : undefined;

const algorithms = ['xxh32', 'xxh64', 'xxh3', 'xxh128'];
const workloads = [];
for (const algorithm of algorithms) {
  for (const size of [16, 64, 256, 4096, 65536, 1048576]) workloads.push({ algorithm, mode: 'reused', size });
  for (const size of [16, 64, 256]) workloads.push({ algorithm, mode: 'fresh', size });
  for (const chunk of [64, 4096, 65536]) workloads.push({ algorithm, mode: 'stream', size: 1048576, chunk });
}

const startLoad = loadavg();
const results = [];
for (const workload of workloads) {
  const label = `${workload.algorithm} ${workload.mode} ${workload.size}${workload.chunk ? ` ${workload.chunk}` : ''}`;
  if (only && !only.test(label)) continue;
  process.stderr.write(`${label}\n`);
  results.push(run({ BENCH_ALGORITHM: workload.algorithm, BENCH_MODE: workload.mode, BENCH_SIZE: String(workload.size), BENCH_CHUNK: String(workload.chunk ?? 0) }));
}
const endLoad = loadavg();
const libraries = results[0]?.libraries ?? [];
writeFileSync(resultsPath, `${JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, cpu: cpus()[0]?.model, date: new Date().toISOString(), loadAverage: { start: startLoad, end: endLoad }, results }, null, 1)}\n`);

const sizeName = size => size >= 1048576 ? `${size / 1048576} MiB` : size >= 1024 ? `${size / 1024} KiB` : `${size} B`;
const throughput = (size, ns) => ns === undefined ? '–' : size / ns >= 0.1 ? (size / ns).toFixed(2) : (size / ns).toPrecision(2);
const time = ns => ns === undefined ? '–' : ns >= 10000 ? `${(ns / 1000).toFixed(1)} µs` : `${ns.toFixed(0)} ns`;

console.log(`Node ${process.version}, ${process.platform}/${process.arch}, ${cpus()[0]?.model}. Load average ${startLoad.map(value => value.toFixed(2)).join(' ')} at the start, ${endLoad.map(value => value.toFixed(2)).join(' ')} at the end.`);
console.log(`Each workload in its own process; median of ${process.env.BENCH_ROUNDS || 5} rounds of ${process.env.BENCH_MS || 100} ms.`);
console.log(`Libraries: ${libraries.map(library => `${library.name} ${library.version} (${library.kind})`).join(', ')}.`);
for (const algorithm of algorithms) {
  const reused = results.filter(result => result.algorithm === algorithm && result.mode === 'reused');
  if (reused.length) {
    const names = [...new Set(reused.flatMap(result => result.rows.map(row => row.library)))];
    console.log(`\n### ${algorithm}: throughput, GB/s (same input every call; higher is better)\n`);
    console.log(`| Size | ${names.join(' | ')} |`);
    console.log(`| --- |${' ---: |'.repeat(names.length)}`);
    for (const result of reused) {
      const ns = name => result.rows.find(row => row.library === name)?.ns;
      console.log(`| ${sizeName(result.size)} | ${names.map(name => throughput(result.size, ns(name))).join(' | ')} |`);
    }
  }
  const fresh = results.filter(result => result.algorithm === algorithm && result.mode === 'fresh');
  if (fresh.length) {
    const freshNames = [...new Set(fresh.flatMap(result => result.rows.map(row => row.library)))];
    console.log(`\n### ${algorithm}: latency from a fresh buffer (a new copy every call; lower is better)\n`);
    console.log(`| Size | ${freshNames.join(' | ')} |`);
    console.log(`| --- |${' ---: |'.repeat(freshNames.length)}`);
    for (const result of fresh) {
      const ns = name => result.rows.find(row => row.library === name)?.ns;
      console.log(`| ${sizeName(result.size)} | ${freshNames.map(name => time(ns(name))).join(' | ')} |`);
    }
  }
  const stream = results.filter(result => result.algorithm === algorithm && result.mode === 'stream');
  if (stream.length) {
    const streamNames = [...new Set(stream.flatMap(result => result.rows.map(row => row.library)))];
    console.log(`\n### ${algorithm}: streaming 1 MiB, time per MiB (lower is better)\n`);
    console.log(`| Chunk | ${streamNames.join(' | ')} |`);
    console.log(`| --- |${' ---: |'.repeat(streamNames.length)}`);
    for (const result of stream) {
      const ns = name => result.rows.find(row => row.library === name)?.ns;
      console.log(`| ${sizeName(result.chunk)} | ${streamNames.map(name => time(ns(name))).join(' | ')} |`);
    }
  }
}

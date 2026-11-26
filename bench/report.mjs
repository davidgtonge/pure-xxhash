// Prints markdown tables from one or more bench/isolated.mjs result files,
// taking the median of each cell across them.
//   node bench/report.mjs run1.json run2.json run3.json
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const median = values => {
  const sorted = values.filter(value => value !== undefined).sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};
const keyOf = result => `${result.algorithm} ${result.mode} ${result.size} ${result.chunk}`;
const cell = (result, library) => median(runs.map(run => run.results.find(other => keyOf(other) === keyOf(result))?.rows.find(row => row.library === library)?.ns));

const sizeName = size => size >= 1048576 ? `${size / 1048576} MiB` : size >= 1024 ? `${size / 1024} KiB` : `${size} B`;
const throughput = (size, ns) => ns === undefined ? '–' : size / ns >= 0.1 ? (size / ns).toFixed(2) : (size / ns).toPrecision(2);
const time = ns => ns === undefined ? '–' : ns >= 10000 ? `${(ns / 1000).toFixed(0)} µs` : `${ns.toFixed(0)} ns`;

const first = runs[0];
console.log(`Node ${first.node}, ${first.platform}, ${first.cpu}; ${runs.length} full runs, ${runs.map(run => run.date.slice(0, 16)).join(', ')} UTC.`);
console.log(`Load average (1, 5, 15 min) at the start and end of each run: ${runs.map(run => `${run.loadAverage.start.map(value => value.toFixed(2)).join(' ')} → ${run.loadAverage.end.map(value => value.toFixed(2)).join(' ')}`).join('; ')}.`);

const sections = [
  ['reused', 'throughput, GB/s (same input every call; higher is better)', 'Size', result => sizeName(result.size), (result, ns) => throughput(result.size, ns)],
  ['fresh', 'latency from a fresh buffer (a new copy every call, copy included; lower is better)', 'Size', result => sizeName(result.size), (result, ns) => time(ns)],
  ['stream', 'streaming 1 MiB in fixed-size updates, time per MiB (lower is better)', 'Update size', result => sizeName(result.chunk), (result, ns) => time(ns)],
];
for (const algorithm of ['xxh32', 'xxh64', 'xxh3', 'xxh128']) {
  for (const [mode, title, firstColumn, label, format] of sections) {
    const results = first.results.filter(result => result.algorithm === algorithm && result.mode === mode);
    if (!results.length) continue;
    const names = [...new Set(results.flatMap(result => result.rows.map(row => row.library)))];
    console.log(`\n#### ${algorithm}: ${title}\n`);
    console.log(`| ${firstColumn} | ${names.join(' | ')} |`);
    console.log(`| --- |${' ---: |'.repeat(names.length)}`);
    for (const result of results) console.log(`| ${label(result)} | ${names.map(name => format(result, cell(result, name))).join(' | ')} |`);
  }
}

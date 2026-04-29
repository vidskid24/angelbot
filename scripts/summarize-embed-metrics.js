/**
 * Summarize embed metrics emitted by src/lib/gemini.js logs.
 *
 * Usage:
 *   node scripts/summarize-embed-metrics.js <logFilePath>
 * Example:
 *   node scripts/summarize-embed-metrics.js app.log
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';

function formatPercent(numerator, denominator) {
  if (!denominator) return '0.00%';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function formatNum(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function parseMetricsLine(line) {
  const marker = '[embed-metrics]';
  const idx = line.indexOf(marker);
  if (idx < 0) return null;
  const jsonPart = line.slice(idx + marker.length).trim();
  if (!jsonPart.startsWith('{')) return null;
  try {
    return JSON.parse(jsonPart);
  } catch {
    return null;
  }
}

function printUsageAndExit() {
  console.log('Usage: node scripts/summarize-embed-metrics.js <logFilePath>');
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) printUsageAndExit();

const logPath = resolve(process.cwd(), inputPath);
const raw = await readFile(logPath, 'utf-8');
const lines = raw.split(/\r?\n/);

let parsedCount = 0;
let snapshotCount = 0;
let retryEventCount = 0;
let requestFailEventCount = 0;
let maxQueueDepth = 0;
let maxInFlight = 0;
let maxCacheSize = 0;
let maxPendingUnique = 0;
let latestSnapshot = null;

for (const line of lines) {
  const payload = parseMetricsLine(line);
  if (!payload) continue;
  parsedCount += 1;
  maxQueueDepth = Math.max(maxQueueDepth, Number(payload.queueDepth) || 0);
  maxInFlight = Math.max(maxInFlight, Number(payload.inFlight) || 0);
  if (payload.event === 'retry_scheduled') retryEventCount += 1;
  if (payload.event === 'request_fail') requestFailEventCount += 1;
  if (payload.event === 'snapshot') {
    snapshotCount += 1;
    maxCacheSize = Math.max(maxCacheSize, Number(payload.cacheSize) || 0);
    maxPendingUnique = Math.max(maxPendingUnique, Number(payload.pendingUnique) || 0);
    latestSnapshot = payload;
  }
}

if (!parsedCount) {
  console.log(`No [embed-metrics] JSON lines found in ${logPath}`);
  process.exit(0);
}

const stats = latestSnapshot?.stats || {};
const cacheHit = Number(stats.cacheHit) || 0;
const cacheMiss = Number(stats.cacheMiss) || 0;
const dedupeJoin = Number(stats.dedupeJoin) || 0;
const retries = Number(stats.retries) || 0;
const requestOk = Number(stats.requestOk) || 0;
const requestFail = Number(stats.requestFail) || 0;

const cacheLookups = cacheHit + cacheMiss;
const totalRequests = requestOk + requestFail;

console.log('Embed Metrics Summary');
console.log(`Log file: ${logPath}`);
console.log(`Parsed metrics lines: ${formatNum(parsedCount)}`);
console.log(`Snapshot events: ${formatNum(snapshotCount)}`);
console.log('');
console.log('Rates');
console.log(`- Cache hit rate: ${formatPercent(cacheHit, cacheLookups)} (${cacheHit}/${cacheLookups})`);
console.log(`- Retry rate (vs requests): ${formatPercent(retries, totalRequests)} (${retries}/${totalRequests})`);
console.log(`- Failure rate: ${formatPercent(requestFail, totalRequests)} (${requestFail}/${totalRequests})`);
console.log('');
console.log('Totals');
console.log(`- requestOk: ${formatNum(requestOk)}`);
console.log(`- requestFail: ${formatNum(requestFail)}`);
console.log(`- retries: ${formatNum(retries)}`);
console.log(`- dedupeJoin: ${formatNum(dedupeJoin)}`);
console.log(`- retry events observed: ${formatNum(retryEventCount)}`);
console.log(`- request_fail events observed: ${formatNum(requestFailEventCount)}`);
console.log('');
console.log('Peaks');
console.log(`- max queueDepth: ${formatNum(maxQueueDepth)}`);
console.log(`- max inFlight: ${formatNum(maxInFlight)}`);
console.log(`- max cacheSize: ${formatNum(maxCacheSize)}`);
console.log(`- max pendingUnique: ${formatNum(maxPendingUnique)}`);

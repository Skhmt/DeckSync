#!/usr/bin/env node
/**
 * Benchmark: string-based vs packed-int Hamming distance for DeckSync pHash
 * matching.
 *
 * Uses the REAL index (public/card-hashes.bin) so the bit distribution and
 * index size (~570k hashes per aspect class) match production. Simulates one
 * camera frame = one query hash compared against every stored variant of a
 * single aspect class, repeated for several frames, and reports time/frame +
 * speedup. The string version calls the actual production function
 * (src/lib/ocr/phash.ts); the packed version stores each 64-bit hash as two
 * 32-bit words and counts bits with a 16-bit lookup table (no slicing, no
 * parseInt, no GC churn).
 *
 * Usage:
 *   node scripts/bench-hamming.js
 *   DECKSYNC_BENCH_FRAMES=50 node scripts/bench-hamming.js
 *   DECKSYNC_BENCH_CLASS=169 node scripts/bench-hamming.js
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { hammingDistance } from '../src/lib/ocr/phash.ts';
import { readBinIndex } from './hash-index-bin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH_FILE = path.join(ROOT, 'public', 'card-hashes.bin');
const CLASS_KEY = process.env.DECKSYNC_BENCH_CLASS ?? '43';
const FRAMES = Math.max(1, Number(process.env.DECKSYNC_BENCH_FRAMES ?? 20));

// --- Load real variant hashes for one aspect class ---------------------------

function loadHashes() {
  const { records } = readBinIndex(HASH_FILE);
  const out = [];
  for (const rec of records) {
    const variants = rec.hashes?.[CLASS_KEY];
    if (Array.isArray(variants)) for (const h of variants) out.push(h);
  }
  return out;
}

// --- Packed-int representation ----------------------------------------------
// Each 64-bit hash -> two 32-bit words. Popcount via a 16-bit LUT: two table
// reads per word, no string work. Built once at "index load" (not timed).

const PC16 = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) PC16[i] = PC16[i >> 1] + (i & 1);

function packAll(hashes) {
  const hi = new Uint32Array(hashes.length);
  const lo = new Uint32Array(hashes.length);
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    hi[i] = parseInt(h.slice(0, 8), 16); // upper 32 bits
    lo[i] = parseInt(h.slice(8, 16), 16); // lower 32 bits
  }
  return { hi, lo };
}

function popcount32(x) {
  return PC16[x & 0xffff] + PC16[(x >>> 16) & 0xffff];
}

// Same shape as hammingDistance(a, b): a function taking two hashes.
function hammingPacked(hiA, loA, hiB, loB) {
  if (hiA === hiB && loA === loB) return 0;
  return popcount32(hiA ^ hiB) + popcount32(loA ^ loB);
}

// One "frame": compare a query against every stored variant, track the min.
function frameString(query, hashes) {
  let best = 65;
  for (let i = 0; i < hashes.length; i++) {
    const d = hammingDistance(hashes[i], query);
    if (d < best) best = d;
  }
  return best;
}

function framePacked(qHi, qLo, hi, lo) {
  let best = 65;
  for (let i = 0; i < hi.length; i++) {
    const d = hammingPacked(hi[i], lo[i], qHi, qLo);
    if (d < best) best = d;
  }
  return best;
}

// --- Correctness: packed must exactly match the production string version ----

function verify(hashes, hi, lo) {
  let checked = 0;
  for (let t = 0; t < 500; t++) {
    const a = (Math.random() * hashes.length) | 0;
    const b = (Math.random() * hashes.length) | 0;
    const expected = hammingDistance(hashes[a], hashes[b]);
    const got = hammingPacked(hi[a], lo[a], hi[b], lo[b]);
    if (expected !== got) {
      console.error(`MISMATCH a=${a} b=${b}: string=${expected} packed=${got}`);
      return false;
    }
    checked++;
  }
  console.log(`correctness: ${checked} random pairs match exactly ✓`);
  return true;
}

// --- Timing ------------------------------------------------------------------

function timeFrames(runOne, queries) {
  // Warm up (JIT + allocation) outside the timed region.
  for (let k = 0; k < 2; k++) runOne(queries[k % queries.length]);
  const t0 = process.hrtime.bigint();
  let sink = 0;
  for (const q of queries) sink += runOne(q);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { elapsedMs, sink };
}

// --- Main --------------------------------------------------------------------

console.log(`loading ${CLASS_KEY} hashes from card-hashes.bin ...`);
const hashes = loadHashes();
const N = hashes.length;
if (N === 0) {
  console.error(`no hashes found for class "${CLASS_KEY}" — run npm run prepare:hashes first`);
  process.exit(1);
}
const packed = packAll(hashes);

// Evenly spread queries across the index, identical for both versions.
const qIdx = [];
for (let k = 0; k < FRAMES; k++) qIdx.push(Math.min(N - 1, Math.floor((k * N) / FRAMES)));
const qStrings = qIdx.map((i) => hashes[i]);

if (!verify(hashes, packed.hi, packed.lo)) process.exit(1);

// Per-query closures so both versions run the identical query sequence.
const strRun = (q) => frameString(qStrings[q], hashes);
const pkRun = (q) => framePacked(packed.hi[qIdx[q]], packed.lo[qIdx[q]], packed.hi, packed.lo);

const str = timeFrames(strRun, Array.from({ length: FRAMES }, (_, k) => k));
const pk = timeFrames(pkRun, Array.from({ length: FRAMES }, (_, k) => k));

const perFrameStrMs = str.elapsedMs / FRAMES;
const perFramePkMs = pk.elapsedMs / FRAMES;
const nsPerCmpStr = (str.elapsedMs * 1e6) / (FRAMES * N);
const nsPerCmpPk = (pk.elapsedMs * 1e6) / (FRAMES * N);

console.log('');
console.log(`index: ${N.toLocaleString()} hashes for class "${CLASS_KEY}" (≈${Math.round(N / 10).toLocaleString()} entries × 10 variants)`);
console.log(`frames: ${FRAMES}   comparisons/frame: ${N.toLocaleString()}`);
console.log('');
console.log(`                 string        packed-int`);
console.log(`  per frame       ${perFrameStrMs.toFixed(2).padStart(9)} ms   ${perFramePkMs.toFixed(2).padStart(9)} ms`);
console.log(`  per comparison  ${nsPerCmpStr.toFixed(1).padStart(9)} ns   ${nsPerCmpPk.toFixed(1).padStart(9)} ns`);
console.log('');
console.log(`speedup: ${(perFrameStrMs / perFramePkMs).toFixed(2)}×  (string → packed-int)`);
console.log(`packed array size: ${((packed.hi.byteLength + packed.lo.byteLength) / 1048576).toFixed(2)} MB (two Uint32Array of ${N.toLocaleString()})`);
// keep the JIT from dead-code-eliminating the loops
void str.sink;
void pk.sink;
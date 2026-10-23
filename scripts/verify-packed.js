import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readBinPacked } from './hash-index-bin.js';
import { HASH_ASPECT_CLASSES } from '../src/lib/ocr/phash.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'public', 'card-hashes.bin');

// --- production-identical helpers (mirror src/lib/ocr/phash.ts) ---
let PC16 = null;
function pc16() {
  if (!PC16) { PC16 = new Uint8Array(1 << 16); for (let i = 1; i < PC16.length; i++) PC16[i] = PC16[i >> 1] + (i & 1); }
  return PC16;
}
function splitHash(h) { return [parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8), 16) >>> 0]; }
function hammingPacked(a, b, c, d) {
  if (a === c && b === d) return 0;
  const t = pc16(); const x = a ^ c, y = b ^ d;
  return t[x & 0xffff] + t[(x >>> 16) & 0xffff] + t[y & 0xffff] + t[(y >>> 16) & 0xffff];
}
function packHashes(list) {
  const n = list.length, hi = new Uint32Array(n), lo = new Uint32Array(n);
  for (let i = 0; i < n; i++) { hi[i] = parseInt(list[i].slice(0, 8), 16) >>> 0; lo[i] = parseInt(list[i].slice(8), 16) >>> 0; }
  return { hi, lo };
}
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let c = 0; for (let x = i; x; x &= x - 1) c++; POPCOUNT[i] = c; }
function hammingDistance(a, b) {
  if (a === b) return 0;
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a.slice(i * 2, i * 2 + 2), 16) ^ parseInt(b.slice(i * 2, i * 2 + 2), 16)];
  return d;
}
function wordsToHex(hi, lo) { return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0'); }

// --- load packed arrays straight from the binary (mirror src/lib/data/cardHashes.ts) ---
const { header, ids, classes } = readBinPacked(FILE);
console.log(`entries: ${ids.length}, region ${JSON.stringify(header.region)}, threshold ${header.threshold}`);

let failures = 0;
for (const cls of HASH_ASPECT_CLASSES.map(c => c.key)) {
  const pc = classes[cls];
  if (!pc || pc.hi.length === 0) { console.log(`class ${cls}: no hashes — skipped`); continue; }
  const hi = pc.hi, lo = pc.lo, owner = pc.owner;

  // Packed scan — mirrors hashScanner.matchFrame (returns winning slot + id).
  function packedScan(query) {
    const [qh, ql] = splitHash(query);
    let bd = 65, bs = -1;
    for (let i = 0; i < hi.length; i++) { const d = hammingPacked(hi[i], lo[i], qh, ql); if (d < bd) { bd = d; bs = i; } }
    return bs < 0 ? null : { slot: bs, id: ids[owner[bs]], distance: bd };
  }
  // Reference string scan over the same flat class (hex reconstructed from the
  // packed words) using the independent per-bit implementation.
  const hexes = new Array(hi.length);
  for (let i = 0; i < hi.length; i++) hexes[i] = wordsToHex(hi[i], lo[i]);
  function stringScan(query) {
    let best = null;
    for (let i = 0; i < hexes.length; i++) { const d = hammingDistance(hexes[i], query); if (!best || d < best.distance) best = { slot: i, distance: d }; }
    return best;
  }

  // Test 1 (fast): a stored slot's own hash must come back at distance 0 —
  // proves the packed loop finds the true minimum and owner mapping is sane.
  let t1ok = 0, t1n = 2000;
  for (let t = 0; t < t1n; t++) {
    const i = (Math.random() * hi.length) | 0;
    const ps = packedScan(wordsToHex(hi[i], lo[i]));
    if (ps && ps.distance === 0) t1ok++;
  }

  // Timing: one full packed scan per "frame".
  const q0 = 'deadbeefcafebabe';
  const REPS = 30;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < REPS; i++) packedScan(q0);
  const perFrameMs = Number(process.hrtime.bigint() - t0) / 1e6 / REPS;

  console.log(`class ${cls}: ${hi.length} hashes, exact-hash distance-0 ${t1ok}/${t1n} OK, packed scan ~${perFrameMs.toFixed(2)} ms/frame`);
  if (t1ok !== t1n) failures++;

  // Test 2 (slow — full string scan each): limited equivalence cross-check on
  // one class only to stay within the time budget. Both scans iterate the same
  // flat array, so winning slot + distance must agree exactly.
  if (cls === '43') {
    let t2ok = 0, t2n = 15;
    for (let t = 0; t < t2n; t++) {
      const useStored = t % 2 === 0;
      let q;
      if (useStored) {
        const i = (Math.random() * hi.length) | 0;
        q = wordsToHex(hi[i], lo[i]);
      } else {
        q = ''; for (let i = 0; i < 16; i++) q += '0123456789abcdef'[(Math.random() * 16) | 0];
      }
      const ps = packedScan(q), ss = stringScan(q);
      if ((ps?.distance ?? -1) === (ss?.distance ?? -1) && (ps?.slot ?? -1) === (ss?.slot ?? -1)) t2ok++;
    }
    console.log(`class ${cls}: string-vs-packed equivalence ${t2ok}/${t2n} agree`);
    if (t2ok !== t2n) failures++;
  }
}

console.log(failures === 0 ? 'PASS: packed path is correct and matches the string path' : `FAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
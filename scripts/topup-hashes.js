#!/usr/bin/env node
/**
 * Top-up: download face images for card-hashes.bin entries that are missing
 * from scripts/.cache/hashes/, so the pHash-vs-OCR benchmark (test-hash-vs-ocr.js)
 * can simulate a photo for every indexed card — expanding face-cache / card-set
 * coverage beyond whatever fraction survived the original build.
 *
 * Why this exists: prepare-hashes.js downloads each face once and records only
 * {id, face, name, status} in hashes-progress.jsonl (no image URL). When the
 * index is rebuilt/extended, some referenced faces are absent from the cache
 * (~50% here). This script re-resolves each missing face with a single Scryfall
 * API call (GET /cards/{id}) and pulls the image from the CDN, mirroring the
 * exact URL fields prepare-hashes.js uses (image_uris.normal for the front,
 * card_faces[i].image_uris.normal for DFC backs) and the same {id}-f{face}.jpg
 * cache naming. Paced to 1 request/sec like the original build.
 *
 * Resumable: existing cache files are skipped; a side ledger
 * (scripts/.cache/topup-progress.jsonl) records ids already attempted so a
 * re-run does not re-hit the API for permanent misses (HTTP 404). Cancelling
 * (Ctrl+C / kill) loses nothing — just re-run and it picks up where it stopped.
 *
 * Usage:
 *   node scripts/topup-hashes.js                          # top up everything missing
 *   DECKSYNC_TOPUP_LIMIT=500 node scripts/topup-hashes.js # cap API calls this run
 *   DECKSYNC_TOPUP_NAMES="Black Lotus,Lightning Bolt" ... # only these card names
 *
 * Watch live progress:
 *   Get-Content -Wait scripts/.cache/topup-progress.log
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readBinIndex } from './hash-index-bin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH_FILE = path.join(ROOT, 'public', 'card-hashes.bin');
const CACHE_DIR = path.join(ROOT, 'scripts', '.cache', 'hashes');
/** Side ledger of ids already attempted (permanent misses) — keep out of the served index. */
const TOPUP_LEDGER = path.join(ROOT, 'scripts', '.cache', 'topup-progress.jsonl');
/** Heartbeat log that flushes to disk immediately (stdout can be block-buffered). */
const LOG_FILE = path.join(ROOT, 'scripts', '.cache', 'topup-progress.log');

const API_CARD_URL = 'https://api.scryfall.com/cards/';
const USER_AGENT = 'DeckSync/1.0 (hash face top-up)';
/** Scryfall allows 1 request/second — pace every api.scryfall.com call. */
const API_DELAY_MS = 1100;
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;

function log(msg) {
  console.log(msg);
  appendFileSync(LOG_FILE, msg + '\n');
}

/**
 * Returns a Map<id, { faces:Set<number>, name }> for every index entry whose
 * face file is missing from the cache. One API call per id can fetch any number
 * of its faces, so we group by id.
 */
function loadMissing() {
  const wanted = new Map();
  for (const rec of readBinIndex(HASH_FILE).records) {
    if (!rec?.id || !rec.hashes) continue;
    const face = Number(rec.face ?? 0);
    if (existsSync(path.join(CACHE_DIR, `${rec.id}-f${face}.jpg`))) continue; // already cached
    if (!wanted.has(rec.id)) wanted.set(rec.id, { faces: new Set(), name: rec.name ?? '' });
    wanted.get(rec.id).faces.add(face);
  }
  return wanted;
}

/** Ids we've already attempted (and permanently missed) in a prior top-up run. */
function loadAttempted() {
  const set = new Set();
  if (!existsSync(TOPUP_LEDGER)) return set;
  for (const raw of readFileSync(TOPUP_LEDGER, 'utf8').split('\n')) {
    let rec;
    try {
      rec = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    if (rec?.id) set.add(rec.id);
  }
  return set;
}

let lastApiCall = 0;
/** Paces api.scryfall.com calls to at most one per second. */
async function paceApi() {
  const wait = lastApiCall + API_DELAY_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastApiCall = Date.now();
}

/** Fetches the Scryfall card object for an id; null on a permanent 404. */
async function fetchCard(id) {
  for (let attempt = 0; ; attempt++) {
    await paceApi();
    try {
      const res = await fetch(API_CARD_URL + id, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (res.status === 404) return null; // card no longer resolvable — permanent miss
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise(r => setTimeout(r, API_DELAY_MS * (attempt + 2)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for /cards/${id}`);
      return res.json();
    } catch (err) {
      if (attempt >= 3) throw err; // transient failure — re-run will retry this id
      await new Promise(r => setTimeout(r, API_DELAY_MS * (attempt + 2)));
    }
  }
}

/** Face image URLs for a printing — mirrors prepare-hashes.js faceImagesFor(). */
function faceImagesFor(card) {
  const faces = [];
  // Some multi-faced printings carry no top-level image — the front lives in card_faces[0].
  const frontUrl = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  if (frontUrl) faces.push({ face: 0, url: frontUrl });
  if (Array.isArray(card.card_faces)) {
    for (let i = 1; i < card.card_faces.length; i++) {
      const url = card.card_faces[i]?.image_uris?.normal;
      if (url) faces.push({ face: i, url });
    }
  }
  return faces;
}

/** Downloads one face into the cache (atomic tmp + rename). Returns bytes written. */
async function downloadFace(cardId, face, url) {
  const file = path.join(CACHE_DIR, `${cardId}-f${face}.jpg`);
  if (existsSync(file)) return 0;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for image ${url}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, file);
  return buffer.length;
}

/** Recomputes face-cache coverage across the whole index (present / total entries). */
function coverage() {
  let total = 0;
  let present = 0;
  for (const rec of readBinIndex(HASH_FILE).records) {
    if (!rec?.id || !rec.hashes) continue;
    total++;
    const face = Number(rec.face ?? 0);
    if (existsSync(path.join(CACHE_DIR, `${rec.id}-f${face}.jpg`))) present++;
  }
  return { total, present, pct: total ? (100 * present) / total : 0 };
}

async function main() {
  if (!existsSync(HASH_FILE)) {
    console.error('public/card-hashes.bin not found — run `npm run prepare:hashes` first.');
    process.exitCode = 1;
    return;
  }

  writeFileSync(LOG_FILE, ''); // fresh log for this run
  const wanted = loadMissing();
  const attempted = loadAttempted();

  const names = process.env.DECKSYNC_TOPUP_NAMES
    ? new Set(process.env.DECKSYNC_TOPUP_NAMES.split(',').map(s => s.trim()).filter(Boolean))
    : null;
  const limit = process.env.DECKSYNC_TOPUP_LIMIT ? Number(process.env.DECKSYNC_TOPUP_LIMIT) : Infinity;

  // Apply the optional name filter, then drop ids we already permanently missed.
  const queue = [];
  for (const [id, info] of wanted) {
    if (names && !names.has(info.name)) continue;
    if (attempted.has(id)) continue;
    queue.push([id, info]);
  }

  const before = coverage();
  log(
    `[topup-hashes] start: ${queue.length} ids to try ` +
      `(limit=${limit === Infinity ? '∞' : limit}) — coverage now ${before.pct.toFixed(2)}% (${before.present}/${before.total})`
  );

  let done = 0;
  let downloaded = 0;
  let noImage = 0;
  let failed = 0;
  const started = Date.now();

  for (const [id, info] of queue) {
    if (done >= limit) break;
    let card;
    try {
      card = await fetchCard(id);
    } catch (err) {
      failed++;
      log(`[topup-hashes]   ${info.name || id}: FAILED (${err.message}) — will retry next run`);
      continue;
    }
    if (!card) {
      noImage++; // 404 — record so we never re-hit the API for it
      appendFileSync(TOPUP_LEDGER, JSON.stringify({ id, name: info.name, status: 'not-found' }) + '\n');
      continue;
    }
    const urls = new Map(faceImagesFor(card).map(f => [f.face, f.url]));
    let ok = true;
    for (const face of info.faces) {
      const url = urls.get(face);
      if (!url) {
        ok = false; // wanted a face the card object doesn't expose — skip, don't retry
        continue;
      }
      try {
        const bytes = await downloadFace(id, face, url);
        if (bytes > 0) downloaded++;
      } catch (err) {
        ok = false;
        log(`[topup-hashes]   ${info.name || id} f${face}: image FAILED (${err.message}) — will retry next run`);
      }
    }
    done++;
    if (done % 25 === 0 || done === queue.length) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = elapsed > 0 ? done / elapsed : 0;
      const leftMin = rate > 0 && done < queue.length ? (queue.length - done) / rate / 60 : 0;
      log(
        `[topup-hashes] ${done}/${queue.length} ids — +${downloaded} faces, ` +
          `${noImage} not-found, ${failed} failed — ${elapsed.toFixed(0)}s` +
          (rate > 0 ? `, ~${leftMin.toFixed(0)} min left` : '')
      );
    }
    if (!ok) { /* partial failure — the cache file is the record; next run re-resolves this id */ }
  }

  const after = coverage();
  log(
    `[topup-hashes] done: ${done} ids processed, +${downloaded} faces downloaded, ` +
      `${noImage} not-found, ${failed} failed — in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  log(
    `[topup-hashes] coverage: ${before.pct.toFixed(2)}% -> ${after.pct.toFixed(2)}% ` +
      `(${before.present} -> ${after.present} of ${after.total} faces cached)`
  );
}

// Ctrl+C: everything written to disk is durable — just re-run to resume.
process.on('SIGINT', () => {
  console.log('\n[topup-hashes] interrupted — downloaded faces are saved; re-run to resume where it stopped');
  process.exit(130);
});

main().catch(err => {
  console.error('[topup-hashes] FAILED:', err.message, '— re-run to resume (completed downloads are kept)');
  process.exitCode = 1;
});
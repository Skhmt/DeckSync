/**
 * Runtime pHash identification for camera frames. Crops the hashed art region
 * out of a full frame (the same geometry scripts/prepare-hashes.js rendered),
 * hashes it once with computePHashFromRGBA and matches against the local
 * index — typically well under 100 ms per frame, no network involved.
 *
 * Tilt and size tolerance come from the stored variants (pre-rotated /
 * pre-scaled renders in the index), so the app side only ever hashes a single
 * unrotated crop. Multiple frames vote; the card with the most votes wins
 * (ties break on lowest average distance).
 */

import { ensureCardHashes, type CardHashEntry } from '../data/cardHashes';
import { CARD_ZONE } from './cardScanner';
import {
  computePHashFromRGBA,
  hammingDistance,
  hashAspectClassKey,
  type PixelBuffer
} from './phash';

/** Best match found for one frame. */
export interface HashFrameMatch {
  entry: CardHashEntry;
  /** Hamming distance (0–64) to the closest stored variant */
  distance: number;
}

/** Final identification result across all frames. */
export interface HashScanResult {
  entry: CardHashEntry;
  /** Best distance seen for the winning card */
  distance: number;
  /** How many of the input frames voted for this card */
  votes: number;
}

/** Max width (px) a crop is downscaled to before hashing — keeps hashing cheap. */
const MAX_CROP_WIDTH = 640;

/**
 * Crops the hashed region out of a full-frame canvas. The region (fractions of
 * CARD_ZONE, from the loaded index) is mapped onto the full frame exactly like
 * the OCR regions in cardScanner.ts. Returns null when the crop is too small
 * to be meaningful.
 */
function cropHashRegion(
  frame: HTMLCanvasElement,
  region: { x0: number; y0: number; x1: number; y1: number }
): PixelBuffer | null {
  const fx0 = CARD_ZONE.x0 + region.x0 * (CARD_ZONE.x1 - CARD_ZONE.x0);
  const fy0 = CARD_ZONE.y0 + region.y0 * (CARD_ZONE.y1 - CARD_ZONE.y0);
  const fx1 = CARD_ZONE.x0 + region.x1 * (CARD_ZONE.x1 - CARD_ZONE.x0);
  const fy1 = CARD_ZONE.y0 + region.y1 * (CARD_ZONE.y1 - CARD_ZONE.y0);

  const sx = frame.width * fx0;
  const sy = frame.height * fy0;
  const sw = frame.width * (fx1 - fx0);
  const sh = frame.height * (fy1 - fy0);
  if (sw < 32 || sh < 32) return null;

  const scale = Math.min(1, MAX_CROP_WIDTH / sw);
  const w = Math.max(8, Math.round(sw * scale));
  const h = Math.max(8, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

/** Finds the closest index entry for one frame (null when nothing is close enough). */
function matchFrame(
  frame: HTMLCanvasElement,
  classKey: string,
  entries: CardHashEntry[],
  region: { x0: number; y0: number; x1: number; y1: number },
  threshold: number
): HashFrameMatch | null {
  const pix = cropHashRegion(frame, region);
  if (!pix) return null;
  const hash = computePHashFromRGBA(pix);

  let best: HashFrameMatch | null = null;
  for (const entry of entries) {
    const variants = entry.hashes[classKey];
    if (!variants) continue;
    for (const stored of variants) {
      const d = hammingDistance(stored, hash);
      if (!best || d < best.distance) best = { entry, distance: d };
    }
  }
  return best && best.distance <= threshold ? best : null;
}

/**
 * Identifies a card from one or more full-frame canvases. `frameAspect` is the
 * camera's videoWidth/videoHeight — it selects which aspect class of stored
 * hashes to match against. Resolves null when the index isn't loaded or no
 * frame comes within threshold (the OCR channel then carries the scan).
 */
export async function identifyByHash(
  frames: HTMLCanvasElement[],
  frameAspect: number
): Promise<HashScanResult | null> {
  const idx = await ensureCardHashes();
  if (!idx.ready || idx.entries.length === 0) return null;

  const classKey = hashAspectClassKey(frameAspect);
  // Votes per entry id (a card can have several face entries — front + DFC back)
  const votes = new Map<string, { card: string; count: number; totalDist: number }>();
  let bestEntry: CardHashEntry | null = null;
  let bestDistance = Infinity;

  for (const frame of frames) {
    const m = matchFrame(frame, classKey, idx.entries, idx.region, idx.threshold);
    if (!m) continue;
    const v = votes.get(m.entry.id) ?? { card: m.entry.id, count: 0, totalDist: 0 };
    v.count++;
    v.totalDist += m.distance;
    votes.set(m.entry.id, v);
    if (m.distance < bestDistance) {
      bestDistance = m.distance;
      bestEntry = m.entry;
    }
  }

  if (!bestEntry || votes.size === 0) return null;

  // Most votes wins; ties break on the lower average distance of the votes
  let winner: { card: string; count: number; totalDist: number } | null = null;
  for (const v of votes.values()) {
    if (!winner || v.count > winner.count || (v.count === winner.count && v.totalDist < winner.totalDist)) {
      winner = v;
    }
  }
  if (!winner) return null;

  // Prefer the voting entry whose id matches the winner when several faces share it
  const entry = idx.entries.find(e => e.id === winner.card) ?? bestEntry;
  return { entry, distance: bestDistance, votes: winner.count };
}
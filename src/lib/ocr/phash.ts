/**
 * Perceptual hashing (pHash) core for DeckSync card identification.
 *
 * Pure math over RGBA pixel buffers — no DOM, Node, or image-decoding
 * dependencies — so the exact same code runs in the browser (camera frames via
 * canvas) and in the pre-build script scripts/prepare-hashes.js (official card
 * images decoded with sharp). Identical input pixels therefore produce
 * bit-identical hashes on both platforms.
 *
 * Algorithm: luma → bilinear downscale to 32×32 → 2D DCT → keep the lowest
 * 8×8 frequencies (excluding DC) → threshold each against their median →
 * 64-bit hash stored as a 16-char hex string. Similar images differ by only a
 * few Hamming bits, so matching tolerates small rotation, rescale, JPEG
 * artifacts and lighting shifts. Tilted cards are handled by storing
 * pre-rotated hash variants at build time (see HASH_STORE_ANGLES /
 * HASH_STORE_FILLS), so the app only ever hashes a single unrotated crop.
 */

export interface PixelBuffer {
  /** RGBA, row-major, tightly packed (width*height*4 entries) */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A rectangle expressed as fractions of its parent area (0–1). */
export interface FrameRectLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The card-zone region (fractions of CARD_ZONE) hashed for identification.
 * The user lines the card up against the dashed guide so it fills the zone
 * height; this box then covers the central art area — inside the art window of
 * every frame style (old frames, modern frames, full-art), never touching the
 * name bar or text box. MUST stay in sync with scripts/prepare-hashes.js,
 * which crops the same fractions out of a synthetic zone render (the values
 * are also written into card-hashes.jsonl so the app reads them from there).
 */
export const HASH_ART_REGION = { x0: 0.25, y0: 0.20, x1: 0.75, y1: 0.60 };

/**
 * Camera aspect classes. The card's relative size inside the zone depends on
 * the frame aspect ratio (a portrait card in a landscape zone), so stored
 * hashes are built per class and the app matches against its own class.
 * `r` is the zone's width/height ratio for that class: r = 0.64·(frameW/frameH)/0.80 —
 * 1.067 for a 4:3 camera, 1.422 for a 16:9 one.
 */
export const HASH_ASPECT_CLASSES = [
  { key: '43', r: (0.64 * (4 / 3)) / 0.8, maxR: 1.2 },
  { key: '169', r: (0.64 * (16 / 9)) / 0.8, maxR: Infinity }
];

/** Picks the aspect-class key for a frame width/height ratio. */
export function hashAspectClassKey(frameAspect: number): string {
  const r = (0.64 * frameAspect) / 0.8;
  for (const c of HASH_ASPECT_CLASSES) {
    if (r <= c.maxR) return c.key;
  }
  return HASH_ASPECT_CLASSES[HASH_ASPECT_CLASSES.length - 1].key;
}

/**
 * Pre-build variant grid: stored hashes are rendered with the card rotated by
 * each angle (tilt tolerance — a tilted photo matches its own angle variant at
 * near-perfect distance) and scaled to each fill of the zone height (the user
 * may hold the card slightly smaller than the guide). Variant order in the
 * stored arrays: fill outer, angle inner.
 */
export const HASH_STORE_ANGLES = [-8, -4, 0, 4, 8];
export const HASH_STORE_FILLS = [1.0, 0.85];

/** Max Hamming distance (of 64 bits) for a hash to count as a match. */
export const HASH_MATCH_THRESHOLD = 12;

/** Pre-build dedupe: hashes within this distance are the same visual family. */
export const HASH_DEDUP_DISTANCE = 8;

const DCT_SIZE = 32;

let cosTable: Float64Array | null = null;

function getCosTable(): Float64Array {
  if (!cosTable) {
    cosTable = new Float64Array(DCT_SIZE * DCT_SIZE);
    for (let u = 0; u < DCT_SIZE; u++) {
      const off = u * DCT_SIZE;
      for (let x = 0; x < DCT_SIZE; x++) {
        cosTable[off + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE));
      }
    }
  }
  return cosTable;
}

/** Bilinear sample of a single-channel buffer with edge clamping. */
function sampleBilinear(src: Float64Array, sw: number, sh: number, sx: number, sy: number): number {
  const cx = Math.min(Math.max(sx, 0), sw - 1e-6);
  const cy = Math.min(Math.max(sy, 0), sh - 1e-6);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, sw - 1);
  const y1 = Math.min(y0 + 1, sh - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx;
  const bottom = src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Bilinear downscale to n×n (pixel-center mapping, edge clamped). */
function bilinearResize(src: Float64Array, sw: number, sh: number, n: number): Float64Array {
  const out = new Float64Array(n * n);
  const xr = sw / n;
  const yr = sh / n;
  for (let y = 0; y < n; y++) {
    const sy = (y + 0.5) * yr - 0.5;
    const rowOff = y * n;
    for (let x = 0; x < n; x++) {
      out[rowOff + x] = sampleBilinear(src, sw, sh, (x + 0.5) * xr - 0.5, sy);
    }
  }
  return out;
}

/**
 * Unnormalized separable 2D DCT (type II). Output is indexed [v][u] with v the
 * vertical and u the horizontal frequency — only the low-frequency block is
 * ever used downstream, so no normalization is applied.
 */
function dct2d(f: Float64Array): Float64Array {
  const n = DCT_SIZE;
  const cos = getCosTable();

  // Transform rows
  const tmp = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const rowOff = y * n;
    for (let u = 0; u < n; u++) {
      let sum = 0;
      const cosOff = u * n;
      for (let x = 0; x < n; x++) sum += f[rowOff + x] * cos[cosOff + x];
      tmp[rowOff + u] = sum;
    }
  }

  // Transform columns, transposing into F(v, u) layout
  const out = new Float64Array(n * n);
  for (let x = 0; x < n; x++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      const cosOff = v * n;
      for (let y = 0; y < n; y++) sum += tmp[y * n + x] * cos[cosOff + y];
      out[v * n + x] = sum;
    }
  }
  return out;
}

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let c = 0;
  for (let b = i; b; b &= b - 1) c++;
  POPCOUNT[i] = c;
}

/** Hamming distance between two 16-char hex hashes (0–64). */
export function hammingDistance(a: string, b: string): number {
  if (a === b) return 0;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    dist += POPCOUNT[parseInt(a.slice(i * 2, i * 2 + 2), 16) ^ parseInt(b.slice(i * 2, i * 2 + 2), 16)];
  }
  return dist;
}


/**
 * Computes the 64-bit perceptual hash of an RGBA buffer as a 16-char hex
 * string. The input is downsampled internally to 32×32, so callers may pass
 * any resolution (typically the cropped card-art region).
 */
export function computePHashFromRGBA(pix: PixelBuffer): string {
  const { data, width: sw, height: sh } = pix;
  if (!sw || !sh || data.length < sw * sh * 4) return '0'.repeat(16);

  // Luma (same weights as the OCR preprocessing in cardScanner.ts)
  const src = new Float64Array(sw * sh);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    src[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const small = bilinearResize(src, sw, sh, DCT_SIZE);
  const dct = dct2d(small);

  // Median of the low-frequency block (63 values, DC excluded)
  const vals: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      if (v || u) vals.push(dct[v * DCT_SIZE + u]);
    }
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[31];

  // Fixed bit order: v outer, u inner, (0,0) skipped — MSB-first into bytes
  const bytes = new Uint8Array(8);
  let bit = 0;
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      if (!v && !u) continue;
      if (dct[v * DCT_SIZE + u] > median) bytes[bit >> 3] |= 1 << (7 - (bit & 7));
      bit++;
    }
  }

  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

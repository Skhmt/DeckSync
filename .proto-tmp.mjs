import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computePHashFromRGBA, rotatedCenterCrop, hammingDistance } from './src/lib/ocr/phash.ts';

const UA = { headers: { 'User-Agent': 'DeckSync/1.0 (proto)' } };
const CACHE = '/tmp/phashproto/imgs';
mkdirSync(CACHE, { recursive: true });
const BG = { r: 90, g: 85, b: 75 };

const ZONE = { x0: 0.18, y0: 0.10, x1: 0.82, y1: 0.90 };
const ART = { x0: 0.25, y0: 0.20, x1: 0.75, y1: 0.60 };
const CLASSES = [ { key: '43', r: (0.64 * 1.3333) / 0.80 }, { key: '169', r: (0.64 * 1.7778) / 0.80 } ];
const STORE_ANGLES = [-9, -4, 0, 4, 9];      // stored pre-rotated variants
const STORE_FILLS = [1.0, 0.9, 0.8];           // stored fill-scale variants (card smaller than zone)

async function faceImage(name) {
  const file = path.join(CACHE, name.replace(/[^a-z0-9]+/gi, '_') + '.jpg');
  if (existsSync(file)) return { buf: readFileSync(file), fromCache: true };
  const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, UA);
  const card = await r.json();
  const ir = await fetch(card.image_uris.normal, UA);
  const buf = Buffer.from(await ir.arrayBuffer());
  writeFileSync(file, buf);
  return { buf, id: card.id };
}

async function rawRGBA(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function cropFraction(pix, rect) {
  const x0 = Math.floor(rect.x0 * pix.width);
  const y0 = Math.floor(rect.y0 * pix.height);
  const x1 = Math.max(x0 + 1, Math.floor(rect.x1 * pix.width));
  const y1 = Math.max(y0 + 1, Math.floor(rect.y1 * pix.height));
  const cw = x1 - x0, ch = y1 - y0;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const off = ((y0 + y) * pix.width + x0) * 4;
    pix.data.copy(out, y * cw * 4, off, off + cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

// Render face into synthetic zone; card rotated by angDeg, filling fillScale of zone height
async function renderZone(faceBuf, r, angDeg, fillScale) {
  const zw = 1024, zh = Math.round(zw / r);
  const meta = await sharp(faceBuf).metadata();
  const H = Math.round(zh * fillScale), W = Math.round(H * meta.width / meta.height);
  const resized = await sharp(faceBuf).resize(W, H).toBuffer();
  const rot = angDeg === 0 ? resized : await sharp(resized).rotate(angDeg, { background: BG }).toBuffer();
  const rm = await sharp(rot).metadata();
  // Canvas must fit the rotated card; the zone is its central zw x zh rectangle
  const cw = Math.max(zw, rm.width), ch = Math.max(zh, rm.height);
  const canvas = await sharp({ create: { width: cw, height: ch, channels: 3, background: BG } })
    .composite([{ input: rot, left: Math.round((cw - rm.width) / 2), top: Math.round((ch - rm.height) / 2) }])
    .png()
    .toBuffer();
  const full = await rawRGBA(canvas);
  return cropFraction(full, { x0: (cw - zw) / 2 / cw, y0: (ch - zh) / 2 / ch, x1: 1 - (cw - zw) / 2 / cw, y1: 1 - (ch - zh) / 2 / ch });
}

async function simulateZonePhoto(faceBuf, r, phiDeg, fillScale, dx, dy, jpegQ) {
  const a = (r * 0.8) / 0.64;
  const fw = 1920, fh = Math.round(fw / a);
  const zw = Math.round((ZONE.x1 - ZONE.x0) * fw), zh = Math.round((ZONE.y1 - ZONE.y0) * fh);
  const zx = Math.round(ZONE.x0 * fw), zy = Math.round(ZONE.y0 * fh);
  const meta = await sharp(faceBuf).metadata();
  const H = Math.round(zh * fillScale), W = Math.round(H * meta.width / meta.height);
  const resized = await sharp(faceBuf).resize(W, H).jpeg({ quality: jpegQ }).toBuffer();
  const rot = phiDeg === 0 ? resized : await sharp(resized).rotate(phiDeg, { background: BG }).toBuffer();
  const rm = await sharp(rot).metadata();
  const frame = await sharp({ create: { width: fw, height: fh, channels: 3, background: BG } })
    .composite([{ input: rot, left: zx + Math.round((zw - rm.width) / 2) + dx, top: zy + Math.round((zh - rm.height) / 2) + dy }])
    .jpeg({ quality: jpegQ }).toBuffer();
  return cropFraction(await rawRGBA(frame), ZONE);
}

// App-side: candidates = pHash of ART crop at each zoom level (no rotation)
function appCandidates(zonePix) {
  const cands = [computePHashFromRGBA(cropFraction(zonePix, ART))];
  if (false) for (const z of [1.0]) {
    const art = z >= 1.0 ? cropFraction(zonePix, ART) : cropFraction(zonePix, {
      x0: 0.5 - (ART.x1 - ART.x0) * z / 2, y0: 0.5 - (ART.y1 - ART.y0) * z / 2,
      x1: 0.5 + (ART.x1 - ART.x0) * z / 2, y1: 0.5 + (ART.y1 - ART.y0) * z / 2
    });
    cands.push(computePHashFromRGBA(art));
  }
  return cands;
}

function match(storedVariantHashes, zonePix) {
  const cands = appCandidates(zonePix);
  let best = { d: 99 };
  for (const c of cands) for (const s of storedVariantHashes) {
    const d = hammingDistance(s, c);
    if (d < best.d) best = { d };
  }
  return best;
}

async function main() {
  const storedAll = {};
  for (const name of ['Black Lotus', 'Lightning Bolt']) {
    const { buf } = await faceImage(name);
    console.log(`\n== ${name} ==`);
    for (const cls of CLASSES) {
      // build stored variants: class x store-angle (fill 1.0, clean render)
      const variants = [];
      for (const fill of STORE_FILLS) {
        for (const ang of STORE_ANGLES) {
          variants.push(computePHashFromRGBA(cropFraction(await renderZone(buf, cls.r, ang, fill), ART)));
        }
      }
      storedAll[`${name}:${cls.key}`] = variants;
      let b = match(variants, await simulateZonePhoto(buf, cls.r, 0, 1.0, 0, 0, 85));
      console.log(`  [${cls.key}] tilt 0 fill 1.0 -> d=${b.d}`);
      for (const phi of [3, 6, 9, 12]) {
        b = match(variants, await simulateZonePhoto(buf, cls.r, phi, 1.0, 0, 0, 85));
        console.log(`  [${cls.key}] tilt ${String(phi).padStart(2)} fill 1.0 -> d=${b.d}`);
      }
      b = match(variants, await simulateZonePhoto(buf, cls.r, 0, 0.9, 0, 0, 85));
      console.log(`  [${cls.key}] tilt 0 fill .9  -> d=${b.d}`);
      b = match(variants, await simulateZonePhoto(buf, cls.r, 0, 0.85, Math.round(0.02 * 1228), Math.round(0.03 * (1228 / cls.r)), 85));
      console.log(`  [${cls.key}] fill .85 off    -> d=${b.d}`);
      b = match(variants, await simulateZonePhoto(buf, cls.r, 6, 0.9, Math.round(0.02 * 1228), Math.round(0.03 * (1228 / cls.r)), 85));
      console.log(`  [${cls.key}] tilt 6 fill .9 off -> d=${b.d}`);
      b = match(variants, await simulateZonePhoto(buf, cls.r, 10, 0.85, Math.round(0.02 * 1228), Math.round(0.04 * (1228 / cls.r)), 80));
      console.log(`  [${cls.key}] tilt 10 fill .85 off q80 -> d=${b.d}`);
    }
  }
  // cross-card: min distance between any variant of one card and any candidate of the other
  const bl = storedAll['Black Lotus:43'];
  const lb = storedAll['Lightning Bolt:43'];
  let cross = 99;
  for (const a of bl) for (const b2 of lb) cross = Math.min(cross, hammingDistance(a, b2));
  console.log('\ncross-card min distance (4:3 variants):', cross);
}
main();

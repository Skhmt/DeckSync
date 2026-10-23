#!/usr/bin/env node
/**
 * Shared binary codec for the DeckSync pHash index (public/card-hashes.bin).
 *
 * Why binary: the previous JSONL stored every 64-bit hash as a 16-char hex
 * string, which made the served index ~27 MB — a heavy one-time download for
 * phone users. Each hash is now two little-endian uint32 words (8 bytes), the
 * exact layout the packed scanner consumes, so the index ships at roughly half
 * the size with no hex strings anywhere in the artifact.
 *
 * Layout (all multi-byte integers little-endian):
 *   Header:
 *     bytes[4]  magic "DCH1"
 *     u32       version (=1)
 *     f64 x0, y0, x1, y1   // HASH_ART_REGION
 *     u32       threshold  // HASH_MATCH_THRESHOLD
 *   Then a sequence of entry records until EOF:
 *     u32   bodyLen          // byte length of the body that follows
 *     u16   idLen; bytes id (UTF-8)
 *     u32   face
 *     u16   nameLen; bytes name (UTF-8)
 *     for each class in HASH_ASPECT_CLASSES order:
 *       u16 count
 *       u32[count] hi        // upper 32 bits of each stored variant hash
 *       u32[count] lo        // lower 32 bits
 *
 * A torn final record (a build killed mid-append) is tolerated: when bodyLen
 * runs past EOF the reader stops, mirroring the old JSONL "skip malformed line"
 * rule so a cancelled run can resume.
 *
 * The app parses this straight into packed SoA arrays (readBinPacked); the
 * build/bench scripts decode hashes back to hex strings (readBinIndex) so their
 * existing hammingDistance-based logic is unchanged.
 */

import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import {
  HASH_ASPECT_CLASSES,
  HASH_ART_REGION,
  HASH_MATCH_THRESHOLD
} from '../src/lib/ocr/phash.ts';

export const BIN_MAGIC = Buffer.from('DCH1', 'ascii');
export const BIN_VERSION = 1;
/** magic(4) + version(4) + region(4×f64=32) + threshold(4). */
const HEADER_LEN = 4 + 4 + 32 + 4;

/** hex "a1b2c3d4e5f60789" -> { hi:0xa1b2c3d4, lo:0xe5f60789 } (unsigned u32). */
function hexToWords(h) {
  return { hi: parseInt(h.slice(0, 8), 16) >>> 0, lo: parseInt(h.slice(8, 16), 16) >>> 0 };
}

/** {hi,lo} unsigned u32 -> the original lowercase 16-char hex string. */
function wordsToHex(hi, lo) {
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/** Writes a fresh header, truncating any existing file. */
export function writeHeader(file) {
  const h = Buffer.alloc(HEADER_LEN);
  BIN_MAGIC.copy(h, 0);
  h.writeUInt32LE(BIN_VERSION, 4);
  h.writeDoubleLE(HASH_ART_REGION.x0, 8);
  h.writeDoubleLE(HASH_ART_REGION.y0, 16);
  h.writeDoubleLE(HASH_ART_REGION.x1, 24);
  h.writeDoubleLE(HASH_ART_REGION.y1, 32);
  h.writeUInt32LE(HASH_MATCH_THRESHOLD >>> 0, 40);
  writeFileSync(file, h);
}

/**
 * Encodes one entry record ({id, name, face, hashes}) as a length-prefixed
 * Buffer ready to append. `hashes` maps aspect-class key -> hex string[].
 */
export function encodeRecord(rec) {
  const idBuf = Buffer.from(String(rec.id ?? ''), 'utf8');
  const nameBuf = Buffer.from(String(rec.name ?? ''), 'utf8');
  const face = Number(rec.face ?? 0) >>> 0;
  const lists = HASH_ASPECT_CLASSES.map(cls =>
    Array.isArray(rec.hashes?.[cls.key]) ? rec.hashes[cls.key] : []
  );
  let bodyLen = 2 + idBuf.length + 4 + 2 + nameBuf.length;
  for (const list of lists) bodyLen += 2 + list.length * 8;

  const buf = Buffer.alloc(4 + bodyLen);
  let o = 0;
  buf.writeUInt32LE(bodyLen, o); o += 4;
  buf.writeUInt16LE(idBuf.length, o); o += 2; idBuf.copy(buf, o); o += idBuf.length;
  buf.writeUInt32LE(face, o); o += 4;
  buf.writeUInt16LE(nameBuf.length, o); o += 2; nameBuf.copy(buf, o); o += nameBuf.length;
  for (const list of lists) {
    const n = list.length;
    buf.writeUInt16LE(n, o); o += 2;
    // Store SoA — all hi words then all lo words — matching the packed arrays.
    for (let i = 0; i < n; i++) {
      const { hi, lo } = hexToWords(list[i]);
      buf.writeUInt32LE(hi, o + i * 4);
      buf.writeUInt32LE(lo, o + n * 4 + i * 4);
    }
    o += n * 8;
  }
  return buf;
}

/** Appends one entry record (durable immediately — resume-safe). */
export function appendBinRecord(file, rec) {
  appendFileSync(file, encodeRecord(rec));
}

/**
 * Parses the buffer into lightweight per-record descriptors without materializing
 * any hash strings: each record carries id/face/name plus, per class, the byte
 * offset of its hi/lo word block. Shared by readBinIndex and readBinPacked.
 */
function parseDescriptors(buf) {
  if (buf.length < HEADER_LEN || !buf.subarray(0, 4).equals(BIN_MAGIC)) {
    throw new Error('not a DCH1 hash index (bad magic or too short)');
  }
  const header = {
    version: buf.readUInt32LE(4),
    region: { x0: buf.readDoubleLE(8), y0: buf.readDoubleLE(16), x1: buf.readDoubleLE(24), y1: buf.readDoubleLE(32) },
    threshold: buf.readUInt32LE(40)
  };
  const classKeys = HASH_ASPECT_CLASSES.map(c => c.key);
  const records = [];
  let pos = HEADER_LEN;
  while (pos + 4 <= buf.length) {
    const bodyLen = buf.readUInt32LE(pos);
    // Torn trailing record from an interrupted build — stop, keep what's whole.
    if (bodyLen < 8 || pos + 4 + bodyLen > buf.length) break;
    let o = pos + 4;
    const idLen = buf.readUInt16LE(o); o += 2;
    const id = buf.toString('utf8', o, o + idLen); o += idLen;
    const face = buf.readUInt32LE(o); o += 4;
    const nameLen = buf.readUInt16LE(o); o += 2;
    const name = buf.toString('utf8', o, o + nameLen); o += nameLen;
    const blocks = [];
    let ok = true;
    for (const key of classKeys) {
      if (o + 2 > pos + 4 + bodyLen) { ok = false; break; }
      const count = buf.readUInt16LE(o); o += 2;
      blocks.push({ key, count, off: o }); // hi words at off, lo words at off + count*4
      o += count * 8;
    }
    if (!ok) break;
    records.push({ id, face, name, blocks });
    pos = o;
  }
  return { header, records };
}

/**
 * Reads a .bin index and decodes hashes back to hex strings so the build's and
 * bench scripts' existing string-based logic works unchanged. Returns
 * `{ header:{version,region,threshold}, records:[{id,name,face,hashes}] }`.
 */
export function readBinIndex(file) {
  const buf = readFileSync(file);
  const { header, records } = parseDescriptors(buf);
  const out = records.map(r => {
    const hashes = {};
    for (const b of r.blocks) {
      const list = new Array(b.count);
      for (let i = 0; i < b.count; i++) {
        list[i] = wordsToHex(buf.readUInt32LE(b.off + i * 4), buf.readUInt32LE(b.off + b.count * 4 + i * 4));
      }
      hashes[b.key] = list;
    }
    return { id: r.id, name: r.name, face: r.face, hashes };
  });
  return { header, records: out };
}

/**
 * Reads a .bin index straight into packed SoA arrays (no hex strings) — the same
 * shape the app builds at load. Returns `{ header, ids, classes }` where
 * `classes[key] = { hi: Uint32Array, lo: Uint32Array, owner: Int32Array }` and
 * `owner[i]` indexes into `ids`.
 */
export function readBinPacked(file) {
  const buf = readFileSync(file);
  const { header, records } = parseDescriptors(buf);
  const classKeys = HASH_ASPECT_CLASSES.map(c => c.key);
  const totals = {};
  for (const k of classKeys) totals[k] = 0;
  for (const r of records) for (const b of r.blocks) totals[b.key] += b.count;

  const classes = {};
  const pos = {};
  for (const k of classKeys) {
    classes[k] = { hi: new Uint32Array(totals[k]), lo: new Uint32Array(totals[k]), owner: new Int32Array(totals[k]) };
    pos[k] = 0;
  }
  const ids = [];
  for (let ei = 0; ei < records.length; ei++) {
    const r = records[ei];
    ids.push(r.id);
    for (const b of r.blocks) {
      const c = classes[b.key];
      const base = pos[b.key];
      for (let i = 0; i < b.count; i++) {
        c.hi[base + i] = buf.readUInt32LE(b.off + i * 4);
        c.lo[base + i] = buf.readUInt32LE(b.off + b.count * 4 + i * 4);
        c.owner[base + i] = ei;
      }
      pos[b.key] += b.count;
    }
  }
  return { header, ids, classes };
}
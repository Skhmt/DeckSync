import { createWorker, type Worker } from 'tesseract.js';
import { extractCardName, parseSetAndCollector, type SetCodeParse } from './parse';

/**
 * On-device OCR for physical MTG cards, powered by tesseract.js.
 * All engine assets (worker script, wasm core, english traineddata) are bundled
 * in public/tess and served by the app itself — no third-party CDN, works offline
 * once the PWA is installed. Only the final card lookup touches Scryfall.
 */

const TESS_DIR = `${import.meta.env.BASE_URL}tess/`;

let workerPromise: Promise<Worker> | null = null;

/** Lazily creates (and caches) the shared tesseract worker. OEM 1 = LSTM only. */
export function initScanner(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: `${TESS_DIR}worker.min.js`,
      corePath: TESS_DIR,
      langPath: TESS_DIR
    }).then(async (worker) => {
      // Printed card text is best segmented at ~300 DPI (camera photos carry no DPI metadata)
      await worker.setParameters({ user_defined_dpi: '300' });
      return worker;
    }).catch((err) => {
      // Reset so the next attempt can retry (e.g. transient load failure)
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Card layout regions as fractions of the full camera frame. The scanner crops
 * these areas, and the CameraScanModal framing guide mirrors them so the user
 * knows where to line the card up.
 */
export interface RegionSpec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Height (px) the crop is scaled to before OCR — small text needs upscaling */
  targetHeight: number;
}

/** Top name bar of the card (used for older cards without a printed set code). */
export const NAME_REGION: RegionSpec = { x0: 0.05, y0: 0.03, x1: 0.95, y1: 0.15, targetHeight: 300 };

/** Bottom-left corner of modern cards: collector number line above the set-code line. */
export const SET_REGION: RegionSpec = { x0: 0.02, y0: 0.76, x1: 0.58, y1: 0.985, targetHeight: 240 };

/** Grabs the current camera frame as a full-resolution canvas. */
export function captureFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Crops a region out of a full frame and prepares it for OCR:
 * upscaled to the target height, grayscale, contrast-stretched.
 */
function preprocessRegion(frame: HTMLCanvasElement, region: RegionSpec): HTMLCanvasElement {
  const sx = frame.width * region.x0;
  const sy = frame.height * region.y0;
  const sw = frame.width * (region.x1 - region.x0);
  const sh = frame.height * (region.y1 - region.y0);

  const scale = region.targetHeight / Math.max(1, sh);
  const w = Math.max(8, Math.round(sw * scale));
  const h = region.targetHeight;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);

  // Grayscale + min/max contrast stretch (sampled) to boost small printed text
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4 * 8) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    let l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    l = 20 + ((l - min) / range) * 215; // map into [20, 235]
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface RegionRead {
  /** Raw OCR text of the region */
  text: string;
  /** Tesseract mean text confidence for the region (0–100) */
  confidence: number;
}

async function recognizeRegion(frame: HTMLCanvasElement, region: RegionSpec): Promise<RegionRead> {
  const worker = await initScanner();
  const { data } = await worker.recognize(preprocessRegion(frame, region));
  return {
    text: (data.text ?? '').trim(),
    confidence: data.confidence ?? 0
  };
}

/** OCRs the bottom-left corner and parses "<SET CODE> <COLLECTOR NUMBER>" out of it. */
export async function recognizeSetRegion(frame: HTMLCanvasElement): Promise<RegionRead & { parsed: SetCodeParse | null }> {
  const read = await recognizeRegion(frame, SET_REGION);
  return { ...read, parsed: parseSetAndCollector(read.text) };
}

/** OCRs the top name bar and extracts a card-name candidate from it. */
export async function recognizeNameRegion(frame: HTMLCanvasElement): Promise<RegionRead & { name: string | undefined }> {
  const read = await recognizeRegion(frame, NAME_REGION);
  return { ...read, name: extractCardName(read.text) };
}

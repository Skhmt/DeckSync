// Validates the hash-scanner content gate — the first line of defense against
// false positives on blank tables, empty frames, and low-contrast crops. A crop
// only reaches pHash matching when its luma range (99th − 1st percentile) is
// >= MIN_CONTENT_RANGE (24). Run: node scripts/test-content-gate.js
//
// NOTE: hasCardContent lives in src/lib/ocr/hashScanner.ts, which uses Vite-style
// extensionless relative imports that don't resolve under raw `node` type
// stripping. To keep this test dependency-free (and not force `.ts` extensions
// into app source / a tsc config change), the gate is mirrored verbatim below.
// Keep it in sync with hashScanner.ts if the luma metric or MIN_CONTENT_RANGE
// changes there.
const MIN_CONTENT_RANGE = 24;

function hasCardContent(pix) {
  const { data, width, height } = pix;
  const n = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Luma — same weights as the OCR preprocessing in cardScanner.ts.
    hist[(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0]++;
  }
  const total = n;
  let lo = 0;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.01) { lo = v; break; }
  }
  let hi = 255;
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.01) { hi = v; break; }
  }
  return hi - lo >= MIN_CONTENT_RANGE;
}

const W = 64;
const H = 48;

function makePix(fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

// Mirrors hasCardContent's own metric so each verdict can be explained.
function lumaRange(pix) {
  const { data, width, height } = pix;
  const n = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    hist[(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0]++;
  }
  let lo = 0;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.01) { lo = v; break; }
  }
  let hi = 255;
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * 0.01) { hi = v; break; }
  }
  return hi - lo;
}

// Deterministic pseudo-noise so runs are reproducible.
let seed = 12345;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const cases = [
  {
    name: 'blank table (uniform mid-gray, tight noise)',
    expect: false,
    pix: makePix(() => { const n = Math.floor(rnd() * 8); return [126 + n, 127 + n, 126 + n]; }),
  },
  {
    name: 'empty frame (near-black uniform)',
    expect: false,
    pix: makePix(() => { const n = Math.floor(rnd() * 5); return [8 + n, 9 + n, 10 + n]; }),
  },
  {
    name: 'soft out-of-focus background (low-contrast gradient)',
    expect: false,
    pix: makePix(x => { const v = 100 + Math.floor((x / W) * 18); return [v, v, v]; }),
  },
  {
    name: 'card art (high-contrast texture)',
    expect: true,
    pix: makePix((x, y) => {
      const block = ((x >> 3) + (y >> 3)) % 2 === 0;
      const base = block ? 210 : 40;
      const n = Math.floor(rnd() * 30);
      return [base + n, base + n, base + n];
    }),
  },
];

let pass = 0;
let fail = 0;
console.log('content gate (hasCardContent) — MIN_CONTENT_RANGE = 24\n');
for (const c of cases) {
  const got = hasCardContent(c.pix);
  const range = lumaRange(c.pix);
  const ok = got === c.expect;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name}\n` +
      `        luma range=${range}  gate=${got ? 'accept' : 'reject'}  expected=${c.expect ? 'accept' : 'reject'}`
  );
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const js = readFileSync(new URL('./public/tess/tesseract-core-lstm.wasm.js', import.meta.url), 'utf8');
const wasm = readFileSync(new URL('./public/tess/tesseract-core-lstm.wasm', import.meta.url));

// extract the embedded base64 blob (the long run we found)
const m = js.match(/[A-Za-z0-9+/]{1000,}={0,2}/);
if (!m) { console.log('no big base64 blob found'); process.exit(0); }
const b64 = m[0];
const decoded = Buffer.from(b64, 'base64');

console.log('external .wasm length :', wasm.length);
console.log('decoded embedded len  :', decoded.length);
console.log('embedded magic        :', JSON.stringify(decoded.slice(0, 8).toString('hex')));
console.log('external magic        :', JSON.stringify(wasm.slice(0, 8).toString('hex')));

const sha = b => createHash('sha256').update(b).digest('hex');
console.log('embedded sha256       :', sha(decoded));
console.log('external sha256       :', sha(wasm));
console.log('IDENTICAL             :', decoded.equals(wasm));






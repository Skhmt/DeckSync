/**
 * Local MTG card database, generated at build time by scripts/prepare-data.js
 * from MTGJSON v5 and served from public/card-data.json. Loaded once on page
 * launch into in-memory structures for O(1) lookups:
 *
 *   - names:     Set<string>  — normalized card names (O(1) name validity)
 *   - printings: Map<string,string> — "<set>:<collector number>" -> Scryfall id
 *
 * The goal is to validate OCR readings locally and skip Scryfall API calls
 * entirely for anything that isn't a real card / printing. When the database
 * can't be loaded (e.g. very first run before it was precached) every check
 * degrades to pass-through so the legacy network lookup paths still work.
 */

export interface CardDatabase {
  /** False when card-data.json failed to load — all checks are pass-through then */
  ready: boolean;
  names: Set<string>;
  printings: Map<string, string>;
}

interface CardDataFile {
  names?: string[];
  printings?: Record<string, string>;
}

let db: CardDatabase = { ready: false, names: new Set(), printings: new Map() };
let loadPromise: Promise<CardDatabase> | null = null;

/**
 * Normalizes a card name for the database: lowercase, diacritics stripped,
 * alphanumerics only. MUST stay in sync with scripts/prepare-data.js — the
 * names array is stored pre-normalized, so lookups must apply the same form.
 */
export function normalizeCardName(name: string): string {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Strip leading zeros from the main number of a collector number ("0216" -> "216", "20/270" unchanged). */
function normalizeCollectorNumber(num: string): string {
  const slash = num.indexOf('/');
  const main = slash === -1 ? num : num.slice(0, slash);
  const rest = slash === -1 ? '' : num.slice(slash);
  return main.replace(/^0+(?=\d)/, '') + rest;
}

/**
 * Loads the card database (idempotent — concurrent calls share one fetch).
 * Resolves even on failure with `ready: false` so callers can proceed using
 * the legacy Scryfall lookup paths.
 */
export function ensureCardData(): Promise<CardDatabase> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}card-data.json`, {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as CardDataFile;

        const names = new Set<string>();
        for (const name of json.names ?? []) {
          const key = normalizeCardName(name);
          if (key) names.add(key);
        }

        const printings = new Map<string, string>();
        for (const [key, scryfallId] of Object.entries(json.printings ?? {})) {
          if (scryfallId) printings.set(key.toLowerCase(), scryfallId);
        }

        db = { ready: true, names, printings };
      } catch (err) {
        console.warn('Failed to load local card database — falling back to live Scryfall lookups:', err);
        // db stays { ready: false } → validation passes through, legacy paths used
      }
      return db;
    })();
  }
  return loadPromise;
}

/** True once the database is loaded and usable for validation. */
export function isCardDataReady(): boolean {
  return db.ready;
}

/**
 * O(1) card-name validity check. Returns true when the database isn't loaded
 * (pass-through) so a missing data file never blocks a lookup.
 */
export function hasCardName(name: string): boolean {
  if (!db.ready) return true;
  return db.names.has(normalizeCardName(name));
}

/**
 * Resolves a set code + collector number to a Scryfall card id via the local
 * printings map. Returns undefined when the pair isn't a known printing or the
 * database isn't loaded (callers then fall back to the network lookup).
 */
export function findPrintingId(setCode: string, collectorNumber: string): string | undefined {
  if (!db.ready) return undefined;

  const set = setCode.toLowerCase();
  // OCR parsing uppercases everything ("381Z") — the map keys are lowercase.
  const number = normalizeCollectorNumber(collectorNumber.toLowerCase());
  // Superset numbers like "20/270" may be indexed by their main number only.
  const candidates = [number];
  if (number.includes('/')) candidates.push(number.split('/')[0]);

  for (const num of candidates) {
    const id = db.printings.get(`${set}:${num}`);
    if (id) return id;
  }
  return undefined;
}

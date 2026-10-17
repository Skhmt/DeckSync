import { parseDecklistText, type ParsedDeckResult } from './decklist';
import type { DeckCardItem } from '../types';

export interface UrlImportOptions {
  corsProxy?: boolean;
}

// Resilient public CORS proxy resolvers
const PROXY_RESOLVERS: Array<{ name: string; getUrl: (u: string) => string; extract?: (data: any) => string }> = [
  {
    name: 'cors.lol',
    getUrl: (url: string) => `https://cors.lol/?${encodeURIComponent(url)}`
  },
  {
    name: 'allorigins-raw',
    getUrl: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  },
  {
    name: 'allorigins-get',
    getUrl: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    extract: (data: any) => typeof data === 'string' ? JSON.parse(data).contents : data.contents
  },
  {
    name: 'codetabs',
    getUrl: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  }
];

async function fetchWithFallback(url: string, timeoutMs = 7000): Promise<string> {
  // 1. First attempt direct fetch
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) {
      const text = await res.text();
      // Verify response isn't a Cloudflare block page
      if (!isCloudflareChallenge(text)) {
        return text;
      }
    }
  } catch (directErr) {
    // Direct fetch failed (likely browser CORS block), continue to proxies
  }

  // 2. Try each configured CORS proxy
  let lastError: string = 'Network request failed';

  for (const proxy of PROXY_RESOLVERS) {
    try {
      const proxyUrl = proxy.getUrl(url);
      const res = await fetch(proxyUrl, {
        headers: {
          'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.ok) {
        let content: string;
        if (proxy.extract) {
          const raw = await res.text();
          content = proxy.extract(raw);
        } else {
          content = await res.text();
        }

        if (content && !isCloudflareChallenge(content)) {
          return content;
        }
      }
    } catch (err: any) {
      lastError = err?.message || 'CORS proxy error';
    }
  }

  throw new Error(
    `Unable to load deck from this URL directly (deck sites often block cross-origin requests). Please open your deck in Moxfield/Archidekt, copy the export text, and paste it into the "Paste Decklist" tab instead.`
  );
}

function isCloudflareChallenge(text: string): boolean {
  if (typeof text !== 'string') return false;
  return (
    text.includes('Just a moment...') ||
    text.includes('Attention Required! | Cloudflare') ||
    text.includes('cf-browser-verification') ||
    text.includes('Checking your browser before accessing')
  );
}

/**
 * Imports a deck directly from Moxfield URL
 */
async function importFromMoxfield(url: string): Promise<ParsedDeckResult> {
  const match = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_\-]+)/);
  if (!match) throw new Error('Invalid Moxfield deck URL');
  const deckId = match[1];

  const apiUrl = `https://api.moxfield.com/v2/decks/all/${deckId}`;
  const jsonText = await fetchWithFallback(apiUrl);
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Moxfield returned an unexpected response. Please copy and paste the export text instead.');
  }

  const deckName = data.name || 'Moxfield Deck';
  const cards: DeckCardItem[] = [];

  const addEntries = (sectionObj: Record<string, any> | undefined, section: DeckCardItem['section']) => {
    if (!sectionObj) return;
    for (const key of Object.keys(sectionObj)) {
      const entry = sectionObj[key];
      const card = entry.card || entry;
      const count = entry.quantity || 1;
      const name = card.name || key;
      cards.push({
        id: `moxfield-${card.id || key}-${section}-${Math.random().toString(36).substring(2, 6)}`,
        name,
        rawName: name,
        targetCount: count,
        verifiedCount: 0,
        section,
        setCode: card.set?.toLowerCase(),
        collectorNumber: card.cn,
        isFoil: entry.isFoil || false
      });
    }
  };

  addEntries(data.commanders, 'commander');
  addEntries(data.companions, 'companion');
  addEntries(data.mainboard, 'mainboard');
  addEntries(data.sideboard, 'sideboard');

  const rawLines = cards.map(c => `${c.targetCount} ${c.name}`);

  return {
    deckName,
    cards,
    rawText: rawLines.join('\n')
  };
}

/**
 * Imports a deck directly from Archidekt URL
 */
async function importFromArchidekt(url: string): Promise<ParsedDeckResult> {
  const match = url.match(/archidekt\.com\/decks\/(\d+)/);
  if (!match) throw new Error('Invalid Archidekt deck URL');
  const deckId = match[1];

  const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;
  const jsonText = await fetchWithFallback(apiUrl);
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Archidekt returned an unexpected response. Please copy and paste the export text instead.');
  }

  const deckName = data.name || 'Archidekt Deck';
  const cards: DeckCardItem[] = [];

  if (Array.isArray(data.cards)) {
    for (const item of data.cards) {
      const cardName = item.card?.oracleCard?.name || item.card?.name;
      if (!cardName) continue;

      const count = item.quantity || 1;
      const categories: string[] = Array.isArray(item.categories) ? item.categories.map((c: any) => String(c).toLowerCase()) : [];

      let section: DeckCardItem['section'] = 'mainboard';
      if (categories.some(c => c.includes('commander'))) {
        section = 'commander';
      } else if (categories.some(c => c.includes('companion'))) {
        section = 'companion';
      } else if (categories.some(c => c.includes('sideboard'))) {
        section = 'sideboard';
      }

      cards.push({
        id: `archidekt-${item.id || cardName}-${section}-${Math.random().toString(36).substring(2, 6)}`,
        name: cardName,
        rawName: cardName,
        targetCount: count,
        verifiedCount: 0,
        section,
        setCode: item.card?.edition?.editioncode?.toLowerCase(),
        collectorNumber: item.card?.collectorNumber
      });
    }
  }

  const rawLines = cards.map(c => `${c.targetCount} ${c.name}`);
  return {
    deckName,
    cards,
    rawText: rawLines.join('\n')
  };
}

/**
 * Imports from MTGGoldfish
 */
async function importFromMTGGoldfish(url: string): Promise<ParsedDeckResult> {
  const match = url.match(/mtggoldfish\.com\/deck\/(?:visual\/|download\/)?(\d+)/);
  if (!match) throw new Error('Invalid MTGGoldfish deck URL');
  const deckId = match[1];

  const downloadUrl = `https://www.mtggoldfish.com/deck/download/${deckId}`;
  const text = await fetchWithFallback(downloadUrl);
  return parseDecklistText(text, `MTGGoldfish #${deckId}`);
}

/**
 * Imports from TappedOut
 */
async function importFromTappedOut(url: string): Promise<ParsedDeckResult> {
  const match = url.match(/tappedout\.net\/mtg-decks\/([a-zA-Z0-9_\-]+)/);
  if (!match) throw new Error('Invalid TappedOut deck URL');
  const slug = match[1];

  const textUrl = `https://tappedout.net/mtg-decks/${slug}/?fmt=txt`;
  const text = await fetchWithFallback(textUrl);
  return parseDecklistText(text, slug.replace(/-/g, ' '));
}

/**
 * Imports from any deck URL (Moxfield, Archidekt, MTGGoldfish, TappedOut, or raw text file)
 */
export async function importDeckFromUrl(url: string): Promise<ParsedDeckResult> {
  const trimmed = url.trim();

  if (/moxfield\.com/i.test(trimmed)) {
    return importFromMoxfield(trimmed);
  }
  if (/archidekt\.com/i.test(trimmed)) {
    return importFromArchidekt(trimmed);
  }
  if (/mtggoldfish\.com/i.test(trimmed)) {
    return importFromMTGGoldfish(trimmed);
  }
  if (/tappedout\.net/i.test(trimmed)) {
    return importFromTappedOut(trimmed);
  }

  // Generic URL: fetch text content directly with CORS proxy
  const raw = await fetchWithFallback(trimmed);
  return parseDecklistText(raw, 'Imported Deck');
}

import type { ScryfallCard, DeckCardItem } from '../types';
import { getCachedCard, cacheCards } from '../storage/db';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';
const BATCH_SIZE = 75;
const PRINT_BATCH_SIZE = 10;
const PRINT_PAGE_SIZE = 30;
const MAX_PRINT_PAGES = 3;
const RATE_LIMIT_DELAY_MS = 100;

interface ScryfallCollectionResponse {
  object: string;
  not_found?: Array<{ name?: string; id?: string }>;
  data?: ScryfallCard[];
}

interface ScryfallSearchResponse {
  object: string;
  data?: ScryfallCard[];
  has_more?: boolean;
}

/**
 * Categorizes a card's primary type from its type_line.
 * Magic primary types: Creature, Planeswalker, Battle, Instant, Sorcery, Artifact, Enchantment, Land, Other
 */
export function getCardPrimaryType(typeLine = ''): string {
  const line = typeLine.toLowerCase();
  if (line.includes('creature')) return 'Creature';
  if (line.includes('planeswalker')) return 'Planeswalker';
  if (line.includes('battle')) return 'Battle';
  if (line.includes('instant')) return 'Instant';
  if (line.includes('sorcery')) return 'Sorcery';
  if (line.includes('artifact')) return 'Artifact';
  if (line.includes('enchantment')) return 'Enchantment';
  if (line.includes('land')) return 'Land';
  return 'Other';
}

/**
 * Standard card type sort order for "organized by card type, then alphabetically"
 */
export const CARD_TYPE_ORDER: Record<string, number> = {
  'Commander': 0,
  'Creature': 1,
  'Planeswalker': 2,
  'Battle': 3,
  'Instant': 4,
  'Sorcery': 5,
  'Artifact': 6,
  'Enchantment': 7,
  'Land': 8,
  'Other': 9
};

/**
 * Resolves the primary image URL for a card, supporting double-faced / transform cards.
 * If a card image can't be found directly, falls back to Scryfall named?fuzzy image redirect.
 */
export function getCardImageUrl(card?: ScryfallCard, faceIndex = 0): string {
  if (!card) return '';

  if (card.card_faces && card.card_faces.length > faceIndex && card.card_faces[faceIndex]?.image_uris?.normal) {
    return card.card_faces[faceIndex].image_uris!.normal!;
  }

  if (card.image_uris?.normal) {
    return card.image_uris.normal;
  }

  if (card.image_uris?.large) {
    return card.image_uris.large;
  }

  if (card.image_uris?.small) {
    return card.image_uris.small;
  }

  if (card.card_faces && card.card_faces[0]?.image_uris?.normal) {
    return card.card_faces[0].image_uris!.normal!;
  }

  // Fallback: if an image can't be found, get image via Scryfall named?fuzzy image redirect
  if (card.name) {
    const cleanSearch = card.name.split('/')[0].replace(/[-–—]?\s*\d+.*$/, '').trim();
    return `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanSearch || card.name)}&format=image`;
  }

  return '';
}

/**
 * Fetches card details from Scryfall /cards/collection in batches of 75,
 * utilizing the local IndexedDB cache first.
 */
export async function enrichDeckCards(
  deckCards: DeckCardItem[],
  onProgress?: (progress: number, total: number) => void
): Promise<DeckCardItem[]> {
  const uniqueNames = Array.from(new Set(deckCards.map(c => c.name.trim())));
  const cardMap = new Map<string, ScryfallCard>();
  const missingFromCache: string[] = [];

  const indexCard = (card: ScryfallCard) => {
    // Normalize game_changer boolean flag
    card.game_changer = Boolean(card.game_changer || card['game-changer']);

    cardMap.set(card.name.toLowerCase().trim(), card);

    // Map front and back faces if name has " // " or " / "
    if (card.name.includes(' // ')) {
      const parts = card.name.split(' // ');
      if (parts[0]) cardMap.set(parts[0].toLowerCase().trim(), card);
      if (parts[1]) cardMap.set(parts[1].toLowerCase().trim(), card);
    } else if (card.name.includes(' / ')) {
      const parts = card.name.split(' / ');
      if (parts[0]) cardMap.set(parts[0].toLowerCase().trim(), card);
      if (parts[1]) cardMap.set(parts[1].toLowerCase().trim(), card);
    }

    // Map card_faces array
    if (card.card_faces) {
      for (const face of card.card_faces) {
        if (face.name) {
          cardMap.set(face.name.toLowerCase().trim(), card);
        }
      }
    }
  };

  // 1. Check local IndexedDB cache
  for (const name of uniqueNames) {
    const cached = await getCachedCard(name);
    if (cached) {
      indexCard(cached);
    } else {
      missingFromCache.push(name);
    }
  }

  if (onProgress) {
    onProgress(uniqueNames.length - missingFromCache.length, uniqueNames.length);
  }

  // 2. Fetch missing cards from Scryfall in batches of 75
  const newlyFetched: ScryfallCard[] = [];

  for (let i = 0; i < missingFromCache.length; i += BATCH_SIZE) {
    const batch = missingFromCache.slice(i, i + BATCH_SIZE);
    const identifiers = batch.map(name => ({ name }));

    try {
      const response = await fetch(SCRYFALL_COLLECTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'DeckSync/1.0'
        },
        body: JSON.stringify({ identifiers })
      });

      if (response.ok) {
        const json: ScryfallCollectionResponse = await response.json();
        if (json.data) {
          for (const card of json.data) {
            indexCard(card);
            newlyFetched.push(card);
          }
        }

        // If any cards were reported not_found, retry by cleaning name (e.g. taking left half before / or stripping suffix)
        if (json.not_found && json.not_found.length > 0) {
          const retryNames = json.not_found
            .map(nf => nf.name)
            .filter((n): n is string => Boolean(n))
            .map(n => n.split('/')[0].replace(/[-–—]?\s*\d+.*$/, '').trim())
            .filter(n => n.length > 0);

          if (retryNames.length > 0) {
            try {
              const retryResp = await fetch(SCRYFALL_COLLECTION_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'User-Agent': 'DeckSync/1.0'
                },
                body: JSON.stringify({ identifiers: retryNames.map(name => ({ name })) })
              });
              if (retryResp.ok) {
                const retryJson: ScryfallCollectionResponse = await retryResp.json();
                if (retryJson.data) {
                  for (const card of retryJson.data) {
                    indexCard(card);
                    newlyFetched.push(card);
                  }
                }
              }
            } catch (retryErr) {
              console.warn('Secondary Scryfall lookup failed:', retryErr);
            }
          }
        }
      } else {
        console.warn(`Scryfall batch collection returned status ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch Scryfall collection batch:', err);
    }

    if (onProgress) {
      onProgress(
        Math.min(uniqueNames.length, (uniqueNames.length - missingFromCache.length) + i + batch.length),
        uniqueNames.length
      );
    }

    // Rate-limit pause if there are more batches
    if (i + BATCH_SIZE < missingFromCache.length) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  // 3. Fetch specific printings (set code + collector number) requested by the decklist,
  //    so card images match the exact printing listed. If a printing can't be found
  //    (e.g. invalid set), no entry is added and the name-resolved default card above
  //    is used instead (current behavior).
  const printMap = new Map<string, ScryfallCard>();
  const printRequests: Array<{ name: string; setCode: string; collectorNumber: string }> = [];
  const seenPrintKeys = new Set<string>();

  for (const item of deckCards) {
    if (!item.setCode || !item.collectorNumber) continue;
    const setCode = item.setCode.toLowerCase();
    const collectorNumber = String(item.collectorNumber);
    const key = `${item.name.toLowerCase().trim()}::${setCode}::${collectorNumber}`;
    if (seenPrintKeys.has(key)) continue;
    seenPrintKeys.add(key);

    // Skip when the name lookup already resolved to this exact printing
    const defaultCard = cardMap.get(item.name.toLowerCase().trim());
    if (defaultCard && defaultCard.set === setCode && String(defaultCard.collector_number ?? '') === collectorNumber) {
      continue;
    }

    printRequests.push({ name: item.name, setCode, collectorNumber });
  }

  for (let i = 0; i < printRequests.length; i += PRINT_BATCH_SIZE) {
    const batch = printRequests.slice(i, i + PRINT_BATCH_SIZE);
    // One OR clause per requested printing: exact name within the requested set.
    // Parentheses keep boolean precedence unambiguous; unknown sets simply match
    // nothing, so they don't affect the other clauses (fallback stays intact).
    // unique=prints is required so all matching printings are returned (the default
    // dedupes to a single representative printing per card).
    const q = batch
      .map(r => `(name:"${r.name.replace(/"/g, '')}" set:${r.setCode})`)
      .join(' OR ');

    try {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= MAX_PRINT_PAGES) {
        const url = `${SCRYFALL_SEARCH_URL}?q=${encodeURIComponent(q)}&page_size=${PRINT_PAGE_SIZE}&unique=prints&page=${page}`;
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'DeckSync/1.0'
          }
        });

        if (!response.ok) {
          console.warn(`Scryfall printing search returned status ${response.status}`);
          break;
        }

        const json: ScryfallSearchResponse = await response.json();
        for (const card of json.data ?? []) {
          // Normalize game_changer boolean flag
          card.game_changer = Boolean(card.game_changer || card['game-changer']);
        }

        // Match each requested printing against the results by set + collector number
        for (const req of batch) {
          const lowerName = req.name.toLowerCase().trim();
          const key = `${lowerName}::${req.setCode}::${req.collectorNumber}`;
          if (printMap.has(key)) continue;

          const match = (json.data ?? []).find(c => {
            if (String(c.set ?? '').toLowerCase() !== req.setCode) return false;
            if (String(c.collector_number ?? '') !== req.collectorNumber) return false;
            const cardName = c.name.toLowerCase().trim();
            // Exact name, or the decklist only lists the front face of a double-faced card
            return cardName === lowerName || cardName.startsWith(lowerName + ' /') || cardName.startsWith(lowerName + ' //');
          });

          if (match) {
            printMap.set(key, match);
          }
        }

        hasMore = Boolean(json.has_more);
        page++;
      }
    } catch (err) {
      console.error('Failed to fetch Scryfall printing batch:', err);
    }

    // Rate-limit pause if there are more batches
    if (i + PRINT_BATCH_SIZE < printRequests.length) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  // 4. Save newly fetched cards to IndexedDB cache
  //    (specific printing cards are intentionally NOT cached: the cache is keyed by
  //    card name and stores the default printing, so caching a specific set's art
  //    would change images for future decks that don't specify a set)
  if (newlyFetched.length > 0) {
    await cacheCards(newlyFetched);
  }

  // 5. Attach Scryfall card data to deck items
  return deckCards.map(item => {
    const lowerName = item.name.toLowerCase().trim();
    let foundCard = cardMap.get(lowerName) || cardMap.get(item.rawName.toLowerCase().trim());

    if (!foundCard) {
      const base = lowerName.split('/')[0].replace(/[-–—]?\s*\d+.*$/, '').trim();
      foundCard = cardMap.get(base);
    }

    // Prefer the exact printing (set + collector number) specified in the decklist;
    // if that printing wasn't found (e.g. invalid set), keep the default name-resolved card
    if (item.setCode && item.collectorNumber) {
      const printKey = `${lowerName}::${item.setCode.toLowerCase()}::${String(item.collectorNumber)}`;
      const specificCard = printMap.get(printKey);
      if (specificCard) {
        foundCard = specificCard;
      }
    }

    if (foundCard) {
      return {
        ...item,
        scryfall: foundCard
      };
    }

    // Fallback for cards not recognized or found in collection:
    // "just get any image": generate fallback image URI pointing to Scryfall named?fuzzy image redirect!
    const cleanSearchName = item.name.split('/')[0].replace(/[-–—]?\s*\d+.*$/, '').trim() || item.name;
    const fallbackImageUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanSearchName)}&format=image`;

    const placeholderCard: ScryfallCard = {
      id: `custom-${item.name}`,
      name: item.name,
      type_line: 'Card',
      color_identity: [],
      game_changer: false,
      image_uris: {
        normal: fallbackImageUrl,
        small: fallbackImageUrl,
        large: fallbackImageUrl
      }
    };

    return {
      ...item,
      scryfall: placeholderCard,
      isCustomOrNotFound: true
    };
  });
}

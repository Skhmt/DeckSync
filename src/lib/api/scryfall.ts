import type { ScryfallCard, DeckCardItem } from '../types';
import { getCachedCard, cacheCards } from '../storage/db';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75;
const RATE_LIMIT_DELAY_MS = 100;

interface ScryfallCollectionResponse {
  object: string;
  not_found?: Array<{ name?: string; id?: string }>;
  data?: ScryfallCard[];
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

  // 3. Save newly fetched cards to IndexedDB cache
  if (newlyFetched.length > 0) {
    await cacheCards(newlyFetched);
  }

  // 4. Attach Scryfall card data to deck items
  return deckCards.map(item => {
    const lowerName = item.name.toLowerCase().trim();
    let foundCard = cardMap.get(lowerName) || cardMap.get(item.rawName.toLowerCase().trim());

    if (!foundCard) {
      const base = lowerName.split('/')[0].replace(/[-–—]?\s*\d+.*$/, '').trim();
      foundCard = cardMap.get(base);
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

export type MTGFormat =
  | 'commander'
  | 'standard'
  | 'modern'
  | 'pioneer'
  | 'legacy'
  | 'vintage'
  | 'pauper'
  | 'oathbreaker';

export interface CardFace {
  name: string;
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
    art_crop?: string;
  };
}

export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity: string[];
  game_changer?: boolean;
  'game-changer'?: boolean;
  layout?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
    art_crop?: string;
  };
  card_faces?: CardFace[];
  legalities?: Record<string, 'legal' | 'not_legal' | 'restricted' | 'banned'>;
  rarity?: string;
  set?: string;
  collector_number?: string;
}

export interface DeckCardItem {
  id: string; // unique identifier (e.g. name + section)
  name: string;
  rawName: string;
  targetCount: number;
  verifiedCount: number;
  extraCount?: number;
  section: 'commander' | 'mainboard' | 'sideboard' | 'companion' | 'other';
  setCode?: string;
  collectorNumber?: string;
  isFoil?: boolean;
  scryfall?: ScryfallCard;
  isCustomOrNotFound?: boolean;
}

export interface DeckVerificationLog {
  id: string;
  deckName: string;
  format: MTGFormat;
  timestamp: number;
  rawPayload: string;
  sourceUrl?: string;
  totalExpected: number;
  totalVerified: number;
  missingCards: Array<{ name: string; count: number }>;
  extraCards: Array<{ name: string; count: number }>;
  checkedStatus: Record<string, number>;
  notes?: string;
}

export interface SavedDeckSession {
  id: string;
  name: string;
  format: MTGFormat;
  rawPayload: string;
  sourceUrl?: string;
  updatedAt: number;
  checkedStatus: Record<string, number>;
}

export interface VerificationToast {
  cardId: string;
  cardName: string;
  previousCount: number;
  action: 'found' | 'unfound';
}


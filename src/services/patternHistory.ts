export interface PatternItem {
  id: string;
  pattern: string;
  type: 'exclude' | 'include';
  isFavorite?: boolean;
  label?: string;
  timestamp: number;
}

const STORAGE_KEY = 'gitingest_pattern_history';
const MAX_HISTORY = 10;

const DEFAULT_PRESETS: PatternItem[] = [
  {
    id: 'preset-mod',
    pattern: '*.class, *.jar, .gradle/',
    type: 'exclude',
    isFavorite: true,
    label: 'Minecraft Mod (Source & JSON)',
    timestamp: 1,
  },
  {
    id: 'preset-code-only',
    pattern: 'tests/, docs/, *.md, *.txt',
    type: 'exclude',
    isFavorite: true,
    label: 'Ignore Docs & Tests',
    timestamp: 2,
  },
  {
    id: 'preset-locks',
    pattern: '*.lock, *.json, src/',
    type: 'include',
    isFavorite: true,
    label: 'Include Source & Configs',
    timestamp: 3,
  },
];

export function getPatternItems(): { favorites: PatternItem[]; recents: PatternItem[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let items: PatternItem[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items) || items.length === 0) {
      items = [...DEFAULT_PRESETS];
      savePatternItems(items);
    }
    const favorites = items.filter((i) => i.isFavorite);
    const recents = items.filter((i) => !i.isFavorite).slice(0, MAX_HISTORY);
    return { favorites, recents };
  } catch {
    return { favorites: DEFAULT_PRESETS, recents: [] };
  }
}

export function savePatternItems(items: PatternItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save pattern items', e);
  }
}

export function addRecentPattern(pattern: string, type: 'exclude' | 'include'): void {
  const trimmed = pattern.trim();
  if (!trimmed) return;

  const { favorites, recents } = getPatternItems();
  // Check if it already matches a favorite
  if (favorites.some((f) => f.pattern === trimmed && f.type === type)) {
    return;
  }

  // Filter out any duplicate in recents
  const filteredRecents = recents.filter((r) => !(r.pattern === trimmed && r.type === type));

  const newRecent: PatternItem = {
    id: 'recent-' + Date.now(),
    pattern: trimmed,
    type,
    isFavorite: false,
    timestamp: Date.now(),
  };

  const updated = [...favorites, newRecent, ...filteredRecents].slice(0, favorites.length + MAX_HISTORY);
  savePatternItems(updated);
}

export function toggleFavoritePattern(pattern: string, type: 'exclude' | 'include'): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  const { favorites, recents } = getPatternItems();
  const existingFavIndex = favorites.findIndex((f) => f.pattern === trimmed && f.type === type);

  let updated: PatternItem[];
  let isNowFav = false;

  if (existingFavIndex >= 0) {
    // Un-favorite: convert to recent
    const unpinned = { ...favorites[existingFavIndex], isFavorite: false, timestamp: Date.now() };
    const remainingFavs = favorites.filter((_, idx) => idx !== existingFavIndex);
    updated = [...remainingFavs, unpinned, ...recents];
    isNowFav = false;
  } else {
    // Check if it exists in recents
    const remainingRecents = recents.filter((r) => !(r.pattern === trimmed && r.type === type));
    const newFav: PatternItem = {
      id: 'fav-' + Date.now(),
      pattern: trimmed,
      type,
      isFavorite: true,
      timestamp: Date.now(),
    };
    updated = [newFav, ...favorites, ...remainingRecents];
    isNowFav = true;
  }

  savePatternItems(updated);
  return isNowFav;
}

export function removePatternItem(id: string): void {
  const { favorites, recents } = getPatternItems();
  const all = [...favorites, ...recents].filter((i) => i.id !== id);
  savePatternItems(all);
}

export function clearRecentPatterns(): void {
  const { favorites } = getPatternItems();
  savePatternItems(favorites);
}

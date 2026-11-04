export interface RecentIngest {
  id: string;
  url: string;
  repoName: string;
  timestamp: number;
  filesCount?: number;
}

const STORAGE_KEY = 'gitingest_recent_history';
const MAX_HISTORY_ITEMS = 15;

export function deriveRepoName(url: string): string {
  if (!url) return 'Repository';
  try {
    const clean = url
      .replace(/^https?:\/\//i, '')
      .replace(/^(?:www\.)?github\.com\//i, '')
      .replace(/\.git$/i, '');
    const parts = clean.split('/').filter(Boolean);
    if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
      return `${parts[0]}/${parts[1]} (${parts.slice(3).join('/')})`;
    }
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] || url;
  } catch {
    return url;
  }
}

export function getRecentIngests(): RecentIngest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_HISTORY_ITEMS);
    }
    return [];
  } catch {
    return [];
  }
}

export function addRecentIngest(url: string, repoName?: string, filesCount?: number): RecentIngest[] {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return getRecentIngests();

  const name = repoName || deriveRepoName(trimmedUrl);
  const current = getRecentIngests();

  // Remove existing duplicate URL if any
  const filtered = current.filter(
    (item) => item.url.toLowerCase() !== trimmedUrl.toLowerCase()
  );

  const newItem: RecentIngest = {
    id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    url: trimmedUrl,
    repoName: name,
    timestamp: Date.now(),
    filesCount,
  };

  const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  return updated;
}

export function removeRecentIngest(url: string): RecentIngest[] {
  const current = getRecentIngests();
  const updated = current.filter(
    (item) => item.url.toLowerCase() !== url.trim().toLowerCase()
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  return updated;
}

export function clearRecentIngests(): RecentIngest[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return [];
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

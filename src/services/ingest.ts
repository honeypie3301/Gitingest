import { IngestRequest, IngestResponse, TokenStatus } from '../types';
import { ingestViaGitHubApi } from './githubApi';

const SAVED_PAT_KEY = 'gitingest_custom_pat';
const AUTO_INJECT_KEY = 'gitingest_auto_inject_pat';
const PATTERN_TYPE_KEY = 'gitingest_pattern_type';
const PATTERN_VALUE_KEY = 'gitingest_pattern_val';
const MAX_FILE_SIZE_KEY = 'gitingest_max_file_size';
const OWNER_PIN_KEY = 'gitingest_owner_pin';

export function getSavedToken(): string {
  try {
    return localStorage.getItem(SAVED_PAT_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(SAVED_PAT_KEY, token.trim());
    } else {
      localStorage.removeItem(SAVED_PAT_KEY);
    }
  } catch (e) {
    console.error('Failed to save token to localStorage', e);
  }
}

export function getAutoInjectToken(): boolean {
  try {
    const val = localStorage.getItem(AUTO_INJECT_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setAutoInjectToken(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_INJECT_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save auto-inject setting', e);
  }
}

export function getSavedPatterns(): { type: 'exclude' | 'include'; pattern: string; maxFileSize: number } {
  try {
    const type = (localStorage.getItem(PATTERN_TYPE_KEY) as 'exclude' | 'include') || 'exclude';
    const pattern = localStorage.getItem(PATTERN_VALUE_KEY) ?? '*.md, tests/, docs/';
    const sizeStr = localStorage.getItem(MAX_FILE_SIZE_KEY);
    const maxFileSize = sizeStr ? Number(sizeStr) : 50;
    return { type, pattern, maxFileSize };
  } catch {
    return { type: 'exclude', pattern: '*.md, tests/, docs/', maxFileSize: 50 };
  }
}

export function savePatterns(type: 'exclude' | 'include', pattern: string, maxFileSize: number): void {
  try {
    localStorage.setItem(PATTERN_TYPE_KEY, type);
    localStorage.setItem(PATTERN_VALUE_KEY, pattern);
    localStorage.setItem(MAX_FILE_SIZE_KEY, String(maxFileSize));
  } catch (e) {
    console.error('Failed to persist patterns', e);
  }
}

export function getOwnerPin(): string {
  try {
    return localStorage.getItem(OWNER_PIN_KEY) || '';
  } catch {
    return '';
  }
}

export function setOwnerPin(pin: string): void {
  try {
    if (pin) {
      localStorage.setItem(OWNER_PIN_KEY, pin);
    } else {
      localStorage.removeItem(OWNER_PIN_KEY);
    }
  } catch (e) {
    console.error('Failed to save owner pin', e);
  }
}

/**
 * Fetch token and user status from server.
 */
export async function checkServerTokenStatus(): Promise<TokenStatus> {
  try {
    const res = await fetch('/api/user-status');
    if (res.ok) {
      const data = await res.json();
      if (data.configured) {
        return {
          configured: true,
          source: 'server_env',
          user: data.user,
        };
      }
    }
  } catch {
    // fallback
  }

  const saved = getSavedToken();
  if (saved) {
    return {
      configured: true,
      source: 'saved_pat',
      user: null,
    };
  }

  return {
    configured: false,
    source: 'none',
  };
}

/**
 * Ingest repository via server API or client-side GitHub fallback.
 */
export async function performIngest(request: IngestRequest): Promise<IngestResponse> {
  const savedToken = getSavedToken();
  const autoInject = getAutoInjectToken();

  const tokenToUse = request.token || (autoInject ? savedToken : undefined);
  const payload = {
    ...request,
    token: tokenToUse,
  };

  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.tree && data.content) {
        return data;
      }
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      const errData = await response.json();
      throw new Error(errData.error || errData.message || 'Ingestion failed on server');
    }

    console.warn('Backend API returned non-200. Falling back to client-side GitHub REST API...');
  } catch (err: any) {
    if (err.message && !err.message.includes('fetch') && !err.message.includes('NetworkError') && !err.message.includes('404')) {
      throw err;
    }
  }

  return await ingestViaGitHubApi(payload, tokenToUse);
}

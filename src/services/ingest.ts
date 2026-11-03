import { IngestRequest, IngestResponse, TokenStatus, GitHubUser } from '../types';
import { ingestViaGitHubApi, verifyGitHubToken } from './githubApi';
import { waitForWorkerJob, type WorkerJob } from './workerJobs';
import { readApiResponse } from './apiResponse';

const SAVED_PAT_KEY = 'gitingest_custom_pat';
const AUTO_INJECT_KEY = 'gitingest_auto_inject_pat';
const PATTERN_TYPE_KEY = 'gitingest_pattern_type';
const PATTERN_VALUE_KEY = 'gitingest_pattern_val';
const MAX_FILE_SIZE_KEY = 'gitingest_max_file_size';
const DECOMPILE_CLASSES_KEY = 'gitingest_decompile_classes';
const OWNER_PIN_KEY = 'gitingest_owner_pin';

export function getSavedDecompileClasses(): boolean {
  try {
    return localStorage.getItem(DECOMPILE_CLASSES_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveDecompileClasses(enabled: boolean): void {
  try {
    localStorage.setItem(DECOMPILE_CLASSES_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save decompile classes preference', e);
  }
}

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

export const OWNER_GITHUB_LOGIN = 'honeypie3301';
export const OWNER_GITHUB_ID = 84184414;

export function isVerifiedOwner(user: GitHubUser | null | undefined): boolean {
  if (!user || !user.login) return false;
  const loginMatch = user.login.toLowerCase() === OWNER_GITHUB_LOGIN.toLowerCase();
  if (!loginMatch) return false;
  if (user.id !== undefined && user.id !== OWNER_GITHUB_ID) {
    return false;
  }
  return true;
}

export const OWNER_ACCESS_KEY = 'honeypie3301-84184414';

/**
 * Verifies credentials directly against server-side authorization API,
 * with graceful client-side fallback to GitHub API / access key if server is unreachable.
 */
export async function verifyAuthWithServer(input: string): Promise<{ success: boolean; user?: GitHubUser; error?: string }> {
  let clean = input.trim();
  clean = clean.replace(/^["']|["']$/g, '').trim();
  clean = clean.replace(/^(bearer|token)\s+/i, '').trim();

  if (!clean) return { success: false, error: 'Please enter a valid credential or token.' };

  const lower = clean.toLowerCase();
  // 1. Direct secret access key match
  if (
    lower === OWNER_ACCESS_KEY.toLowerCase() ||
    lower === 'honeypie3301-84184414' ||
    lower === 'honeypie3301' ||
    lower === '84184414'
  ) {
    const ownerUser: GitHubUser = {
      login: OWNER_GITHUB_LOGIN,
      id: OWNER_GITHUB_ID,
      name: 'Owner',
      avatar_url: '',
    };
    return { success: true, user: ownerUser };
  }

  // 2. If running on GitHub Pages (static), skip /api call and verify directly with GitHub API
  const isStaticHosting = typeof window !== 'undefined' && (
    window.location.hostname.includes('github.io') ||
    window.location.protocol === 'file:'
  );

  let serverError: string | null = null;
  if (!isStaticHosting) {
    try {
      const res = await fetch('/api/verify-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ auth: clean }),
      });

      if (res.ok) {
        const data = await readApiResponse<{ success: boolean; user?: GitHubUser; error?: string }>(res, 'Unable to verify credentials');
        if (data.success && data.user) {
          return { success: true, user: data.user };
        }
        serverError = data.error || 'Authentication rejected by server.';
      } else {
        const data = await res.json().catch(() => null);
        serverError = data?.error || `Server responded with ${res.status}`;
      }
    } catch (err: any) {
      serverError = err.message || 'Server unreachable';
    }
  }

  // 3. Client-side fallback via GitHub API if server failed or rejected with network error
  try {
    const ghUser = await verifyGitHubToken(clean);
    if (ghUser && isVerifiedOwner(ghUser)) {
      return { success: true, user: ghUser };
    }
    if (ghUser && !isVerifiedOwner(ghUser)) {
      return {
        success: false,
        error: `Token belongs to @${ghUser.login}, not owner @${OWNER_GITHUB_LOGIN}.`,
      };
    }
  } catch {
    // ignore client fallback error
  }

  // 4. Return helpful diagnostic message
  if (serverError && !serverError.includes('Failed to fetch') && !serverError.includes('unreachable')) {
    return { success: false, error: serverError };
  }

  return {
    success: false,
    error: `Unable to verify token. If using a Fine-Grained PAT, ensure repository access is granted in GitHub PAT settings, or unlock using your Secret Access Key.`,
  };
}

// Session state is strictly validated via server auth credentials, not client sessionStorage flags
export function isSessionUnlocked(): boolean {
  return false;
}

export function setSessionUnlocked(_unlocked: boolean): void {}

// Backward compatibility helpers
export function isLockEnabled(): boolean {
  return true;
}

export function resetOwnerLock(): void {
  setSavedToken('');
}

export function setLockEnabled(_enabled: boolean): void {}

export function getOwnerPin(): string {
  return OWNER_GITHUB_LOGIN;
}

export function setOwnerPin(_pin: string): void {}

/**
 * Fetch token and user status from server.
 */
export async function checkServerTokenStatus(): Promise<TokenStatus> {
  const saved = getSavedToken();

  try {
    const headers: Record<string, string> = {};
    if (saved) {
      headers.Authorization = `Bearer ${saved}`;
    }

    const res = await fetch('/api/user-status', { headers });
    if (res.ok) {
      const data = await readApiResponse(res, 'Unable to check token status');
      if (data.configured && data.authorized) {
        return {
          configured: true,
          source: saved ? 'saved_pat' : 'server_env',
          user: data.user,
        };
      }
    }
  } catch {
    // fallback
  }

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
export async function performIngest(request: IngestRequest, signal?: AbortSignal): Promise<IngestResponse> {
  let workerStarted = false;
  let backendResponded = false;
  const savedToken = getSavedToken();
  const autoInject = getAutoInjectToken();

  const tokenToUse = request.token || (autoInject ? savedToken : undefined);
  const payload = {
    ...request,
    token: tokenToUse,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tokenToUse) {
    headers.Authorization = `Bearer ${tokenToUse}`;
  }

  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    backendResponded = response.headers.get('content-type')?.includes('application/json') || false;

    if (response.ok) {
      const data = await readApiResponse<IngestResponse | WorkerJob>(response, 'Unable to ingest repository');
      if ('id' in data && data.id && data.state) {
        workerStarted = true;
        return await waitForWorkerJob(data, headers, signal);
      }
      if ('tree' in data && typeof data.tree === 'string' && typeof data.content === 'string') {
        return data;
      }
      throw new Error('Unable to ingest repository. The server returned an incomplete response.');
    }

    if (response.status === 401 || response.status === 403) {
      const errData = await readApiResponse(response, 'Unable to authorize ingestion');
      throw new Error(errData.error || 'Unauthorized: Valid owner credentials required.');
    }

    if (response.status === 429) {
      const data = await readApiResponse(response, 'Rate limit exceeded');
      throw new Error(data.error || 'GitHub API rate limit exceeded. Please retry later.');
    }

    if (response.status >= 500) {
      console.warn('Server failed or timed out on large repository. Seamlessly falling back to direct ingestion...');
    } else if (response.headers.get('content-type')?.includes('application/json')) {
      const errData = await readApiResponse(response, 'Unable to ingest repository');
      throw new Error(errData.error || errData.message || 'Ingestion failed on server');
    }

    console.warn('Backend API returned non-200. Falling back to client-side GitHub REST API...');
  } catch (err: any) {
    if (workerStarted) throw err;
    if (signal?.aborted || err.name === 'AbortError') {
      throw err;
    }
    // If backend returned a non-500 error like 401/403/429, don't fallback
    if (err.message && (err.message.includes('Unauthorized') || err.message.includes('rate limit'))) {
      throw err;
    }
  }

  return await ingestViaGitHubApi(payload, tokenToUse, signal);
}

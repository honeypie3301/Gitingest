import { githubRateLimitMessage } from '../src/services/githubRateLimit';

const OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || 'honeypie3301').toLowerCase();
const OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
const OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();

// Process-local and credential-specific. Polling a job must not make /user requests every 1.5 seconds.
const verified = new Map<string, number>();
export async function checkOwnerAuth(tokenOrKey?: string): Promise<{ authorized: boolean; reason?: string; status?: number }> {
  if (!tokenOrKey || !tokenOrKey.trim()) {
    return { authorized: false, reason: 'No authorization credentials provided.' };
  }
  const clean = tokenOrKey.trim();
  if (OWNER_ACCESS_KEY && clean === OWNER_ACCESS_KEY) {
    return { authorized: true };
  }
  if ((verified.get(clean) || 0) > Date.now()) return { authorized: true };
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-OwnerAuth',
      },
    });
    if (!ghRes.ok) {
      const rateLimit = await githubRateLimitMessage(ghRes);
      if (rateLimit) return { authorized: false, status: 429, reason: rateLimit };
      return { authorized: false, reason: 'Invalid GitHub token' };
    }
    const user = await ghRes.json();
    const isLoginMatch = user.login && user.login.toLowerCase() === OWNER_GITHUB_LOGIN;
    const isIdMatch = !OWNER_GITHUB_ID || user.id === OWNER_GITHUB_ID;
    if (isLoginMatch && isIdMatch) {
      for (const [key, expiry] of verified) if (expiry <= Date.now()) verified.delete(key);
      if (verified.size >= 100) verified.delete(verified.keys().next().value!);
      verified.set(clean, Date.now() + 10 * 60 * 1000);
      return { authorized: true };
    }
    return { authorized: false, reason: `Token belongs to @${user.login}, not owner @${OWNER_GITHUB_LOGIN}.` };
  } catch {
    return { authorized: false, reason: 'Failed to verify token with GitHub.' };
  }
}

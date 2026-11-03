import { githubRateLimitMessage } from '../src/services/githubRateLimit';

const OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || 'honeypie3301').toLowerCase();
const OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
const OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();

const OWNER_REPO_NAME = (process.env.OWNER_REPO_NAME || 'Personal-Gitingest').trim();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { auth } = req.body || {};
  if (!auth || typeof auth !== 'string') {
    return res.status(400).json({ error: 'Authentication token or access key required' });
  }

  let clean = auth.trim();
  clean = clean.replace(/^["']|["']$/g, '').trim();
  clean = clean.replace(/^(bearer|token)\s+/i, '').trim();

  // 1. Direct secret / access key match
  if (OWNER_ACCESS_KEY && clean === OWNER_ACCESS_KEY) {
    return res.json({
      success: true,
      user: {
        login: OWNER_GITHUB_LOGIN,
        id: OWNER_GITHUB_ID,
        name: 'Owner',
        avatar_url: '',
      },
    });
  }

  // 2. Validate GitHub Token
  try {
    let ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${clean}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-OwnerAuth',
      },
    });

    if (!ghRes.ok && ghRes.status === 401) {
      ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${clean}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'GitIngest-OwnerAuth',
        },
      });
    }

    const rateLimit = await githubRateLimitMessage(ghRes);
    if (rateLimit) return res.status(429).json({ success: false, error: rateLimit });

    if (!ghRes.ok && (ghRes.status === 403 || ghRes.status === 404)) {
      try {
        const userReposRes = await fetch('https://api.github.com/user/repos?per_page=10&affiliation=owner&sort=updated', {
          headers: {
            Authorization: `Bearer ${clean}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'GitIngest-OwnerAuth',
          },
        });
        if (userReposRes.ok) {
          const repos = await userReposRes.json();
          if (Array.isArray(repos) && repos.length > 0) {
            const matchedRepo = repos.find((r: any) => r.owner && (!OWNER_GITHUB_LOGIN || r.owner.login.toLowerCase() === OWNER_GITHUB_LOGIN)) || repos[0];
            if (matchedRepo?.owner) {
              return res.json({
                success: true,
                user: {
                  id: matchedRepo.owner.id,
                  login: matchedRepo.owner.login,
                  avatar_url: matchedRepo.owner.avatar_url || '',
                  name: matchedRepo.owner.login,
                  html_url: matchedRepo.owner.html_url,
                },
              });
            }
          }
        }
      } catch {
        // Fallback to candidate list
      }

      const candidateRepos = Array.from(new Set([OWNER_REPO_NAME, 'Personal-Gitingest', 'Gitingest', 'gitingest']));
      for (const repoName of candidateRepos) {
        try {
          const repoCheck = await fetch(`https://api.github.com/repos/${OWNER_GITHUB_LOGIN}/${repoName}`, {
            headers: {
              Authorization: `Bearer ${clean}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'GitIngest-OwnerAuth',
            },
          });
          if (repoCheck.ok) {
            const repoData = await repoCheck.json();
            if (repoData.owner && repoData.owner.login.toLowerCase() === OWNER_GITHUB_LOGIN) {
              return res.json({
                success: true,
                user: {
                  id: repoData.owner.id,
                  login: repoData.owner.login,
                  avatar_url: repoData.owner.avatar_url || '',
                  name: repoData.owner.login,
                  html_url: repoData.owner.html_url,
                },
              });
            }
          }
        } catch {
          // try next repo candidate
        }
      }
    }

    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => '');
      let errMsg = `GitHub API (${ghRes.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.message) errMsg += `: ${parsed.message}`;
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 100)}`;
      }
      return res.status(401).json({ success: false, error: errMsg });
    }

    const userData = await ghRes.json();
    const isLoginMatch = userData.login && userData.login.toLowerCase() === OWNER_GITHUB_LOGIN;
    const isIdMatch = !OWNER_GITHUB_ID || userData.id === OWNER_GITHUB_ID;

    if (isLoginMatch && isIdMatch) {
      return res.json({
        success: true,
        user: {
          id: userData.id,
          node_id: userData.node_id,
          login: userData.login,
          avatar_url: userData.avatar_url,
          name: userData.name,
          html_url: userData.html_url,
        },
      });
    }

    return res.status(401).json({
      success: false,
      error: `Unauthorized: Token belongs to @${userData.login}, not instance owner @${OWNER_GITHUB_LOGIN}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Verification failed' });
  }
}

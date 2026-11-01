const OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || 'honeypie3301').toLowerCase();
const OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
const OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { auth } = req.body || {};
  if (!auth || typeof auth !== 'string') {
    return res.status(400).json({ error: 'Authentication token or access key required' });
  }

  const clean = auth.trim();

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
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-OwnerAuth',
      },
    });

    if (!ghRes.ok) {
      return res.status(401).json({ success: false, error: 'Invalid GitHub token or authentication failed.' });
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

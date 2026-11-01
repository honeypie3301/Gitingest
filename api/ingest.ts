import JSZip from 'jszip';

export const config = {
  maxDuration: 60, // allow up to 60s execution for large repos
};

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'pdf', 'zip', 'tar',
  'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'pyc', 'pyo', 'pyd',
  'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'mov', 'wav', 'ogg', 'jar',
  'class', 'lockb', 'parquet', 'feather', 'wasm',
]);

function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

function parseGitHubUrl(input: string): {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
} | null {
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/^(?:www\.)?(?:github\.com|gitingest\.com)\//i, '');
  clean = clean.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');

  const parts = clean.split('/');
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1];
  let branch: string | undefined;
  let subpath: string | undefined;

  if (parts.length > 3 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    branch = parts[3];
    if (parts.length > 4) {
      subpath = parts.slice(4).join('/');
    }
  }

  return { owner, repo, branch, subpath };
}

function buildAsciiTree(rootName: string, paths: string[]): string {
  interface TreeNode {
    [key: string]: TreeNode;
  }
  const root: TreeNode = {};

  for (const p of paths) {
    const parts = p.split('/');
    let curr = root;
    for (const part of parts) {
      if (!curr[part]) curr[part] = {};
      curr = curr[part];
    }
  }

  function render(node: TreeNode, prefix = ''): string {
    const keys = Object.keys(node).sort((a, b) => {
      const aIsDir = Object.keys(node[a]).length > 0;
      const bIsDir = Object.keys(node[b]).length > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    let result = '';
    keys.forEach((key, index) => {
      const isLast = index === keys.length - 1;
      const isDir = Object.keys(node[key]).length > 0;
      const connector = isLast ? '└── ' : '├── ';
      result += `${prefix}${connector}${key}${isDir ? '/' : ''}\n`;
      if (isDir) {
        result += render(node[key], prefix + (isLast ? '    ' : '│   '));
      }
    });
    return result;
  }

  return `└── ${rootName}/\n${render(root, '    ')}`;
}

const OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || 'honeypie3301').toLowerCase();
const OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
const OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();

async function checkOwnerAuth(tokenOrKey?: string): Promise<{ authorized: boolean; reason?: string }> {
  if (!tokenOrKey || !tokenOrKey.trim()) {
    return { authorized: false, reason: 'No authorization credentials provided.' };
  }
  const clean = tokenOrKey.trim();
  if (OWNER_ACCESS_KEY && clean === OWNER_ACCESS_KEY) {
    return { authorized: true };
  }
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-OwnerAuth',
      },
    });
    if (!ghRes.ok) return { authorized: false, reason: 'Invalid GitHub token' };
    const user = await ghRes.json();
    const isLoginMatch = user.login && user.login.toLowerCase() === OWNER_GITHUB_LOGIN;
    const isIdMatch = !OWNER_GITHUB_ID || user.id === OWNER_GITHUB_ID;
    if (isLoginMatch && isIdMatch) return { authorized: true };
    return { authorized: false, reason: `Token belongs to @${user.login}, not owner @${OWNER_GITHUB_LOGIN}.` };
  } catch {
    return { authorized: false, reason: 'Failed to verify token with GitHub.' };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers?.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const incomingAuth = bearerToken || req.body?.token || process.env.GITHUB_TOKEN;

  const authCheck = await checkOwnerAuth(incomingAuth);
  if (!authCheck.authorized) {
    return res.status(401).json({
      error: `Unauthorized: ${authCheck.reason || 'Valid owner Personal Access Token or access key is required.'}`,
    });
  }

  const { input_text, max_file_size = 50, pattern_type = 'exclude', pattern = '', token } = req.body || {};

  if (!input_text || typeof input_text !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid repository URL' });
  }

  const parsed = parseGitHubUrl(input_text);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid URL. Expected format: owner/repo or https://github.com/owner/repo' });
  }

  const { owner, repo } = parsed;
  const activeToken = (bearerToken || token || process.env.GITHUB_TOKEN || '').trim();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GitIngest-Personal',
  };
  if (activeToken) {
    headers.Authorization = `Bearer ${activeToken}`;
  }

  try {
    // 1. Resolve branch
    let branch: string = parsed.branch || '';
    if (!branch) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!repoRes.ok) {
        if (repoRes.status === 404) {
          return res.status(404).json({
            error: `Repository "${owner}/${repo}" not found or is private. Make sure your PAT has 'repo' scope.`,
          });
        }
        if (repoRes.status === 403) {
          return res.status(403).json({
            error: 'GitHub API rate limit exceeded or access forbidden. Check your Personal Access Token.',
          });
        }
        return res.status(repoRes.status).json({ error: `GitHub API error: ${repoRes.statusText}` });
      }
      const repoData = await repoRes.json();
      branch = repoData.default_branch || 'main';
    }

    // 2. Download zipball (Node.js follows codeload.github.com redirect seamlessly with no CORS)
    const zipballUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
    const zipRes = await fetch(zipballUrl, {
      headers: activeToken ? { Authorization: `Bearer ${activeToken}`, 'User-Agent': 'GitIngest-Personal' } : { 'User-Agent': 'GitIngest-Personal' },
    });

    if (!zipRes.ok) {
      return res.status(zipRes.status).json({
        error: `Failed to download repository archive from branch "${branch}". Status: ${zipRes.status}`,
      });
    }

    const arrayBuffer = await zipRes.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const maxBytes = max_file_size * 1024 * 1024; // in MB
    const patterns = (pattern as string)
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const matchesPattern = (filePath: string, pat: string): boolean => {
      const p = pat.replace(/\./g, '\\.').replace(/\*/g, '.*');
      try {
        return new RegExp(p, 'i').test(filePath);
      } catch {
        return filePath.includes(pat);
      }
    };

    const isIncluded = (filePath: string): boolean => {
      if (parsed.subpath && !filePath.startsWith(parsed.subpath)) {
        return false;
      }
      if (patterns.length === 0) return true;
      const matched = patterns.some((p) => matchesPattern(filePath, p));
      return pattern_type === 'include' ? matched : !matched;
    };

    const fileEntries: Array<{ relPath: string; zipObject: JSZip.JSZipObject }> = [];
    const allPaths: string[] = [];

    const fileKeys = Object.keys(zip.files);
    const firstKey = fileKeys[0] || '';
    const rootPrefix = firstKey.includes('/') ? firstKey.split('/')[0] + '/' : '';

    for (const rawPath of fileKeys) {
      const zipObj = zip.files[rawPath];
      if (zipObj.dir) continue;

      const relPath = rootPrefix && rawPath.startsWith(rootPrefix)
        ? rawPath.substring(rootPrefix.length)
        : rawPath;

      if (!relPath || relPath.startsWith('.git/')) continue;
      if (isBinaryPath(relPath)) continue;
      if (!isIncluded(relPath)) continue;

      allPaths.push(relPath);
      fileEntries.push({ relPath, zipObject: zipObj });
    }

    const treeText = buildAsciiTree(parsed.subpath || repo, allPaths);

    const fileContents: string[] = [];
    let totalChars = 0;
    let filesAnalyzed = 0;

    for (const { relPath, zipObject } of fileEntries) {
      try {
        const content = await zipObject.async('string');
        if (content.length > maxBytes || content.includes('\0')) continue;

        totalChars += content.length;
        filesAnalyzed++;
        fileContents.push(
          `================================================\nFile: ${relPath}\n================================================\n${content}\n`
        );
      } catch {
        // skip unreadable
      }
    }

    const estTokens = formatTokens(Math.round(totalChars / 4));
    const summary = [
      `Repository: ${owner}/${repo}`,
      `Branch: ${branch}`,
      parsed.subpath ? `Subpath: ${parsed.subpath}` : null,
      `Files analyzed: ${filesAnalyzed}`,
      `Estimated tokens: ${estTokens}`,
      `Total characters: ${totalChars.toLocaleString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({
      summary,
      tree: `Directory structure:\n${treeText}`,
      content: fileContents.join('\n'),
      repo_name: `${owner}/${repo}`,
      files_analyzed: filesAnalyzed,
      estimated_tokens: estTokens,
      total_chars: totalChars,
    });
  } catch (err: any) {
    console.error('Vercel Ingestion Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error while processing ingestion' });
  }
}

import JSZip from 'jszip';
import { IngestRequest, IngestResponse, GitHubUser } from '../types';

export interface RepoSummary {
  name: string;
  full_name: string;
  is_private: boolean;
  description?: string;
  default_branch: string;
}

export async function verifyGitHubToken(token: string): Promise<GitHubUser | null> {
  if (!token || !token.trim()) return null;
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      login: data.login,
      avatar_url: data.avatar_url,
      name: data.name,
      html_url: data.html_url,
    };
  } catch (err) {
    console.error('Error verifying GitHub token:', err);
    return null;
  }
}

export async function fetchUserRepos(token?: string, fallbackUser = 'honeypie3301'): Promise<RepoSummary[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const url = token
      ? 'https://api.github.com/user/repos?sort=updated&per_page=12&affiliation=owner'
      : `https://api.github.com/users/${fallbackUser}/repos?sort=updated&per_page=12`;

    const res = await fetch(url, { headers });
    if (!res.ok) return [];

    const repos = await res.json();
    if (!Array.isArray(repos)) return [];

    return repos.map((r: any) => ({
      name: r.name,
      full_name: r.full_name,
      is_private: Boolean(r.private),
      description: r.description,
      default_branch: r.default_branch || 'main',
    }));
  } catch {
    return [];
  }
}

export function parseGitHubUrl(input: string): {
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

/**
 * Robust ingestion with dual-strategy:
 * 1. Fast zipball archive (Node/Serverless).
 * 2. If browser CORS blocks zipball redirect, smoothly falls back to recursive tree + raw.githubusercontent.com!
 */
export async function ingestViaGitHubApi(
  req: IngestRequest,
  token?: string
): Promise<IngestResponse> {
  const parsed = parseGitHubUrl(req.input_text);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL or slug. Format: owner/repo or https://github.com/owner/repo');
  }

  const { owner, repo } = parsed;
  const activeToken = (token || req.token || '').trim();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (activeToken) {
    headers.Authorization = `Bearer ${activeToken}`;
  }

  // 1. Get repo default branch
  let branch = parsed.branch;
  if (!branch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        throw new Error(
          `Repository "${owner}/${repo}" not found or private. Ensure your saved token has "repo" scope.`
        );
      }
      if (repoRes.status === 403) {
        throw new Error('GitHub API rate limit exceeded or access forbidden. Check your Personal Access Token.');
      }
      throw new Error(`GitHub API error (${repoRes.status}): ${repoRes.statusText}`);
    }
    const repoData = await repoRes.json();
    branch = repoData.default_branch || 'main';
  }

  const maxBytes = (req.max_file_size || 50) * 1024 * 1024;
  const patternType = req.pattern_type || 'exclude';
  const patterns = (req.pattern || '')
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
    return patternType === 'include' ? matched : !matched;
  };

  // Strategy 1: Try zipball
  try {
    const zipballUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
    const zipRes = await fetch(zipballUrl, {
      headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
    });

    if (zipRes.ok) {
      const arrayBuffer = await zipRes.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        const zip = await JSZip.loadAsync(arrayBuffer);
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
            // skip
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

        return {
          summary,
          tree: `Directory structure:\n${treeText}`,
          content: fileContents.join('\n'),
          repo_name: `${owner}/${repo}`,
          files_analyzed: filesAnalyzed,
          estimated_tokens: estTokens,
          total_chars: totalChars,
        };
      }
    }
  } catch (zipErr) {
    console.warn('Zipball fetch failed (likely browser CORS redirect). Falling back to REST tree + raw contents...', zipErr);
  }

  // Strategy 2: Browser CORS-safe REST Git Tree + raw.githubusercontent.com
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) {
    throw new Error(`Failed to fetch file tree for "${owner}/${repo}" (${treeRes.status}).`);
  }
  const treeData = await treeRes.json();
  const rawTree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }> =
    treeData.tree || [];

  const fileNodes = rawTree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (isBinaryPath(item.path)) return false;
    if (!isIncluded(item.path)) return false;
    if (item.size && item.size > maxBytes) return false;
    return true;
  });

  const treePaths = rawTree
    .filter((item) => isIncluded(item.path))
    .map((item) => item.path);
  const treeText = buildAsciiTree(parsed.subpath || repo, treePaths);

  const CONCURRENCY = 20;
  const fileContents: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < fileNodes.length; i += CONCURRENCY) {
    const chunk = fileNodes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (file) => {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path}`;
          const res = await fetch(rawUrl, {
            headers: activeToken ? { Authorization: `token ${activeToken}` } : {},
          });
          if (res.ok) {
            const text = await res.text();
            return { path: file.path, text };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    for (const item of results) {
      if (item && typeof item.text === 'string') {
        totalChars += item.text.length;
        fileContents.push(
          `================================================\nFile: ${item.path}\n================================================\n${item.text}\n`
        );
      }
    }
  }

  const estTokens = formatTokens(Math.round(totalChars / 4));
  const summary = [
    `Repository: ${owner}/${repo}`,
    `Branch: ${branch}`,
    parsed.subpath ? `Subpath: ${parsed.subpath}` : null,
    `Files analyzed: ${fileContents.length}`,
    `Estimated tokens: ${estTokens}`,
    `Total characters: ${totalChars.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    summary,
    tree: `Directory structure:\n${treeText}`,
    content: fileContents.join('\n'),
    repo_name: `${owner}/${repo}`,
    files_analyzed: fileContents.length,
    estimated_tokens: estTokens,
    total_chars: totalChars,
  };
}

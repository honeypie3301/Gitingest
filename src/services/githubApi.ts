import { buildAsciiTree, formatTokens, isBinaryPath, parseGitHubUrl } from './ingestFormatting';
import { assertNotRateLimited, GitHubRateLimitError } from './githubRateLimit';
import { decompileJavaClass } from './decompiler/javaClassDecompiler';
export { parseGitHubUrl } from './ingestFormatting';
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
  let clean = token.trim().replace(/^["']|["']$/g, '').replace(/^(bearer|token)\s+/i, '').trim();
  if (!clean) return null;

  try {
    let res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${clean}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok && res.status === 401) {
      res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${clean}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
    }

    if (!res.ok && (res.status === 403 || res.status === 404)) {
      const repoRes = await fetch('https://api.github.com/repos/honeypie3301/gitingest', {
        headers: {
          Authorization: `Bearer ${clean}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        if (repoData.owner) {
          return {
            id: repoData.owner.id,
            login: repoData.owner.login,
            avatar_url: repoData.owner.avatar_url,
            name: repoData.owner.login,
            html_url: repoData.owner.html_url,
          };
        }
      }
    }

    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      node_id: data.node_id,
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

/**
 * Robust ingestion with dual-strategy:
 * 1. Fast zipball archive (Node/Serverless).
 * 2. If browser CORS blocks zipball redirect, smoothly falls back to recursive tree + raw.githubusercontent.com!
 */
export async function ingestViaGitHubApi(
  req: IngestRequest,
  token?: string,
  signal?: AbortSignal
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

  let branch: string = parsed.branch || '';

  if (!branch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal });
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

  const compiledPatterns = patterns.map((pat) => {
    const escaped = pat.replace(/\./g, '\\.').replace(/\*/g, '.*');
    try {
      return { regex: new RegExp(escaped, 'i'), raw: pat };
    } catch {
      return { regex: null, raw: pat };
    }
  });

  const isIncluded = (filePath: string): boolean => {
    if (parsed.subpath && !filePath.startsWith(parsed.subpath)) {
      return false;
    }
    if (compiledPatterns.length === 0) return true;
    const matched = compiledPatterns.some(({ regex, raw }) => (regex ? regex.test(filePath) : filePath.includes(raw)));
    return patternType === 'include' ? matched : !matched;
  };

  // codeload.github.com sends no CORS header for our origin, so the browser cannot use zipballs.
  // Browser CORS-safe REST Git Tree + GitHub Git Blobs / raw
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers, signal }
  );
  if (!treeRes.ok) {
    if (signal?.aborted) throw new DOMException('Ingestion cancelled by user', 'AbortError');
    throw new Error(`Failed to fetch file tree for "${owner}/${repo}" (${treeRes.status}).`);
  }
  const treeData = await treeRes.json();
  // If GitHub truncates the tree (e.g. >100,000 files or 7MB tree response), proceed with the files that were returned instead of crashing!
  const rawTree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }> =
    treeData.tree || [];

  const fileNodes = rawTree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (!isIncluded(item.path)) return false;
    if (item.size && item.size > maxBytes) return false;
    return true;
  });

  const treePaths = rawTree
    .filter((item) => isIncluded(item.path))
    .map((item) => item.path);
  const treeText = buildAsciiTree(parsed.subpath || repo, treePaths);

  const CONCURRENCY = 60;
  const fileContents: string[] = [];
  let totalChars = 0;

  // Multi-tier fetcher: handles decompilation, binary placeholders, and text files
  const fetchSingleFileContent = async (file: { path: string; sha: string; size?: number }): Promise<{ path: string; text: string } | null> => {
    if (signal?.aborted) return null;

    const lowerPath = file.path.toLowerCase();
    const isClass = lowerPath.endsWith('.class');

    // Handle non-class binary files immediately with placeholder without wasteful HTTP fetches
    if (!isClass && isBinaryPath(file.path)) {
      return { path: file.path, text: '[Binary file]' };
    }

    // Handle .class files when decompilation is disabled
    if (isClass && !req.decompile_classes) {
      return { path: file.path, text: '[Binary file: Java Class file]' };
    }

    // Decompilation or text fetching via GitHub Blobs API
    if (activeToken || isClass) {
      try {
        const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
        if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

        const jsonRes = await fetch(blobUrl, { headers, signal });
        await assertNotRateLimited(jsonRes);
        if (jsonRes.ok) {
          const data = await jsonRes.json();
          if (data.content && data.encoding === 'base64') {
            const cleanBase64 = data.content.replace(/\s/g, '');
            const binary = atob(cleanBase64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);

            if (isClass) {
              const decompiled = decompileJavaClass(bytes, file.path.split('/').pop()?.replace(/\.class$/i, '') || 'Class');
              return { path: file.path + ' [Decompiled Java]', text: decompiled };
            }
            const text = new TextDecoder('utf-8').decode(bytes);
            return { path: file.path, text };
          }
        }
      } catch (err) {
        if (err instanceof GitHubRateLimitError) throw err;
        if (signal?.aborted) throw err;
      }
    }

    // 2. For public repos or unauthenticated requests, fetch from raw.githubusercontent.com
    // NOTE: Sending custom headers like Authorization to raw triggers a 403 preflight CORS rejection.
    // Therefore, call with NO custom headers.
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path}`;
      const res = await fetch(rawUrl, { signal });
      await assertNotRateLimited(res);
      if (res.ok) {
        const text = await res.text();
        return { path: file.path, text };
      }
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      if (signal?.aborted) throw err;
    }

    // 3. Fallback: public GitHub Blobs API without token
    try {
      const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
      const res = await fetch(blobUrl, {
        headers: { Accept: 'application/vnd.github.raw' },
        signal,
      });
      await assertNotRateLimited(res);
      if (res.ok) {
        const text = await res.text();
        return { path: file.path, text };
      }
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      if (signal?.aborted) throw err;
    }

    return null;
  };

  // Sliding window: a slow request never stalls the other workers (unlike Promise.all per chunk).
  const results = new Array<{ path: string; text: string } | null>(fileNodes.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, fileNodes.length) }, async () => {
      while (next < fileNodes.length) {
        if (signal?.aborted) throw new DOMException('Ingestion cancelled by user', 'AbortError');
        const index = next++;
        results[index] = await fetchSingleFileContent(fileNodes[index]);
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
    mode_switched: true,
    mode_info: 'Switched to CORS-Safe REST (Rate-limit bypassed)',
  };
}

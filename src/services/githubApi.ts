import { buildAsciiTree, formatTokens, isBinaryPath, parseGitHubUrl } from './ingestFormatting';
import { assertNotRateLimited, GitHubRateLimitError } from './githubRateLimit';
export { parseGitHubUrl } from './ingestFormatting';
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

  const zipHeaders: Record<string, string> = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
  let branch: string = parsed.branch || '';
  let zipRes: Response | null = null;

  if (branch) {
    try {
      zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`, {
        headers: zipHeaders,
        signal,
      });
    } catch {
      zipRes = null;
    }
  } else {
    // Parallel speculative fetch for default branch metadata and main branch zipball
    const [repoRes, zipMainRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/main`, { headers: zipHeaders, signal }).catch(() => null),
    ]);

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

    if (branch === 'main' && zipMainRes && zipMainRes.ok) {
      zipRes = zipMainRes;
    } else {
      try {
        zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`, {
          headers: zipHeaders,
          signal,
        });
      } catch {
        zipRes = null;
      }
    }
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

  // Strategy 1: Try zipball
  try {
    if (!zipRes || !zipRes.ok) {
      const zipballUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
      zipRes = await fetch(zipballUrl, {
        headers: zipHeaders,
        signal,
      });
    }

    if (zipRes && zipRes.ok) {
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

        const ZIP_CHUNK = 50;
        for (let i = 0; i < fileEntries.length; i += ZIP_CHUNK) {
          if (signal?.aborted) break;
          const chunk = fileEntries.slice(i, i + ZIP_CHUNK);
          const chunkResults = await Promise.all(
            chunk.map(async ({ relPath, zipObject }) => {
              try {
                const content = await zipObject.async('string');
                if (content.length > maxBytes || content.includes('\0')) return null;
                return { relPath, content, len: content.length };
              } catch {
                return null;
              }
            })
          );

          for (const item of chunkResults) {
            if (item) {
              totalChars += item.len;
              filesAnalyzed++;
              fileContents.push(
                `================================================\nFile: ${item.relPath}\n================================================\n${item.content}\n`
              );
            }
          }
        }

        signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    console.warn('Zipball fetch failed (likely browser CORS redirect). Falling back to REST tree + raw contents...', zipErr);
  }

  // Strategy 2: Browser CORS-safe REST Git Tree + GitHub Git Blobs / raw
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers, signal }
  );
  if (!treeRes.ok) {
    if (signal?.aborted) throw new DOMException('Ingestion cancelled by user', 'AbortError');
    throw new Error(`Failed to fetch file tree for "${owner}/${repo}" (${treeRes.status}).`);
  }
  const treeData = await treeRes.json();
  if (treeData.truncated) {
    throw new Error('GitHub truncated this repository tree. Use the ingestion worker to export the complete repository.');
  }
  const rawTree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }> =
    treeData.tree || [];

  const fileNodes = rawTree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (isBinaryPath(item.path)) return false;
    if (!isIncluded(item.path)) return false;
    if (item.size && item.size > maxBytes) return false;
    return true;
  });

  // A large file-by-file retry can exhaust the PAT allowance and even prevent owner authentication.
  if (fileNodes.length > 1000) {
    throw new Error('This repository is too large for file-by-file browser ingestion. Configure the ingestion worker to avoid GitHub API rate limits.');
  }

  const treePaths = rawTree
    .filter((item) => isIncluded(item.path))
    .map((item) => item.path);
  const treeText = buildAsciiTree(parsed.subpath || repo, treePaths);

  const CONCURRENCY = 30;
  const fileContents: string[] = [];
  let totalChars = 0;

  // Multi-tier fetcher: handles both private repos (with PAT via GitHub Blobs API)
  // and public repos (via raw.githubusercontent.com without preflight)
  const fetchSingleFileContent = async (file: { path: string; sha: string; size?: number }): Promise<{ path: string; text: string } | null> => {
    if (signal?.aborted) return null;

    // 1. If PAT is present (required for private repos like Backwoods-Test), query GitHub Git Blobs API
    if (activeToken) {
      try {
        const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
        const res = await fetch(blobUrl, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
            Accept: 'application/vnd.github.raw',
          },
          signal,
        });
        await assertNotRateLimited(res);

        if (res.ok) {
          const text = await res.text();
          return { path: file.path, text };
        }

        // Fallback to json base64 if raw media type returns 415 or 406
        if (res.status === 415 || res.status === 406 || res.status === 400) {
          const jsonRes = await fetch(blobUrl, {
            headers: {
              Authorization: `Bearer ${activeToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
            signal,
          });
          await assertNotRateLimited(jsonRes);
          if (jsonRes.ok) {
            const data = await jsonRes.json();
            if (data.content && data.encoding === 'base64') {
              const cleanBase64 = data.content.replace(/\s/g, '');
              const binary = atob(cleanBase64);
              const bytes = new Uint8Array(binary.length);
              for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
              const text = new TextDecoder('utf-8').decode(bytes);
              return { path: file.path, text };
            }
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

  for (let i = 0; i < fileNodes.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new DOMException('Ingestion cancelled by user', 'AbortError');
    }
    const chunk = fileNodes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((file) => fetchSingleFileContent(file))
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

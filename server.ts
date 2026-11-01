import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import dotenv from 'dotenv';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const execFileAsync = promisify(execFile);
const fsPromises = fs.promises;
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

function sanitizeSubpath(subpath: string): string {
  return subpath.replace(/\.\./g, '').replace(/^\/+|\/+$/g, '');
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'pdf', 'zip', 'tar',
  'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'pyc', 'pyo', 'pyd',
  'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'mov', 'wav', 'ogg', 'jar',
  'class', 'lockb', 'parquet', 'feather', 'wasm',
]);

function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

const OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || 'honeypie3301').toLowerCase();
const OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
const OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();

// In-memory token cache to prevent GitHub rate-limiting on repeated requests
interface VerifiedTokenCache {
  isOwner: boolean;
  user: any;
  cachedAt: number;
}
const tokenCache = new Map<string, VerifiedTokenCache>();
const TOKEN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Rate Limiter
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count++;
  return true;
}

// Helper to verify if a token or secret is authorized as the owner
async function verifyOwnerCredentials(tokenOrKey?: string): Promise<{ authorized: boolean; user?: any; reason?: string }> {
  if (!tokenOrKey || !tokenOrKey.trim()) {
    return { authorized: false, reason: 'No authorization credentials provided.' };
  }

  const clean = tokenOrKey.trim();

  // 1. Direct match with configured server secret / access key
  if (OWNER_ACCESS_KEY && clean === OWNER_ACCESS_KEY) {
    return {
      authorized: true,
      user: {
        login: OWNER_GITHUB_LOGIN,
        id: OWNER_GITHUB_ID,
        name: 'Owner',
        avatar_url: '',
      },
    };
  }

  // 2. Check token cache
  const cached = tokenCache.get(clean);
  const now = Date.now();
  if (cached && now - cached.cachedAt < TOKEN_CACHE_TTL) {
    if (cached.isOwner) {
      return { authorized: true, user: cached.user };
    }
    return { authorized: false, reason: 'Token is not authorized as owner.' };
  }

  // 3. Verify GitHub Token via GitHub API
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-OwnerAuth',
      },
    });

    if (!ghRes.ok) {
      tokenCache.set(clean, { isOwner: false, user: null, cachedAt: now });
      return { authorized: false, reason: 'Invalid GitHub token or authentication failed.' };
    }

    const userData = await ghRes.json();
    const isLoginMatch = userData.login && userData.login.toLowerCase() === OWNER_GITHUB_LOGIN;
    const isIdMatch = !OWNER_GITHUB_ID || userData.id === OWNER_GITHUB_ID;

    if (isLoginMatch && isIdMatch) {
      const user = {
        id: userData.id,
        node_id: userData.node_id,
        login: userData.login,
        avatar_url: userData.avatar_url,
        name: userData.name,
        html_url: userData.html_url,
      };
      tokenCache.set(clean, { isOwner: true, user, cachedAt: now });
      return { authorized: true, user };
    }

    tokenCache.set(clean, { isOwner: false, user: null, cachedAt: now });
    return {
      authorized: false,
      reason: `Unauthorized: Token belongs to @${userData.login}, not instance owner @${OWNER_GITHUB_LOGIN}.`,
    };
  } catch (err: any) {
    return { authorized: false, reason: `Failed to verify token: ${err.message}` };
  }
}

// Server-side Authentication Endpoint
app.post('/api/verify-auth', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`auth:${ip}`, 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many authentication attempts. Please try again in 5 minutes.' });
  }

  const { auth } = req.body || {};
  if (!auth || typeof auth !== 'string') {
    return res.status(400).json({ error: 'Authentication token or access key required' });
  }

  const check = await verifyOwnerCredentials(auth);
  if (check.authorized) {
    return res.json({ success: true, user: check.user });
  }

  return res.status(401).json({ success: false, error: check.reason || 'Invalid credentials' });
});

// User & Token Status Endpoint
app.get('/api/user-status', async (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const tokenToCheck = bearerToken || process.env.GITHUB_TOKEN;

  if (!tokenToCheck) {
    return res.json({ configured: false, user: null, authorized: false });
  }

  const check = await verifyOwnerCredentials(tokenToCheck);
  return res.json({
    configured: true,
    authorized: check.authorized,
    user: check.user || null,
  });
});

// High-speed Ingest Endpoint
app.post('/api/ingest', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`ingest:${ip}`, 30, 60 * 1000)) {
    return res.status(429).json({ error: 'Rate limit exceeded: max 30 ingestions per minute.' });
  }

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const incomingToken = bearerToken || req.body.token || process.env.GITHUB_TOKEN;

  // Enforce server-side authorization
  const authCheck = await verifyOwnerCredentials(incomingToken);
  if (!authCheck.authorized) {
    return res.status(401).json({
      error: `Unauthorized: ${authCheck.reason || 'Valid owner Personal Access Token or access key is required.'}`,
    });
  }

  const { input_text, max_file_size = 50, pattern_type = 'exclude', pattern = '', token } = req.body;

  if (!input_text || typeof input_text !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid repository URL or path' });
  }

  const activeToken = (bearerToken || token || process.env.GITHUB_TOKEN || '').trim();

  let clean = input_text.trim();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/^(?:www\.)?(?:github\.com|gitingest\.com)\//i, '');
  clean = clean.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');

  const parts = clean.split('/');
  if (parts.length < 2) {
    return res.status(400).json({ error: 'Invalid URL. Expected format: owner/repo or https://github.com/owner/repo' });
  }

  const owner = parts[0];
  const repo = parts[1];
  let branch: string | undefined;
  let subpath: string | undefined;

  if (parts.length > 3 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    branch = parts[3];
    if (parts.length > 4) {
      subpath = sanitizeSubpath(parts.slice(4).join('/'));
    }
  }

  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  const patterns = (pattern as string)
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

  const isPathAllowed = (relPath: string): boolean => {
    if (compiledPatterns.length === 0) return true;
    const matched = compiledPatterns.some(({ regex, raw }) => (regex ? regex.test(relPath) : relPath.includes(raw)));
    return pattern_type === 'include' ? matched : !matched;
  };

  const maxBytes = max_file_size * 1024 * 1024;

  // FAST PATH: In-memory Zipball extraction (0 disk I/O, matching & beating real GitIngest)
  try {
    let resolvedBranch: string = branch || '';
    let zipRes: Response;

    const zipHeaders: Record<string, string> = {
      'User-Agent': 'GitIngest-Fast',
    };
    if (activeToken) zipHeaders.Authorization = `Bearer ${activeToken}`;

    if (resolvedBranch) {
      zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(resolvedBranch)}`, {
        headers: zipHeaders,
        signal: abortController.signal,
      });
    } else {
      const repoHeaders: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-Fast',
      };
      if (activeToken) repoHeaders.Authorization = `Bearer ${activeToken}`;

      // Parallel speculative fetch for default branch metadata and main branch zipball
      const [repoMetaRes, zipMainRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: repoHeaders,
          signal: abortController.signal,
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/main`, {
          headers: zipHeaders,
          signal: abortController.signal,
        }).catch(() => null),
      ]);

      if (repoMetaRes.ok) {
        const repoMetaData = await repoMetaRes.json();
        resolvedBranch = repoMetaData.default_branch || 'main';
      } else {
        resolvedBranch = 'main';
      }

      if (resolvedBranch === 'main' && zipMainRes && zipMainRes.ok) {
        zipRes = zipMainRes;
      } else {
        zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(resolvedBranch)}`, {
          headers: zipHeaders,
          signal: abortController.signal,
        });
      }
    }

    if (zipRes && zipRes.ok) {
      const arrayBuf = await zipRes.arrayBuffer();
      // Cap raised from 100MB to 300MB
      if (arrayBuf.byteLength > 0 && arrayBuf.byteLength < 300 * 1024 * 1024) {
        const zip = await JSZip.loadAsync(arrayBuf);
        const fileKeys = Object.keys(zip.files);
        const firstKey = fileKeys[0] || '';
        const rootPrefix = firstKey.includes('/') ? firstKey.split('/')[0] + '/' : '';

        const fileEntries: Array<{ relPath: string; obj: JSZip.JSZipObject }> = [];
        const allPaths: string[] = [];

        for (const rawPath of fileKeys) {
          const obj = zip.files[rawPath];
          if (obj.dir) continue;
          const relPath = rootPrefix && rawPath.startsWith(rootPrefix)
            ? rawPath.substring(rootPrefix.length)
            : rawPath;

          if (!relPath || relPath.startsWith('.git/')) continue;
          if (subpath && !relPath.startsWith(subpath)) continue;
          if (isBinaryExtension(relPath)) continue;
          if (!isPathAllowed(relPath)) continue;

          allPaths.push(relPath);
          fileEntries.push({ relPath, obj });
        }

        const treeText = buildAsciiTree(subpath || repo, allPaths);
        const fileContents: string[] = [];
        let totalChars = 0;

        const ZIP_CHUNK = 100;
        for (let i = 0; i < fileEntries.length; i += ZIP_CHUNK) {
          if (clientDisconnected) return;
          const chunk = fileEntries.slice(i, i + ZIP_CHUNK);
          const chunkResults = await Promise.all(
            chunk.map(async ({ relPath, obj }) => {
              try {
                const content = await obj.async('string');
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
              fileContents.push(
                `================================================\nFile: ${item.relPath}\n================================================\n${item.content}\n`
              );
            }
          }
        }

        const estimatedTokens = formatTokenCount(Math.round(totalChars / 4));
        const summaryParts = [
          `Repository: ${owner}/${repo}`,
          resolvedBranch ? `Branch: ${resolvedBranch}` : null,
          subpath ? `Subpath: ${subpath}` : null,
          `Files analyzed: ${fileContents.length}`,
          `Estimated tokens: ${estimatedTokens}`,
          `Total characters: ${totalChars.toLocaleString()}`,
        ].filter(Boolean);

        return res.json({
          summary: summaryParts.join('\n'),
          tree: `Directory structure:\n${treeText}`,
          content: fileContents.join('\n'),
          repo_name: `${owner}/${repo}`,
          files_analyzed: fileContents.length,
          estimated_tokens: estimatedTokens,
          total_chars: totalChars,
        });
      }
    }
  } catch (zipErr) {
    if (clientDisconnected) return;
    // Fall back to git clone if zipball fails
  }

  // FALLBACK: Shallow Git Clone on Disk
  const tempDir = path.join(os.tmpdir(), `gitingest_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);

  try {
    const cloneUrl = activeToken
      ? `https://x-access-token:${encodeURIComponent(activeToken)}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    const cloneArgs = ['clone', '--depth', '1', '--single-branch', '--no-tags'];
    if (branch) {
      cloneArgs.push('-b', branch);
    }
    cloneArgs.push(cloneUrl, tempDir);

    try {
      await execFileAsync('git', cloneArgs, { timeout: 60000 });
    } catch (gitErr: any) {
      const errMsg = gitErr.stderr || gitErr.message || '';
      if (errMsg.includes('could not read Username') || errMsg.includes('Authentication failed') || errMsg.includes('Repository not found')) {
        return res.status(403).json({
          error: `Could not access repository "${owner}/${repo}". If this is a private repository, please ensure your GitHub Personal Access Token is configured with 'repo' scope.`,
        });
      }
      throw new Error(`Git clone failed: ${errMsg.slice(0, 300)}`);
    }

    const targetRoot = subpath ? path.join(tempDir, subpath) : tempDir;
    if (!fs.existsSync(targetRoot)) {
      return res.status(404).json({ error: `Subpath "${subpath}" does not exist in repository.` });
    }

    const collectedFiles: Array<{ relPath: string; fullPath: string; size: number }> = [];

    // Fast asynchronous directory traversal
    async function walkDirFast(currentDir: string): Promise<void> {
      const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.venv') return;
          const full = path.join(currentDir, entry.name);
          const rel = path.relative(targetRoot, full).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            await walkDirFast(full);
          } else if (entry.isFile()) {
            if (isBinaryExtension(rel)) return;
            if (!isPathAllowed(rel)) return;
            try {
              const stat = await fsPromises.stat(full);
              if (stat.size <= maxBytes) {
                collectedFiles.push({ relPath: rel, fullPath: full, size: stat.size });
              }
            } catch {
              // skip
            }
          }
        })
      );
    }

    await walkDirFast(targetRoot);

    // Build directory tree
    const paths = collectedFiles.map((f) => f.relPath);
    const treeText = buildAsciiTree(subpath || repo, paths);

    // High-speed parallel chunked file reading
    const CHUNK_SIZE = 50;
    const fileContents: string[] = [];
    let totalChars = 0;

    for (let i = 0; i < collectedFiles.length; i += CHUNK_SIZE) {
      if (clientDisconnected) return;
      const chunk = collectedFiles.slice(i, i + CHUNK_SIZE);
      const readResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const buf = await fsPromises.readFile(file.fullPath);
            if (isBinaryBuffer(buf)) return null;
            const content = buf.toString('utf-8');
            return {
              relPath: file.relPath,
              content,
              length: content.length,
            };
          } catch {
            return null;
          }
        })
      );

      for (const resItem of readResults) {
        if (resItem) {
          totalChars += resItem.length;
          fileContents.push(
            `================================================\nFile: ${resItem.relPath}\n================================================\n${resItem.content}\n`
          );
        }
      }
    }

    const fullContent = fileContents.join('\n');
    const estimatedTokens = formatTokenCount(Math.round(totalChars / 4));

    const summaryParts = [
      `Repository: ${owner}/${repo}`,
      branch ? `Branch: ${branch}` : null,
      subpath ? `Subpath: ${subpath}` : null,
      `Files analyzed: ${fileContents.length}`,
      `Estimated tokens: ${estimatedTokens}`,
      `Total characters: ${totalChars.toLocaleString()}`,
    ].filter(Boolean);

    const summary = summaryParts.join('\n');

    return res.json({
      summary,
      tree: `Directory structure:\n${treeText}`,
      content: fullContent,
      repo_name: `${owner}/${repo}`,
      files_analyzed: fileContents.length,
      estimated_tokens: estimatedTokens,
      total_chars: totalChars,
    });
  } catch (err: any) {
    if (clientDisconnected) return;
    console.error('Ingestion error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process repository ingestion' });
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanErr) {
      console.error('Failed to cleanup temp dir:', cleanErr);
    }
  }
});

function isBinaryBuffer(buf: Buffer): boolean {
  const maxBytes = Math.min(buf.length, 512);
  for (let i = 0; i < maxBytes; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
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

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`GitIngest server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

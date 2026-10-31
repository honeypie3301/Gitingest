import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import dotenv from 'dotenv';
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
]);

function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

// User & Token Status Endpoint
app.get('/api/user-status', async (_req, res) => {
  const envToken = process.env.GITHUB_TOKEN;
  if (!envToken) {
    return res.json({ configured: false, user: null });
  }

  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${envToken.trim()}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GitIngest-Custom',
      },
    });

    if (ghRes.ok) {
      const data = await ghRes.json();
      return res.json({
        configured: true,
        user: {
          login: data.login,
          avatar_url: data.avatar_url,
          name: data.name,
          html_url: data.html_url,
        },
      });
    }

    return res.json({ configured: true, user: null });
  } catch {
    return res.json({ configured: true, user: null });
  }
});

// High-speed Ingest Endpoint
app.post('/api/ingest', async (req, res) => {
  const { input_text, max_file_size = 50, pattern_type = 'exclude', pattern = '', token } = req.body;

  if (!input_text || typeof input_text !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid repository URL or path' });
  }

  const activeToken = (token || process.env.GITHUB_TOKEN || '').trim();

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

    const patterns = (pattern as string)
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const matchesPattern = (relPath: string, pat: string): boolean => {
      const p = pat.replace(/\./g, '\\.').replace(/\*/g, '.*');
      try {
        return new RegExp(p, 'i').test(relPath);
      } catch {
        return relPath.includes(pat);
      }
    };

    const isPathAllowed = (relPath: string): boolean => {
      if (patterns.length === 0) return true;
      const matched = patterns.some((p) => matchesPattern(relPath, p));
      return pattern_type === 'include' ? matched : !matched;
    };

    const maxBytes = max_file_size * 1024 * 1024;
    const collectedFiles: Array<{ relPath: string; fullPath: string; size: number }> = [];

    // Fast directory traversal
    function walkDirFast(currentDir: string) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.venv') continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(targetRoot, full).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          walkDirFast(full);
        } else if (entry.isFile()) {
          if (isBinaryExtension(rel)) continue;
          if (!isPathAllowed(rel)) continue;
          try {
            const stat = fs.statSync(full);
            if (stat.size <= maxBytes) {
              collectedFiles.push({ relPath: rel, fullPath: full, size: stat.size });
            }
          } catch {
            // skip
          }
        }
      }
    }

    walkDirFast(targetRoot);

    // Build directory tree
    const paths = collectedFiles.map((f) => f.relPath);
    const treeText = buildAsciiTree(subpath || repo, paths);

    // High-speed parallel chunked file reading
    const CHUNK_SIZE = 50;
    const fileContents: string[] = [];
    let totalChars = 0;

    for (let i = 0; i < collectedFiles.length; i += CHUNK_SIZE) {
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

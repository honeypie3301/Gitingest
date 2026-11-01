// server.ts
import express from "express";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import dotenv from "dotenv";
import JSZip from "jszip";

// src/services/githubRateLimit.ts
async function githubRateLimitMessage(response) {
  if (response.status !== 403 && response.status !== 429) return void 0;
  const body = await response.clone().text().catch(() => "");
  if (response.status !== 429 && response.headers.get("x-ratelimit-remaining") !== "0" && !/rate limit/i.test(body)) return void 0;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retry = Number(response.headers.get("retry-after"));
  const when = reset ? new Date(reset * 1e3).toISOString() : retry ? new Date(Date.now() + retry * 1e3).toISOString() : void 0;
  return `GitHub API rate limit exceeded.${when ? ` Retry after ${when}.` : " Retry after the rate limit resets."}`;
}

// lib/owner-auth.ts
var OWNER_GITHUB_LOGIN = (process.env.OWNER_GITHUB_LOGIN || "honeypie3301").toLowerCase();
var OWNER_GITHUB_ID = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
var OWNER_ACCESS_KEY = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || "honeypie3301-84184414").trim();
var verified = /* @__PURE__ */ new Map();
async function checkOwnerAuth(tokenOrKey) {
  if (!tokenOrKey || !tokenOrKey.trim()) {
    return { authorized: false, reason: "No authorization credentials provided." };
  }
  const clean = tokenOrKey.trim();
  if (OWNER_ACCESS_KEY && clean === OWNER_ACCESS_KEY) {
    return { authorized: true };
  }
  if ((verified.get(clean) || 0) > Date.now()) return { authorized: true };
  try {
    const ghRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${clean}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitIngest-OwnerAuth"
      }
    });
    if (!ghRes.ok) {
      const rateLimit = await githubRateLimitMessage(ghRes);
      if (rateLimit) return { authorized: false, status: 429, reason: rateLimit };
      return { authorized: false, reason: "Invalid GitHub token" };
    }
    const user = await ghRes.json();
    const isLoginMatch = user.login && user.login.toLowerCase() === OWNER_GITHUB_LOGIN;
    const isIdMatch = !OWNER_GITHUB_ID || user.id === OWNER_GITHUB_ID;
    if (isLoginMatch && isIdMatch) {
      for (const [key, expiry] of verified) if (expiry <= Date.now()) verified.delete(key);
      if (verified.size >= 100) verified.delete(verified.keys().next().value);
      verified.set(clean, Date.now() + 10 * 60 * 1e3);
      return { authorized: true };
    }
    return { authorized: false, reason: `Token belongs to @${user.login}, not owner @${OWNER_GITHUB_LOGIN}.` };
  } catch {
    return { authorized: false, reason: "Failed to verify token with GitHub." };
  }
}

// lib/worker-proxy.ts
async function forwardWorker(req, res, suffix, method, body) {
  const url = process.env.INGEST_WORKER_URL;
  const secret = process.env.INGEST_WORKER_SECRET;
  if (!url || !secret) return res.status(503).json({ error: "Ingestion worker is not configured." });
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.timeout(45e3)
    });
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(response.status).json(await response.json());
  } catch {
    return res.status(502).json({ error: "Ingestion worker unavailable. Please retry; browser ingestion was not started." });
  }
}
function submitWorkerJob(req, res) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : void 0;
  const incoming = bearer || req.body?.token;
  const ownerKey = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || "honeypie3301-84184414").trim();
  const token = incoming && incoming !== ownerKey ? incoming : process.env.GITHUB_TOKEN || "";
  return forwardWorker(req, res, "/jobs", "POST", { ...req.body, token });
}
async function handleWorkerJob(req, res) {
  const auth = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : req.body?.token || process.env.GITHUB_TOKEN;
  const check = await checkOwnerAuth(auth);
  if (!check.authorized) return res.status(check.status || 401).json({ error: check.reason || "Unauthorized" });
  const id = String(req.query?.id || req.params?.id || "");
  if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: "Invalid job ID." });
  if (!["GET", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed." });
  return forwardWorker(req, res, `/jobs/${id}`, req.method);
}

// server.ts
import { createServer as createViteServer } from "vite";
dotenv.config();
var execFileAsync = promisify(execFile);
var fsPromises = fs.promises;
var app = express();
var PORT = process.env.PORT || 3e3;
app.use(express.json({ limit: "50mb" }));
function sanitizeSubpath(subpath) {
  return subpath.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "");
}
function formatTokenCount(tokens) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}k`;
  return `${tokens}`;
}
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "ico",
  "webp",
  "bmp",
  "pdf",
  "zip",
  "tar",
  "gz",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "pyc",
  "pyo",
  "pyd",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "jar",
  "class",
  "lockb",
  "parquet",
  "feather",
  "wasm"
]);
function isBinaryExtension(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}
var OWNER_GITHUB_LOGIN2 = (process.env.OWNER_GITHUB_LOGIN || "honeypie3301").toLowerCase();
var OWNER_GITHUB_ID2 = process.env.OWNER_GITHUB_ID ? Number(process.env.OWNER_GITHUB_ID) : 84184414;
var OWNER_ACCESS_KEY2 = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || "honeypie3301-84184414").trim();
var tokenCache = /* @__PURE__ */ new Map();
var TOKEN_CACHE_TTL = 10 * 60 * 1e3;
var rateLimits = /* @__PURE__ */ new Map();
function checkRateLimit(key, limit, windowMs) {
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
async function verifyOwnerCredentials(tokenOrKey) {
  if (!tokenOrKey || !tokenOrKey.trim()) {
    return { authorized: false, reason: "No authorization credentials provided." };
  }
  let clean = tokenOrKey.trim();
  clean = clean.replace(/^["']|["']$/g, "").trim();
  clean = clean.replace(/^(bearer|token)\s+/i, "").trim();
  if (OWNER_ACCESS_KEY2 && clean === OWNER_ACCESS_KEY2) {
    return {
      authorized: true,
      user: {
        login: OWNER_GITHUB_LOGIN2,
        id: OWNER_GITHUB_ID2,
        name: "Owner",
        avatar_url: ""
      }
    };
  }
  const cached = tokenCache.get(clean);
  const now = Date.now();
  if (cached && cached.isOwner && now - cached.cachedAt < TOKEN_CACHE_TTL) {
    return { authorized: true, user: cached.user };
  }
  try {
    let ghRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${clean}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitIngest-OwnerAuth"
      }
    });
    if (!ghRes.ok && ghRes.status === 401) {
      ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${clean}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitIngest-OwnerAuth"
        }
      });
    }
    if (ghRes.status === 429 || ghRes.status === 403 && ghRes.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(ghRes.headers.get("x-ratelimit-reset"));
      return { authorized: false, status: 429, reason: `GitHub API rate limit exceeded.${reset ? ` Retry after ${new Date(reset * 1e3).toISOString()}.` : " Retry after the rate limit resets."}` };
    }
    if (!ghRes.ok && (ghRes.status === 403 || ghRes.status === 404)) {
      const repoCheck = await fetch(`https://api.github.com/repos/${OWNER_GITHUB_LOGIN2}/gitingest`, {
        headers: {
          Authorization: `Bearer ${clean}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitIngest-OwnerAuth"
        }
      });
      if (repoCheck.ok) {
        const repoData = await repoCheck.json();
        if (repoData.owner && repoData.owner.login.toLowerCase() === OWNER_GITHUB_LOGIN2) {
          const user = {
            id: repoData.owner.id,
            login: repoData.owner.login,
            avatar_url: repoData.owner.avatar_url || "",
            name: repoData.owner.login,
            html_url: repoData.owner.html_url
          };
          tokenCache.set(clean, { isOwner: true, user, cachedAt: now });
          return { authorized: true, user };
        }
      }
    }
    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => "");
      let errMsg = `GitHub API (${ghRes.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.message) {
          errMsg += `: ${parsed.message}`;
          if (parsed.message.includes("Bad credentials")) {
            errMsg += " \u2014 please check that the token is active and was copied completely.";
          } else if (parsed.message.includes("Resource not accessible")) {
            errMsg += " \u2014 if using a Fine-Grained PAT, ensure repository access is granted to your gitingest repository.";
          }
        }
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 100)}`;
      }
      return { authorized: false, reason: errMsg };
    }
    const userData = await ghRes.json();
    const isLoginMatch = userData.login && userData.login.toLowerCase() === OWNER_GITHUB_LOGIN2;
    const isIdMatch = !OWNER_GITHUB_ID2 || userData.id === OWNER_GITHUB_ID2;
    if (isLoginMatch && isIdMatch) {
      const user = {
        id: userData.id,
        node_id: userData.node_id,
        login: userData.login,
        avatar_url: userData.avatar_url,
        name: userData.name,
        html_url: userData.html_url
      };
      tokenCache.set(clean, { isOwner: true, user, cachedAt: now });
      return { authorized: true, user };
    }
    return {
      authorized: false,
      reason: `Unauthorized: Token belongs to @${userData.login}, not instance owner @${OWNER_GITHUB_LOGIN2}.`
    };
  } catch (err) {
    return { authorized: false, reason: `Failed to verify token: ${err.message}` };
  }
}
app.post("/api/verify-auth", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(`auth:${ip}`, 10, 5 * 60 * 1e3)) {
    return res.status(429).json({ error: "Too many authentication attempts. Please try again in 5 minutes." });
  }
  const { auth } = req.body || {};
  if (!auth || typeof auth !== "string") {
    return res.status(400).json({ error: "Authentication token or access key required" });
  }
  const check = await verifyOwnerCredentials(auth);
  if (check.authorized) {
    return res.json({ success: true, user: check.user });
  }
  return res.status(check.status || 401).json({ success: false, error: check.reason || "Invalid credentials" });
});
app.get("/api/user-status", async (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const tokenToCheck = bearerToken || process.env.GITHUB_TOKEN;
  if (!tokenToCheck) {
    return res.json({ configured: false, user: null, authorized: false });
  }
  const check = await verifyOwnerCredentials(tokenToCheck);
  return res.json({
    configured: true,
    authorized: check.authorized,
    user: check.user || null
  });
});
app.all("/api/ingest/jobs/:id", handleWorkerJob);
app.post("/api/ingest", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(`ingest:${ip}`, 30, 60 * 1e3)) {
    return res.status(429).json({ error: "Rate limit exceeded: max 30 ingestions per minute." });
  }
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const incomingToken = bearerToken || req.body.token || process.env.GITHUB_TOKEN;
  const authCheck = await verifyOwnerCredentials(incomingToken);
  if (!authCheck.authorized) {
    return res.status(authCheck.status || 401).json({
      error: authCheck.status === 429 ? authCheck.reason : `Unauthorized: ${authCheck.reason || "Valid owner Personal Access Token or access key is required."}`
    });
  }
  const { input_text, max_file_size = 50, pattern_type = "exclude", pattern = "", token } = req.body;
  if (!input_text || typeof input_text !== "string") {
    return res.status(400).json({ error: "Please provide a valid repository URL or path" });
  }
  if (process.env.INGEST_WORKER_URL) return submitWorkerJob(req, res);
  const activeToken = (bearerToken || token || process.env.GITHUB_TOKEN || "").trim();
  let clean = input_text.trim();
  clean = clean.replace(/^https?:\/\//i, "");
  clean = clean.replace(/^(?:www\.)?(?:github\.com|gitingest\.com)\//i, "");
  clean = clean.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/");
  if (parts.length < 2) {
    return res.status(400).json({ error: "Invalid URL. Expected format: owner/repo or https://github.com/owner/repo" });
  }
  const owner = parts[0];
  const repo = parts[1];
  let branch;
  let subpath;
  if (parts.length > 3 && (parts[2] === "tree" || parts[2] === "blob")) {
    branch = parts[3];
    if (parts.length > 4) {
      subpath = sanitizeSubpath(parts.slice(4).join("/"));
    }
  }
  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });
  const patterns = pattern.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
  const compiledPatterns = patterns.map((pat) => {
    const escaped = pat.replace(/\./g, "\\.").replace(/\*/g, ".*");
    try {
      return { regex: new RegExp(escaped, "i"), raw: pat };
    } catch {
      return { regex: null, raw: pat };
    }
  });
  const isPathAllowed = (relPath) => {
    if (compiledPatterns.length === 0) return true;
    const matched = compiledPatterns.some(({ regex, raw }) => regex ? regex.test(relPath) : relPath.includes(raw));
    return pattern_type === "include" ? matched : !matched;
  };
  const maxBytes = max_file_size * 1024 * 1024;
  try {
    let resolvedBranch = branch || "";
    let zipRes;
    const zipHeaders = {
      "User-Agent": "GitIngest-Fast"
    };
    if (activeToken) zipHeaders.Authorization = `Bearer ${activeToken}`;
    if (resolvedBranch) {
      zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(resolvedBranch)}`, {
        headers: zipHeaders,
        signal: abortController.signal
      });
    } else {
      const repoHeaders = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitIngest-Fast"
      };
      if (activeToken) repoHeaders.Authorization = `Bearer ${activeToken}`;
      const [repoMetaRes, zipMainRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: repoHeaders,
          signal: abortController.signal
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/main`, {
          headers: zipHeaders,
          signal: abortController.signal
        }).catch(() => null)
      ]);
      if (repoMetaRes.ok) {
        const repoMetaData = await repoMetaRes.json();
        resolvedBranch = repoMetaData.default_branch || "main";
      } else {
        resolvedBranch = "main";
      }
      if (resolvedBranch === "main" && zipMainRes && zipMainRes.ok) {
        zipRes = zipMainRes;
      } else {
        zipRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(resolvedBranch)}`, {
          headers: zipHeaders,
          signal: abortController.signal
        });
      }
    }
    if (zipRes && zipRes.ok) {
      const arrayBuf = await zipRes.arrayBuffer();
      if (arrayBuf.byteLength > 0 && arrayBuf.byteLength < 300 * 1024 * 1024) {
        const zip = await JSZip.loadAsync(arrayBuf);
        const fileKeys = Object.keys(zip.files);
        const firstKey = fileKeys[0] || "";
        const rootPrefix = firstKey.includes("/") ? firstKey.split("/")[0] + "/" : "";
        const fileEntries = [];
        const allPaths = [];
        for (const rawPath of fileKeys) {
          const obj = zip.files[rawPath];
          if (obj.dir) continue;
          const relPath = rootPrefix && rawPath.startsWith(rootPrefix) ? rawPath.substring(rootPrefix.length) : rawPath;
          if (!relPath || relPath.startsWith(".git/")) continue;
          if (subpath && !relPath.startsWith(subpath)) continue;
          if (isBinaryExtension(relPath)) continue;
          if (!isPathAllowed(relPath)) continue;
          allPaths.push(relPath);
          fileEntries.push({ relPath, obj });
        }
        const treeText = buildAsciiTree(subpath || repo, allPaths);
        const fileContents = [];
        let totalChars = 0;
        const MAX_ZIP_DIGEST_CHARS = 40 * 1024 * 1024;
        let isZipTruncated = false;
        const ZIP_CHUNK = 100;
        for (let i = 0; i < fileEntries.length; i += ZIP_CHUNK) {
          if (clientDisconnected) return;
          if (totalChars >= MAX_ZIP_DIGEST_CHARS) {
            isZipTruncated = true;
            break;
          }
          const chunk = fileEntries.slice(i, i + ZIP_CHUNK);
          const chunkResults = await Promise.all(
            chunk.map(async ({ relPath, obj }) => {
              try {
                const content = await obj.async("string");
                if (content.length > maxBytes || content.includes("\0")) return null;
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
                `================================================
File: ${item.relPath}
================================================
${item.content}
`
              );
              if (totalChars >= MAX_ZIP_DIGEST_CHARS) {
                isZipTruncated = true;
                break;
              }
            }
          }
        }
        if (isZipTruncated) {
          fileContents.push(`
[Notice: Codebase digest capped at 40MB for browser rendering stability. Use subpaths or pattern filters for targeted ingestion.]
`);
        }
        const estimatedTokens = formatTokenCount(Math.round(totalChars / 4));
        const summaryParts = [
          `Repository: ${owner}/${repo}`,
          resolvedBranch ? `Branch: ${resolvedBranch}` : null,
          subpath ? `Subpath: ${subpath}` : null,
          `Files analyzed: ${fileContents.length}`,
          `Estimated tokens: ${estimatedTokens}`,
          `Total characters: ${totalChars.toLocaleString()}`,
          isZipTruncated ? `(Digest capped at 40MB for browser rendering stability)` : null
        ].filter(Boolean);
        return res.json({
          summary: summaryParts.join("\n"),
          tree: `Directory structure:
${treeText}`,
          content: fileContents.join("\n"),
          repo_name: `${owner}/${repo}`,
          files_analyzed: fileContents.length,
          estimated_tokens: estimatedTokens,
          total_chars: totalChars
        });
      }
    }
  } catch (zipErr) {
    if (clientDisconnected) return;
  }
  const tempDir = path.join(os.tmpdir(), `gitingest_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  try {
    const cloneUrl = activeToken ? `https://x-access-token:${encodeURIComponent(activeToken)}@github.com/${owner}/${repo}.git` : `https://github.com/${owner}/${repo}.git`;
    const cloneArgs = [
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags"
    ];
    if (subpath) {
      cloneArgs.push("--filter=blob:none", "--no-checkout", "--sparse");
    }
    if (branch) {
      cloneArgs.push("-b", branch);
    }
    cloneArgs.push(cloneUrl, tempDir);
    try {
      await execFileAsync("git", cloneArgs, { timeout: 3e5 });
    } catch (gitErr) {
      const errMsg = gitErr.stderr || gitErr.message || "";
      if (errMsg.includes("could not read Username") || errMsg.includes("Authentication failed") || errMsg.includes("Repository not found")) {
        return res.status(403).json({
          error: `Could not access repository "${owner}/${repo}". If this is a private repository, please ensure your GitHub Personal Access Token is configured with 'repo' scope.`
        });
      }
      const fallbackArgs = ["clone", "--depth", "1", "--single-branch", "--no-tags"];
      if (branch) fallbackArgs.push("-b", branch);
      fallbackArgs.push(cloneUrl, tempDir);
      await execFileAsync("git", fallbackArgs, { timeout: 3e5 });
    }
    if (subpath) {
      try {
        await execFileAsync("git", ["-C", tempDir, "sparse-checkout", "set", subpath], { timeout: 3e4 });
        await execFileAsync("git", ["-C", tempDir, "checkout"], { timeout: 6e4 });
      } catch {
        try {
          await execFileAsync("git", ["-C", tempDir, "checkout"], { timeout: 6e4 });
        } catch {
        }
      }
    }
    const targetRoot = subpath ? path.join(tempDir, subpath) : tempDir;
    if (!fs.existsSync(targetRoot)) {
      return res.status(404).json({ error: `Subpath "${subpath}" does not exist in repository.` });
    }
    const collectedFiles = [];
    const PRUNED_DIR_NAMES = /* @__PURE__ */ new Set([
      ".git",
      "node_modules",
      ".venv",
      "venv",
      "dist",
      "build",
      "out",
      "target",
      ".next",
      ".nuxt",
      "coverage",
      ".cache",
      "vendor",
      "bin",
      "obj",
      ".gradle",
      ".idea",
      ".vscode",
      "__pycache__",
      ".turbo"
    ]);
    let usedGitLs = false;
    try {
      const { stdout: lsOut } = await execFileAsync("git", ["-C", targetRoot, "ls-files", "-z"], { timeout: 15e3 });
      const rawPaths = lsOut.split("\0").filter(Boolean);
      for (const rel of rawPaths) {
        if (isBinaryExtension(rel)) continue;
        if (!isPathAllowed(rel)) continue;
        const full = path.join(targetRoot, rel);
        try {
          const stat = await fsPromises.stat(full);
          if (stat.size <= maxBytes) {
            collectedFiles.push({ relPath: rel, fullPath: full, size: stat.size });
          }
        } catch {
        }
      }
      usedGitLs = true;
    } catch {
      usedGitLs = false;
    }
    if (!usedGitLs) {
      async function walkDirFast(currentDir) {
        const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
        await Promise.all(
          entries.map(async (entry) => {
            if (PRUNED_DIR_NAMES.has(entry.name)) return;
            const full = path.join(currentDir, entry.name);
            const rel = path.relative(targetRoot, full).replace(/\\/g, "/");
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
              }
            }
          })
        );
      }
      await walkDirFast(targetRoot);
    }
    const paths = collectedFiles.map((f) => f.relPath);
    const treeText = buildAsciiTree(subpath || repo, paths);
    const CHUNK_SIZE = 100;
    const fileContents = [];
    let totalChars = 0;
    const MAX_DIGEST_CHARS = 40 * 1024 * 1024;
    let isTruncated = false;
    for (let i = 0; i < collectedFiles.length; i += CHUNK_SIZE) {
      if (clientDisconnected) return;
      if (totalChars >= MAX_DIGEST_CHARS) {
        isTruncated = true;
        break;
      }
      const chunk = collectedFiles.slice(i, i + CHUNK_SIZE);
      const readResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const buf = await fsPromises.readFile(file.fullPath);
            if (isBinaryBuffer(buf)) {
              return {
                relPath: file.relPath,
                content: "[Binary file]",
                length: 13
              };
            }
            const content = buf.toString("utf-8");
            return {
              relPath: file.relPath,
              content,
              length: content.length
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
            `================================================
File: ${resItem.relPath}
================================================
${resItem.content}
`
          );
          if (totalChars >= MAX_DIGEST_CHARS) {
            isTruncated = true;
            break;
          }
        }
      }
    }
    if (isTruncated) {
      fileContents.push(`
[Notice: Codebase digest capped at 40MB for browser rendering stability. Use subpaths or pattern filters for targeted ingestion.]
`);
    }
    const fullContent = fileContents.join("\n");
    const estimatedTokens = formatTokenCount(Math.round(totalChars / 4));
    const summaryParts = [
      `Repository: ${owner}/${repo}`,
      branch ? `Branch: ${branch}` : null,
      subpath ? `Subpath: ${subpath}` : null,
      `Files analyzed: ${fileContents.length}`,
      `Estimated tokens: ${estimatedTokens}`,
      `Total characters: ${totalChars.toLocaleString()}`,
      isTruncated ? `(Digest capped at 40MB for browser rendering stability)` : null
    ].filter(Boolean);
    const summary = summaryParts.join("\n");
    return res.json({
      summary,
      tree: `Directory structure:
${treeText}`,
      content: fullContent,
      repo_name: `${owner}/${repo}`,
      files_analyzed: fileContents.length,
      estimated_tokens: estimatedTokens,
      total_chars: totalChars
    });
  } catch (err) {
    if (clientDisconnected) return;
    console.error("Ingestion error:", err);
    return res.status(500).json({ error: err.message || "Failed to process repository ingestion" });
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanErr) {
      console.error("Failed to cleanup temp dir:", cleanErr);
    }
    if (typeof global.gc === "function") {
      setImmediate(() => {
        try {
          global.gc();
        } catch {
        }
      });
    }
  }
});
function isBinaryBuffer(buf) {
  const maxBytes = Math.min(buf.length, 512);
  for (let i = 0; i < maxBytes; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
function buildAsciiTree(rootName, paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split("/");
    let curr = root;
    for (const part of parts) {
      if (!curr[part]) curr[part] = {};
      curr = curr[part];
    }
  }
  function render(node, prefix = "") {
    const keys = Object.keys(node).sort((a, b) => {
      const aIsDir = Object.keys(node[a]).length > 0;
      const bIsDir = Object.keys(node[b]).length > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });
    let result = "";
    keys.forEach((key, index) => {
      const isLast = index === keys.length - 1;
      const isDir = Object.keys(node[key]).length > 0;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      result += `${prefix}${connector}${key}${isDir ? "/" : ""}
`;
      if (isDir) {
        result += render(node[key], prefix + (isLast ? "    " : "\u2502   "));
      }
    });
    return result;
  }
  return `\u2514\u2500\u2500 ${rootName}/
${render(root, "    ")}`;
}
async function startServer() {
  try {
    const tmp = os.tmpdir();
    const files = await fsPromises.readdir(tmp);
    for (const f of files) {
      if (f.startsWith("gitingest_")) {
        await fsPromises.rm(path.join(tmp, f), { recursive: true, force: true }).catch(() => {
        });
      }
    }
  } catch {
  }
  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fs.existsSync(path.join(distPath, "index.html"));
  if (process.env.NODE_ENV === "production" || hasDist) {
    app.use(express.static(distPath, { maxAge: "1d" }));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`GitIngest server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();

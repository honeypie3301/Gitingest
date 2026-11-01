import { checkOwnerAuth } from './owner-auth.js';

export async function forwardWorker(req: any, res: any, suffix: string, method: string, body?: unknown) {
  const url = process.env.INGEST_WORKER_URL;
  const secret = process.env.INGEST_WORKER_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'Ingestion worker is not configured.' });
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(response.status).json(await response.json());
  } catch { return res.status(502).json({ error: 'Ingestion worker unavailable. Please retry; browser ingestion was not started.' }); }
}

export function submitWorkerJob(req: any, res: any) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : undefined;
  const incoming = bearer || req.body?.token;
  const ownerKey = (process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414').trim();
  const token = incoming && incoming !== ownerKey ? incoming : process.env.GITHUB_TOKEN || '';
  return forwardWorker(req, res, '/jobs', 'POST', { ...req.body, token });
}

export async function handleWorkerJob(req: any, res: any) {
  const auth = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : req.body?.token || process.env.GITHUB_TOKEN;
  const check = await checkOwnerAuth(auth);
  if (!check.authorized) return res.status(check.status || 401).json({ error: check.reason || 'Unauthorized' });
  const id = String(req.query?.id || req.params?.id || '');
  if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid job ID.' });
  if (!['GET', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  return forwardWorker(req, res, `/jobs/${id}`, req.method);
}

export class GitHubRateLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'GitHubRateLimitError'; }
}

export async function githubRateLimitMessage(response: Response): Promise<string | undefined> {
  if (response.status !== 403 && response.status !== 429) return undefined;
  const body = await response.clone().text().catch(() => '');
  if (response.status !== 429 && response.headers.get('x-ratelimit-remaining') !== '0' && !/rate limit/i.test(body)) return undefined;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const retry = Number(response.headers.get('retry-after'));
  const when = reset ? new Date(reset * 1000).toISOString() : retry ? new Date(Date.now() + retry * 1000).toISOString() : undefined;
  return `GitHub API rate limit exceeded.${when ? ` Retry after ${when}.` : ' Retry after the rate limit resets.'}`;
}

export async function assertNotRateLimited(response: Response) {
  const message = await githubRateLimitMessage(response);
  if (message) throw new GitHubRateLimitError(message);
}

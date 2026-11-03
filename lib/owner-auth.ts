import { githubRateLimitMessage } from '../src/services/githubRateLimit';

export async function checkOwnerAuth(_tokenOrKey?: string): Promise<{ authorized: boolean; reason?: string; status?: number }> {
  // Public mode: Anyone is authorized to use public ingestion
  return { authorized: true };
}

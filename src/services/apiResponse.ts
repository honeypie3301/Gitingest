/** Hosting errors can be plain text or HTML even when an API normally returns JSON. */
export async function readApiResponse<T extends object = Record<string, any>>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); }
  catch {
    const serverFailure = response.status >= 500;
    const detail = serverFailure
      ? 'The server function failed. Check the deployment runtime logs.'
      : 'The server returned an unexpected response.';
    throw new Error(`${context} (HTTP ${response.status}). ${detail}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${context} (HTTP ${response.status}). The server returned an unexpected response.`);
  }
  return data as T;
}

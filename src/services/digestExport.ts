import type { IngestResponse } from '../types';

export async function artifactUrl(result: IngestResponse) {
  return result.refreshArtifactUrl ? result.refreshArtifactUrl() : result.artifact_url!;
}

export async function fullDigestSection(result: IngestResponse, section: 'all' | 'tree' | 'content') {
  if (section === 'tree' && !result.tree_preview_truncated) return result.tree;
  if (section === 'content' && !result.content_preview_truncated) return result.content;
  if (!result.artifact_url) return `${result.summary}\n\n${result.tree}\n\n${result.content}`;
  const response = await fetch(await artifactUrl(result));
  if (!response.ok) throw new Error('Export link expired or unavailable. Please ingest again.');
  const digest = await response.text();
  if (section === 'tree') return digest.slice(result.summary.length + 2, result.content_offset! - 2);
  if (section === 'content') return digest.slice(result.content_offset);
  return digest;
}

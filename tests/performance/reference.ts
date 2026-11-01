import JSZip from 'jszip';
import { formatTokens, isBinaryPath } from '../../src/services/ingestFormatting';
import type { ArchiveOptions } from '../../worker/archive';

// Keep the original comparator here: using the optimized tree builder would understate the baseline.
function legacyTree(rootName: string, paths: string[]) {
  interface Node { [key: string]: Node }
  const root: Node = {};
  for (const filename of paths) {
    let current = root;
    for (const part of filename.split('/')) {
      if (!current[part]) current[part] = {};
      current = current[part];
    }
  }
  function render(node: Node, prefix = ''): string {
    const keys = Object.keys(node).sort((a, b) => {
      const aDir = Object.keys(node[a]).length > 0;
      const bDir = Object.keys(node[b]).length > 0;
      return aDir !== bDir ? (aDir ? -1 : 1) : a.localeCompare(b);
    });
    let text = '';
    keys.forEach((key, index) => {
      const last = index === keys.length - 1;
      const directory = Object.keys(node[key]).length > 0;
      text += `${prefix}${last ? '└── ' : '├── '}${key}${directory ? '/' : ''}\n`;
      if (directory) text += render(node[key], prefix + (last ? '    ' : '│   '));
    });
    return text;
  }
  return `└── ${rootName}/\n${render(root, '    ')}`;
}

/** Original Vercel selection, sequential JSZip decoding and formatting, retained as a test oracle. */
export async function referenceIngest(bytes: Buffer, options: ArchiveOptions) {
  const zip = await JSZip.loadAsync(bytes);
  const keys = Object.keys(zip.files);
  const first = keys[0] || '';
  const prefix = first.includes('/') ? first.split('/')[0] + '/' : '';
  const patterns = (options.pattern || '').split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
  const allowed = (name: string) => {
    if (options.subpath && !name.startsWith(options.subpath)) return false;
    if (!patterns.length) return true;
    const matches = patterns.some(pat => {
      try { return new RegExp(pat.replace(/\./g, '\\.').replace(/\*/g, '.*'), 'i').test(name); }
      catch { return name.includes(pat); }
    });
    return options.pattern_type === 'include' ? matches : !matches;
  };
  const paths: string[] = [];
  const blocks: string[] = [];
  let totalChars = 0;
  for (const key of keys) {
    const obj = zip.files[key];
    if (obj.dir) continue;
    const name = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
    if (!name || name.startsWith('.git/') || isBinaryPath(name) || !allowed(name)) continue;
    paths.push(name);
    const content = await obj.async('string');
    if (content.length > (options.max_file_size ?? 50) * 1024 * 1024 || content.includes('\0')) continue;
    totalChars += content.length;
    blocks.push(`================================================\nFile: ${name}\n================================================\n${content}\n`);
  }
  const estimated = formatTokens(Math.round(totalChars / 4));
  const summary = [
    `Repository: ${options.owner}/${options.repo}`, `Branch: ${options.branch}`,
    options.subpath ? `Subpath: ${options.subpath}` : null,
    `Files analyzed: ${blocks.length}`, `Estimated tokens: ${estimated}`,
    `Total characters: ${totalChars.toLocaleString()}`,
  ].filter(Boolean).join('\n');
  const tree = `Directory structure:\n${legacyTree(options.subpath || options.repo, paths)}`;
  const content = blocks.join('\n');
  return { summary, tree, content, digest: `${summary}\n\n${tree}\n\n${content}`, files_analyzed: blocks.length, total_chars: totalChars };
}

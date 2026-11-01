const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'pdf', 'zip', 'tar',
  'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'pyc', 'pyo', 'pyd',
  'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'mov', 'wav', 'jar',
  'class', 'lockb', 'parquet', 'feather', 'wasm',
]);

export function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

export function parseGitHubUrl(input: string): {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
} | null {
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/^(?:www\.)?(?:github\.com|gitingest\.com)\//i, '');
  clean = clean.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');

  const parts = clean.split('/');
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1];
  let branch: string | undefined;
  let subpath: string | undefined;

  if (parts.length > 3 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    branch = parts[3];
    if (parts.length > 4) {
      subpath = parts.slice(4).join('/');
    }
  }

  return { owner, repo, branch, subpath };
}

export function buildAsciiTree(rootName: string, paths: string[]): string {
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
    const directories = new Set(Object.keys(node).filter((key) => Object.keys(node[key]).length > 0));
    const keys = Object.keys(node).sort((a, b) => {
      const aIsDir = directories.has(a);
      const bIsDir = directories.has(b);
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    let result = '';
    keys.forEach((key, index) => {
      const isLast = index === keys.length - 1;
      const isDir = directories.has(key);
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


import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('serverless entrypoints load and respond under native Node ESM without tsx or bundling', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  const output = await mkdtemp(path.join(root, 'dist', 'esm-test-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const compiled = new Set<string>();
  async function compile(relative: string) {
    if (compiled.has(relative)) return;
    compiled.add(relative);
    const source = await readFile(path.join(root, relative), 'utf8');
    const transpiled = await build({
      stdin: { contents: source, sourcefile: relative, loader: 'ts' },
      target: 'es2022', format: 'esm', platform: 'node', bundle: false,
      write: false, metafile: true, logLevel: 'silent',
    });
    const js = transpiled.outputFiles[0].text;
    const filename = path.join(output, relative.replace(/\.ts$/, '.js'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, js);
    for (const dependency of Object.values(transpiled.metafile.outputs).flatMap(output => output.imports)) {
      const specifier = dependency.path;
      if (!specifier.startsWith('.')) continue;
      assert.ok(specifier.endsWith('.js'), `${relative} must use an explicit .js runtime import: ${specifier}`);
      await compile(path.join(path.dirname(relative), specifier.replace(/\.js$/, '.ts')));
    }
  }
  const entrypoints = ['api/verify-auth.ts', 'api/ingest.ts', 'api/ingest/jobs/[id].ts'];
  for (const relative of entrypoints) await compile(relative);
  const script = `
    import { pathToFileURL } from 'node:url';
    const root = process.argv[1];
    for (const [relative, expected] of ${JSON.stringify(entrypoints.map((name, index) => [name.replace(/\.ts$/, '.js'), index === 2 ? 401 : 405]))}) {
      const { default: handler } = await import(pathToFileURL(root + '/' + relative));
      let status = 200, result;
      const response = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
      await handler({ method: 'GET', headers: {}, query: {} }, response);
      if (status !== expected || typeof result?.error !== 'string') throw new Error(relative + ' did not respond correctly');
    }
    console.log('Native Node ESM entrypoints passed.');
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, output], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '', GITHUB_TOKEN: '' }, windowsHide: true,
  });
  assert.match(result.stdout, /Native Node ESM entrypoints passed/);
});

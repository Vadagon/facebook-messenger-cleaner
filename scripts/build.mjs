import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { build, transform } from 'esbuild';
import { ZipArchive } from 'archiver';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(projectRoot, 'dist');
const archivePath = path.join(projectRoot, 'dist.zip');
const fromRoot = (...parts) => path.join(projectRoot, ...parts);
const inDist = (...parts) => path.join(outputRoot, ...parts);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.rm(archivePath, { force: true });
await fs.mkdir(inDist('src', 'panel'), { recursive: true });
await fs.mkdir(inDist('src', 'background'), { recursive: true });
await fs.mkdir(inDist('src', 'lib'), { recursive: true });

await Promise.all([
  fs.copyFile(fromRoot('manifest.json'), inDist('manifest.json')),
  fs.cp(fromRoot('_locales'), inDist('_locales'), { recursive: true }),
  fs.cp(fromRoot('icons'), inDist('icons'), { recursive: true }),
  fs.cp(fromRoot('assets'), inDist('assets'), { recursive: true })
]);

await fs.copyFile(fromRoot('src', 'panel', 'facebook.html'), inDist('src', 'panel', 'facebook.html'));
const css = await fs.readFile(fromRoot('src', 'panel', 'facebook.css'), 'utf8');
const minifiedCss = await transform(css, { loader: 'css', minify: true, target: 'chrome114' });
await fs.writeFile(inDist('src', 'panel', 'facebook.css'), minifiedCss.code);

const sharedBuild = {
  bundle: true,
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  target: 'chrome114',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' }
};

await Promise.all([
  build({
    ...sharedBuild,
    entryPoints: [fromRoot('src', 'react', 'facebook.jsx')],
    outfile: inDist('src', 'panel', 'facebook.js'),
    format: 'esm',
    loader: { '.html': 'text' }
  }),
  build({
    ...sharedBuild,
    entryPoints: [fromRoot('src', 'background', 'service-worker.js')],
    outfile: inDist('src', 'background', 'service-worker.js'),
    format: 'esm'
  }),
  build({
    ...sharedBuild,
    entryPoints: [fromRoot('src', 'lib', 'facebook-content.js')],
    outfile: inDist('src', 'lib', 'facebook-content.js'),
    format: 'iife'
  })
]);

const manifest = JSON.parse(await fs.readFile(inDist('manifest.json'), 'utf8'));
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap(script => script.js || [])
].filter(Boolean);

for (const relativePath of requiredFiles) {
  await fs.access(inDist(...relativePath.split('/')));
}

await new Promise((resolve, reject) => {
  const output = createWriteStream(archivePath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(outputRoot, false);
  archive.finalize();
});

const archiveStat = await fs.stat(archivePath);
console.log(`Built Chrome Web Store package v${manifest.version}`);
console.log(`Unpacked: ${outputRoot}`);
console.log(`Upload ZIP: ${archivePath} (${Math.ceil(archiveStat.size / 1024)} KB)`);

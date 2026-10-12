import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const assets = [
  'index.html', 'styles.css', 'app.mjs', 'map.mjs',
  'engine.mjs', 'worker.mjs', 'data/map.json',
  // 3D Algorithm Lab: loaded on demand, all served locally (no CDN).
  'lab3d.mjs', 'trace-player.mjs', 'teaching-graph.mjs', 'lab-colors.mjs',
  'scene3d.mjs', 'lab-flat.mjs', 'lab-animation.mjs',
  'vendor/three/three.module.js', 'vendor/three/three.core.js',
  'vendor/three/OrbitControls.js', 'vendor/three/LICENSE'
];

// Publish only the browser application. The local server and source extract
// remain in the repository; neither is needed by a static host.
// Every relative module import must be part of the build, or the static site breaks.
const published = new Set(assets);
for (const asset of assets.filter(a => /\.(mjs|js)$/.test(a))) {
  const source = await readFile(path.join(root, asset), 'utf8');
  for (const [, spec] of source.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(asset), spec));
    if (!published.has(target)) throw new Error(`${asset} imports ${spec}, which is not in the build list`);
  }
  for (const [, spec] of source.matchAll(/new Worker\(\s*['"]\.\/([^'"]+)['"]/g))
    if (!published.has(spec)) throw new Error(`${asset} starts worker ${spec}, which is not in the build list`);
}

await rm(output, { recursive: true, force: true });
let bytes = 0;
for (const asset of assets) {
  const destination = path.join(output, asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, asset), destination);
  bytes += (await stat(destination)).size;
}
console.log(`Built ${assets.length} static files in dist/ (${(bytes / 1024).toFixed(0)} KB).`);

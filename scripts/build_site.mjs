import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const assets = [
  'index.html', 'styles.css', 'app.mjs', 'map.mjs',
  'engine.mjs', 'worker.mjs', 'data/map.json'
];

// Publish only the browser application. The local server and source extract
// remain in the repository; neither is needed by a static host.
let bytes = 0;
for (const asset of assets) {
  const destination = path.join(output, asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, asset), destination);
  bytes += (await stat(destination)).size;
}
console.log(`Built ${assets.length} static files in dist/ (${(bytes / 1024).toFixed(0)} KB).`);

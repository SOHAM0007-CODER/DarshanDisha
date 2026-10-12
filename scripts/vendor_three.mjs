// Refresh the locally served Three.js files used by the 3D Algorithm Lab.
// Usage: node scripts/vendor_three.mjs [path-to-extracted-three-package]
// Without an argument, the pinned version is fetched once with `npm pack`.
// The browser never loads Three.js from a CDN; the copied files are committed.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.186.1';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'vendor', 'three');

let source = process.argv[2], temporary;
if (!source) {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'three-'));
  execFileSync('npm', ['pack', `three@${VERSION}`, '--silent'], { cwd: temporary, shell: true });
  execFileSync('tar', ['-xzf', `three-${VERSION}.tgz`], { cwd: temporary, shell: true });
  source = path.join(temporary, 'package');
}

const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) throw new Error(`Expected three@${VERSION}, found ${pkg.version}`);
await mkdir(output, { recursive: true });
await copyFile(path.join(source, 'build', 'three.module.js'), path.join(output, 'three.module.js'));
await copyFile(path.join(source, 'build', 'three.core.js'), path.join(output, 'three.core.js'));
await copyFile(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
// OrbitControls imports the bare specifier 'three'. Rewriting it to a relative
// path avoids an import map and keeps the module loadable from any static host.
const controls = await readFile(path.join(source, 'examples', 'jsm', 'controls', 'OrbitControls.js'), 'utf8');
if (!controls.includes("from 'three';")) throw new Error('Unexpected OrbitControls import');
await writeFile(path.join(output, 'OrbitControls.js'), controls.replace("from 'three';", "from './three.module.js';"));
await writeFile(path.join(output, 'VERSION'), `three@${VERSION} (MIT). Files: build/three.module.js, build/three.core.js, examples/jsm/controls/OrbitControls.js (import path rewritten).\n`);
if (temporary) await rm(temporary, { recursive: true, force: true });
console.log(`Vendored three@${VERSION} into vendor/three/.`);

// Packs the built extension (dist/) into release/<name>-v<version>.zip
// ready to share for unpacked installation. Run via `npm run zip` which
// builds first.

import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');

if (!existsSync(distDir)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outName = `${pkg.name}-v${pkg.version}.zip`;

mkdirSync(releaseDir, { recursive: true });

const zip = new AdmZip();
zip.addLocalFolder(distDir);

const outPath = path.join(releaseDir, outName);
zip.writeZip(outPath);

const sizeKb = (zip.toBuffer().length / 1024).toFixed(1);
console.log(`Wrote ${path.relative(root, outPath)} (${sizeKb} KB)`);

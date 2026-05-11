// Packs the built extension (dist/) into release/<name>-v<version>.zip
// ready to share for unpacked installation. Run via `npm run zip` which
// builds first.

import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');
const manifestPath = path.join(distDir, 'manifest.json');

if (!existsSync(distDir) || !existsSync(manifestPath)) {
  console.error('dist/ or dist/manifest.json missing — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Keep the shipped manifest version in lockstep with package.json so the GitHub
// tag, zip filename, and the manifest Chrome reads all agree on the version.
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced dist/manifest.json version → ${pkg.version}`);
}

const outName = `${pkg.name}-v${pkg.version}.zip`;
mkdirSync(releaseDir, { recursive: true });

const zip = new AdmZip();
zip.addLocalFolder(distDir);
const outPath = path.join(releaseDir, outName);
zip.writeZip(outPath);

const sizeKb = (zip.toBuffer().length / 1024).toFixed(1);
console.log(`Wrote ${path.relative(root, outPath)} (${sizeKb} KB)`);

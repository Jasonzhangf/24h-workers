#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

if (process.env.DRUDGE_SKIP_BUMP === '1' || process.env.DRUDGE_SKIP_BUMP === 'true') {
  console.log('Version bump skipped (DRUDGE_SKIP_BUMP)');
  process.exit(0);
}

const pkgPath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version || '0.0.0000';
const parts = version.split('.');
if (parts.length !== 3) {
  console.error(`Invalid version format: ${version}`);
  process.exit(1);
}

const [major, minor, patchRaw] = parts;
const patchNum = parseInt(patchRaw, 10);
if (Number.isNaN(patchNum)) {
  console.error(`Invalid patch version: ${patchRaw}`);
  process.exit(1);
}

const nextPatch = String(patchNum + 1).padStart(4, '0');
const nextVersion = `${major}.${minor}.${nextPatch}`;

pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Version bumped: ${version} -> ${nextVersion}`);

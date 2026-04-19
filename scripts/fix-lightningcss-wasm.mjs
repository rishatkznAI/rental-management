import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

function ensureTailwindOxideWasmPackage() {
  const oxidePkgPath = path.resolve('node_modules/@tailwindcss/oxide/package.json');
  const targetDir = path.resolve('node_modules/@tailwindcss/oxide-wasm32-wasi');

  if (!fs.existsSync(oxidePkgPath) || fs.existsSync(targetDir)) {
    return;
  }

  const { version } = JSON.parse(fs.readFileSync(oxidePkgPath, 'utf8'));
  const tarballUrl = `https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-${version}.tgz`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-oxide-wasi-'));
  const tarballPath = path.join(tempDir, 'oxide-wasm32-wasi.tgz');

  try {
    execFileSync('curl', ['-fsSL', tarballUrl, '-o', tarballPath], { stdio: 'inherit' });
    fs.mkdirSync(targetDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarballPath, '-C', targetDir, '--strip-components=1'], { stdio: 'inherit' });
    console.log(`Installed @tailwindcss/oxide-wasm32-wasi@${version} for WASI fallback`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

ensureTailwindOxideWasmPackage();

const target = path.resolve('node_modules/lightningcss/node/index.js');

if (!fs.existsSync(target)) {
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');
const from = "module.exports = require(`../pkg`);";
const to = "module.exports = require('lightningcss-wasm');";

if (!source.includes(from) || source.includes(to)) {
  process.exit(0);
}

fs.writeFileSync(target, source.replace(from, to));
console.log('Patched lightningcss to use lightningcss-wasm when CSS_TRANSFORMER_WASM=1');

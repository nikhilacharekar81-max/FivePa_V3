import fs from 'fs';
import path from 'path';

const serverTsPath = new URL('../server.ts', import.meta.url);
const serverJsPath = new URL('../server.js', import.meta.url);

if (!fs.existsSync(serverJsPath)) {
  console.error('[FAIL] server.js does not exist. Run `npm run build` first.');
  process.exit(1);
}

const serverTsStat = fs.statSync(serverTsPath);
const serverJsStat = fs.statSync(serverJsPath);

if (serverJsStat.mtimeMs < serverTsStat.mtimeMs) {
  console.error('[FAIL] server.js is older than server.ts. Rebuild with `npm run build`.');
  process.exit(1);
}

console.log('[PASS] server.js is up to date with server.ts.');
process.exit(0);

// Records which version of server.ts the generated server.js was built from.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const hash = createHash('sha256').update(fs.readFileSync('server.ts')).digest('hex');
fs.writeFileSync('server.build-stamp.json', JSON.stringify({ serverTsSha256: hash, builtAt: new Date().toISOString() }, null, 2));
console.log(`Build stamp written for server.ts (${hash.slice(0, 12)}…)`);

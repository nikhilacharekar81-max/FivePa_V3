// Render-boundary safety: user content is stored as typed; the UI must never execute it.
// Run with: npx tsx tests/safe-file-link.test.ts
import assert from 'node:assert/strict';
import { classifyFileUrl } from '../src/utils/safeFileLink.js';

const text = [
  'javascript:alert(1)', '  JaVa\tScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>',
  'Sent via courier, tracking 12345', '', '#', 'ftp://example.com/file', '//evil.example.com/x', '/admin',
  'https:alert(1)', 'http//missing-colon', 'x'.repeat(100000)
];
for (const t of text) assert.strictEqual(classifyFileUrl(t).kind, 'text', `must stay plain text: ${t.slice(0, 40)}`);

for (const u of ['https://example.com/a', 'http://anything.invalid/broken', 'HTTPS://Example.com/Path?q=1', 'https://example.com/' + 'a'.repeat(5000)])
  assert.strictEqual(classifyFileUrl(u).kind, 'web', `plain http(s) link: ${u.slice(0, 40)}`);

assert.strictEqual(classifyFileUrl('/api/workstream/files/1_ab_x.pdf').kind, 'stored');
assert.strictEqual(classifyFileUrl(undefined).kind, 'text');
assert.strictEqual(classifyFileUrl({ a: 1 } as any).kind, 'text');
// only 'web' values are ever opened, and the normalised href is always http(s)
assert.ok(/^https?:/.test(classifyFileUrl('https://example.com/').url));
console.log('[PASS] safeFileLink: executable/odd content is text-only; http(s) opens safely; uploads use the authenticated path');

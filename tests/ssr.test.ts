/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

process.env.PORT = '3005';
(process.env as any).NODE_ENV = 'test';

import assert from 'node:assert';
import { gigs } from '../server.js';

const PORT = 3005;
const BASE = `http://localhost:${PORT}`;

async function runTests() {
  console.log('--- STARTING SSR & SEO TESTS ---');

  // Import server to start it
  await import('../server.ts');

  // Wait for server to start listening
  await new Promise(r => setTimeout(r, 1500));

  // 1. GET / (Home) returns 200 and has no noindex
  const homeRes = await fetch(`${BASE}/`);
  const homeHtml = await homeRes.text();
  assert.strictEqual(homeRes.status, 200, 'Home should return 200');
  assert.strictEqual(homeHtml.includes('noindex'), false, 'Home page must not contain noindex');
  console.log('  ✅ GET / returns 200 and has no noindex');

  // 2. GET a valid gig URL returns 200 and contains the gig title in the HTML
  if (gigs.length > 0) {
    const sampleGig = gigs[0];
    const uname = (sampleGig.freelancerUsername || 'elena_rostova').toLowerCase();
    const gslug = (sampleGig.slug || sampleGig.title.toLowerCase().replace(/\s+/g, '-'));
    const gigUrl = `/${uname}/${gslug}`;

    const gigRes = await fetch(`${BASE}${gigUrl}`);
    const gigHtml = await gigRes.text();
    assert.strictEqual(gigRes.status, 200, `Valid gig URL ${gigUrl} should return 200`);
    assert.strictEqual(gigHtml.includes(sampleGig.title), true, `HTML should contain gig title: "${sampleGig.title}"`);
    console.log(`  ✅ GET ${gigUrl} returns 200 and contains gig title`);
  }

  // 4. GET /gigs -> 200, no noindex
  const gigsRes = await fetch(`${BASE}/gigs`);
  const gigsHtml = await gigsRes.text();
  assert.strictEqual(gigsRes.status, 200, '/gigs should return 200');
  assert.strictEqual(gigsHtml.includes('noindex'), false, '/gigs must not contain noindex');
  console.log('  ✅ GET /gigs returns 200 and has no noindex');

  // 5. GET /projects -> 200
  const projsRes = await fetch(`${BASE}/projects`);
  assert.strictEqual(projsRes.status, 200, '/projects should return 200');
  console.log('  ✅ GET /projects returns 200');

  // 6. GET /admin -> noindex, nofollow
  const adminRes = await fetch(`${BASE}/admin`);
  const adminHtml = await adminRes.text();
  assert.strictEqual(adminHtml.includes('noindex'), true, '/admin should contain noindex');
  assert.strictEqual(adminHtml.includes('nofollow'), true, '/admin should contain nofollow');
  console.log('  ✅ GET /admin returns noindex, nofollow');

  console.log('🎉 ALL SSR & SEO TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('SSR Test failed:', err);
  process.exit(1);
});

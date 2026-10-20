// Regression guards for the wiring gaps found in the fee audit.
// Run with: npx tsx tests/fee-wiring.test.ts
// These are source-level checks: they fail loudly if someone re-introduces trusted client prices,
// hardcoded legacy rates, or ships a stale compiled server.js.
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
const assert = (cond: boolean, name: string, details = '') => {
  if (cond) { console.log(`[PASS] ${name}`); passed++; } else { console.error(`[FAIL] ${name} ${details}`); failed++; }
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const server = read('server.ts');

// 1. POST /api/orders must price gig orders on the server, not from req.body.amount.
const ordersIdx = server.indexOf("post('/api/orders', requireAuth");
const ordersRoute = server.slice(ordersIdx >= 0 ? ordersIdx : 0);
const ordersBody = ordersRoute.slice(0, ordersRoute.indexOf("handleDeliverSubmission") >= 0 ? ordersRoute.indexOf("handleDeliverSubmission") : ordersRoute.length);
assert(ordersBody.includes('resolveGigOrderPrice('), 'POST /api/orders prices gig orders server-side (resolveGigOrderPrice)');
assert(ordersBody.indexOf('resolveGigOrderPrice(') < ordersBody.indexOf('fundOrderEscrowWithEvent('), 'Server price is resolved before escrow is funded');

// 2. Startup + admin save must push every fee rule into the ledger.
const serverCode = read('server.ts') + read('src/server/siteSettings.ts');
const configureCalls = serverCode.match(/financeLedger\.configure\(\{[\s\S]*?\}\);/g) || [];
assert(configureCalls.length >= 2 && configureCalls.every(c => c.includes('buyerFeePercent') && c.includes('smallOrderFee') && c.includes('smallOrderThreshold')),
  'Every financeLedger.configure() call carries commission + client fee + small-order fee + threshold');

// 3. No stale hardcoded rates in the money paths.
assert(!/o\.amount \* 0\.9|ord\.amount \* 0\.9|amount \* 0\.10/.test(server), 'No hardcoded 90% / 10% maths left in server.ts');
assert(!/buyerProcessingFeeRate: 3,/.test(server), 'Legacy 3% client-fee default is gone');
assert(!/numericBid \* 0\.10/.test(read('src/components/marketplace/ProjectDetailView.tsx')), 'Proposal fee preview no longer uses a hardcoded 10%');

// 4. Compiled bundle (what `npm start` runs) must contain the fee engine. Rebuild with `npm run build` if this fails.
if (existsSync(new URL('../server.js', import.meta.url))) {
  const bundle = read('server.js');
  assert(bundle.includes('calculateOrderFees') && bundle.includes('smallOrderThreshold'), 'server.js bundle is built from the current fee engine (run `npm run build` if this fails)');
  assert(!/platformCommissionRate = 10;/.test(bundle), 'server.js bundle does not hard-wire a 10% commission');
}

console.log(`\nFEE WIRING SUMMARY: ${passed} PASSED, ${failed} FAILED`);
process.exit(failed ? 1 : 0);

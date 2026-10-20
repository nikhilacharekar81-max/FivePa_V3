// Fee structure tests: 20% freelancer commission, 5.5% client service fee, $3.50 small-order fee under $200.
// Run with: npx tsx tests/fees.test.ts
import { FinanceLedgerEngine } from '../src/server/financeLedger.js';
import { calculateOrderFees, DEFAULT_FEE_CONFIG } from '../src/shared/fees.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, details?: string) {
  if (cond) { console.log(`[PASS] ${name}`); passed++; } else { console.error(`[FAIL] ${name} - ${details || ''}`); failed++; }
}
function throws(fn: () => unknown, name: string, contains?: string) {
  try { fn(); assert(false, name, 'expected an error'); } catch (e: any) { assert(!contains || String(e.message).includes(contains), name, `got: ${e.message}`); }
}
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function freshEngine(buyerFunds = 100000) {
  const e = new FinanceLedgerEngine();
  e.ensureWallet({ userId: 'buyer1', name: 'Buyer', email: 'b@x.com', role: 'buyer' });
  e.ensureWallet({ userId: 'free1', name: 'Freelancer', email: 'f@x.com', role: 'freelancer' });
  e.creditDeposit({ userId: 'buyer1', amount: buyerFunds, reference: 'seed', idempotencyKey: 'seed-' + Math.random(), actor: 'test' });
  return e;
}
const ok = (e: FinanceLedgerEngine) => e.getInvariants().every(i => i.ok) && e.getFinancialOverview().trialBalanceInBalance;
const fund = (e: FinanceLedgerEngine, id: string, amount: number) =>
  e.fundEscrow({ orderId: id, orderTitle: 'Test gig', amount, buyerId: 'buyer1', sellerId: 'free1', actor: 'test' });

function run() {
  // ---- pure math ----
  let f = calculateOrderFees(50);
  assert(eq(f.serviceFee, 2.75) && eq(f.smallOrderFee, 3.5) && eq(f.clientTotal, 56.25), '$50 gig: 5.5% fee $2.75 + small-order $3.50 = client pays $56.25', JSON.stringify(f));
  assert(eq(f.platformCommission, 10) && eq(f.freelancerNet, 40), '$50 gig: freelancer gets exactly 80% ($40), commission $10');
  f = calculateOrderFees(199.99);
  assert(f.smallOrderFee === 3.5, '$199.99 is under $200: small-order fee applies');
  f = calculateOrderFees(200);
  assert(f.smallOrderFee === 0 && eq(f.serviceFee, 11) && eq(f.clientTotal, 211), '$200 is not under $200: no small-order fee, total $211');
  f = calculateOrderFees(500);
  assert(eq(f.serviceFee, 27.5) && f.smallOrderFee === 0 && eq(f.clientTotal, 527.5) && eq(f.freelancerNet, 400), '$500 gig: service fee $27.50, total $527.50, freelancer $400');
  f = calculateOrderFees(0.01);
  assert(f.cents.serviceFee === 0 && f.cents.platformCommission === 0, 'Sub-cent fees round to zero without NaN');
  f = calculateOrderFees(19.99);
  assert(f.cents.clientTotal === f.cents.gigPrice + f.cents.serviceFee + f.cents.smallOrderFee, 'Cents always add up: gig + fees = client total');
  assert(f.cents.platformCommission + f.cents.freelancerNet === f.cents.gigPrice, 'Commission + freelancer net always equals gig price exactly');
  throws(() => calculateOrderFees(-5), 'Negative price rejected');
  throws(() => calculateOrderFees(NaN), 'NaN price rejected');
  assert(DEFAULT_FEE_CONFIG.commissionPercent === 20 && DEFAULT_FEE_CONFIG.buyerFeePercent === 5.5 && DEFAULT_FEE_CONFIG.smallOrderFee === 3.5 && DEFAULT_FEE_CONFIG.smallOrderThreshold === 200, 'Defaults are 20% / 5.5% / $3.50 / $200');

  // ---- ledger defaults enforce the structure with no configuration ----
  let e = freshEngine();
  const b0 = e.getWalletBalance('buyer1')!;
  fund(e, 'o50', 50);
  assert(eq(e.getWalletBalance('buyer1')!, b0 - 56.25), 'Funding a $50 order debits the buyer $56.25');
  assert(eq(e.getEscrow('o50')!.remaining, 50), 'Only the $50 gig price is held in escrow');
  assert(ok(e), 'Invariants hold after funding');
  const rel = e.releaseEscrow({ orderId: 'o50', actor: 'test' });
  assert(rel.freelancerNet === 40 && rel.platformFee === 10, 'Release: freelancer $40, commission $10');
  assert(eq(e.getWalletBalance('free1')!, 40), 'Freelancer wallet credited exactly $40');
  const ov = e.getFinancialOverview();
  assert(eq(ov.platformRevenue, 10 + 2.75 + 3.5) && eq(ov.revenueBreakdown.commission, 10) && eq(ov.revenueBreakdown.clientServiceFees, 2.75) && eq(ov.revenueBreakdown.smallOrderFees, 3.5), 'Platform revenue = $10 commission + $2.75 service fee + $3.50 small-order fee', JSON.stringify(ov.revenueBreakdown));
  assert(ok(e), 'Invariants and trial balance hold after release');

  // ---- balance must cover the FULL client total, not just the gig price ----
  e = freshEngine(52);
  throws(() => fund(e, 'tight', 50), 'Wallet of $52 cannot fund a $50 order (needs $56.25)', 'Insufficient');
  assert(eq(e.getWalletBalance('buyer1')!, 52) && !e.getEscrow('tight'), 'Failed funding changes nothing');

  // ---- $200+ order ----
  e = freshEngine();
  fund(e, 'o500', 500);
  assert(eq(e.getWalletBalance('buyer1')!, 100000 - 527.5), '$500 order debits $527.50 (no small-order fee)');
  const rel2 = e.releaseEscrow({ orderId: 'o500', actor: 'test' });
  assert(rel2.freelancerNet === 400 && rel2.platformFee === 100, '$500 order: freelancer $400, commission $100');

  // ---- full refund returns the client fees ----
  e = freshEngine();
  const start = e.getWalletBalance('buyer1')!;
  fund(e, 'r1', 50);
  const r = e.refundEscrow({ orderId: 'r1', reason: 'buyer cancelled before work', actor: 'test' });
  assert(eq(e.getWalletBalance('buyer1')!, start) && eq(r.feesRefunded, 6.25), 'Full refund returns gig price AND client fees ($56.25 back)', String(e.getWalletBalance('buyer1')));
  assert(eq(e.getFinancialOverview().platformRevenue, 0) && ok(e), 'Revenue reversed to $0 and invariants hold after full refund');

  // ---- partial refunds / split keep fees ----
  e = freshEngine();
  fund(e, 's1', 100);
  const sp = e.resolveEscrowSplit({ orderId: 's1', refundAmount: 40, reason: 'dispute partial', actor: 'test' });
  assert(sp.refund.feesRefunded === 0, 'Dispute split does not refund client fees');
  assert(sp.release.platformFee === 12 && sp.release.freelancerNet === 48, 'Split: remaining $60 releases as $48 freelancer / $12 commission');
  assert(eq(e.getFinancialOverview().revenueBreakdown.clientServiceFees, 5.5) && eq(e.getFinancialOverview().revenueBreakdown.smallOrderFees, 3.5) && ok(e), 'Split keeps $5.50 + $3.50 client fees; invariants hold');

  // ---- two partial refunds that add up to the whole order refund the fees once ----
  e = freshEngine();
  const st2 = e.getWalletBalance('buyer1')!;
  fund(e, 'm1', 100);
  e.refundEscrow({ orderId: 'm1', amount: 30, reason: 'first part refund', actor: 'test' });
  const last = e.refundEscrow({ orderId: 'm1', reason: 'rest refunded', actor: 'test' });
  assert(eq(last.feesRefunded, 9) && eq(e.getWalletBalance('buyer1')!, st2) && ok(e), 'Refunds that sum to the whole order return fees exactly once');

  // ---- commission rate is locked at funding time ----
  e = freshEngine();
  fund(e, 'lock', 100);
  e.setPlatformCommissionRate(50);
  const rl = e.releaseEscrow({ orderId: 'lock', actor: 'test' });
  assert(rl.platformFee === 20 && rl.freelancerNet === 80, 'Changing the commission after funding does not change an open order (still 20/80)');

  // ---- configurable ----
  e = freshEngine();
  e.configure({ buyerFeePercent: 10, smallOrderFee: 5, smallOrderThreshold: 100 });
  assert(eq(e.quoteOrder(50).clientTotal, 60), 'Fees follow configuration (10% + $5 under $100 => $60 for $50)');
  throws(() => e.configure({ buyerFeePercent: 150 }), 'Out-of-range fee config rejected', 'buyerFeePercent');

  console.log(`\nFEE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}
run();

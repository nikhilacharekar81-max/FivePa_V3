// Safety regression tests for the payment layer: double-spend, state machines, validation, freezes, payouts.
import { FinanceLedgerEngine } from '../src/server/financeLedger.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, details?: string) {
  if (cond) { console.log(`[PASS] ${name}`); passed++; } else { console.error(`[FAIL] ${name} - ${details || ''}`); failed++; }
}
function throws(fn: () => unknown, name: string, contains?: string) {
  try { fn(); assert(false, name, 'expected an error but none was thrown'); }
  catch (e: any) { assert(!contains || String(e.message).includes(contains), name, `got: ${e.message}`); }
}
const bal = (e: FinanceLedgerEngine, id: string) => e.getWalletBalance(id)!;
const invariantsOk = (e: FinanceLedgerEngine) => e.getInvariants().every(i => i.ok) && e.getFinancialOverview().trialBalanceInBalance;

function makeEngine(): FinanceLedgerEngine {
  const eng = new FinanceLedgerEngine();
  eng.ensureWallet({ userId: 'user_1', name: 'Alex Rivera', email: 'alex@example.com', role: 'buyer' });
  eng.ensureWallet({ userId: 'user_2', name: 'Elena Rostova', email: 'elena@example.com', role: 'freelancer' });
  eng.ensureWallet({ userId: 'user_3', name: 'Marcus Chen', email: 'marcus@example.com', role: 'freelancer' });
  eng.ensureWallet({ userId: 'user_4', name: 'Sarah Jenkins', email: 'sarah@example.com', role: 'freelancer' });
  return eng;
}

function run() {
  // --- seed state ---
  let e = makeEngine();
  assert(e.getWallets().every(w => w.isReconciled), 'Seed wallets all reconcile with the ledger');
  assert(invariantsOk(e), 'Seed invariants hold (escrow, holds, payouts, trial balance)');

  // --- double release ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-1', actor: 'a' });
  e.fundEscrow({ orderId: 'o1', orderTitle: 't', amount: 100, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  e.releaseEscrow({ orderId: 'o1', actor: 'a' });
  const afterFirst = bal(e, 'user_3');
  throws(() => e.releaseEscrow({ orderId: 'o1', actor: 'a' }), 'Second release of the same order is rejected', 'already released');
  throws(() => e.releaseEscrow({ orderId: 'o1', actor: 'a' }), 'Third release is rejected too');
  assert(bal(e, 'user_3') === afterFirst && afterFirst === 80, 'Freelancer credited exactly once ($80)', String(bal(e, 'user_3')));
  throws(() => e.refundEscrow({ orderId: 'o1', reason: 'too late refund', actor: 'a' }), 'Refund after release is rejected', 'already released');
  assert(invariantsOk(e), 'Invariants hold after release attempts');

  // --- double refund / refund then release ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-2', actor: 'a' });
  const b0 = bal(e, 'user_2');
  e.fundEscrow({ orderId: 'o2', orderTitle: 't', amount: 100, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  e.refundEscrow({ orderId: 'o2', reason: 'buyer cancelled', actor: 'a' });
  throws(() => e.refundEscrow({ orderId: 'o2', reason: 'buyer cancelled', actor: 'a' }), 'Double refund is rejected', 'already refunded');
  throws(() => e.releaseEscrow({ orderId: 'o2', actor: 'a' }), 'Release after refund is rejected', 'already refunded');
  assert(bal(e, 'user_2') === b0, 'Buyer balance restored exactly once');
  assert(invariantsOk(e), 'Invariants hold after refund attempts');

  // --- refund cap and partial split ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-3', actor: 'a' });
  e.fundEscrow({ orderId: 'o3', orderTitle: 't', amount: 200, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  throws(() => e.refundEscrow({ orderId: 'o3', amount: 250, reason: 'over refund', actor: 'a' }), 'Refund above escrow held is rejected', 'exceeds');
  const split = e.resolveEscrowSplit({ orderId: 'o3', refundAmount: 50, reason: 'partial scope delivered', actor: 'a' });
  assert(split.release.freelancerNet === 120 && split.release.platformFee === 30, 'Split: remainder $150 -> $120 seller, $30 fee');
  assert(e.getEscrow('o3')?.status === 'split' && e.getEscrow('o3')?.remaining === 0, 'Escrow fully resolved after split');
  assert(invariantsOk(e), 'Invariants hold after split');

  // --- funding rules ---
  e = makeEngine();
  throws(() => e.fundEscrow({ orderId: 'o4', orderTitle: 't', amount: 999999, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' }), 'Order larger than wallet balance is rejected', 'Insufficient wallet balance');
  assert(!e.getEscrow('o4'), 'No escrow created for a rejected order');
  throws(() => e.fundEscrow({ orderId: 'o5', orderTitle: 't', amount: 50, buyerId: 'user_2', sellerId: 'user_2', actor: 'a' }), 'Self-dealing order is rejected', 'themselves');
  for (const bad of [NaN, -5, 0, Infinity, 10.123, '50' as any]) {
    throws(() => e.fundEscrow({ orderId: 'ob' + String(bad), orderTitle: 't', amount: bad, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' }), `Invalid amount ${String(bad)} is rejected`);
  }
  throws(() => e.fundEscrow({ orderId: 'o6', orderTitle: 't', amount: 5, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' }), 'Below minimum order amount is rejected', 'Minimum order');
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-4', actor: 'a' });
  e.fundEscrow({ orderId: 'o7', orderTitle: 't', amount: 20, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  throws(() => e.fundEscrow({ orderId: 'o7', orderTitle: 't', amount: 20, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' }), 'Funding the same order twice is rejected', 'already funded');
  throws(() => e.releaseEscrow({ orderId: 'never_funded', actor: 'a' }), 'Releasing an order that was never funded is rejected', 'No funded escrow');

  // --- NaN adjustment must not corrupt wallets ---
  e = makeEngine();
  const before = bal(e, 'user_3');
  throws(() => e.executeAdministrativeAdjustment({ userId: 'user_3', amount: NaN, direction: 'credit_user', category: 'goodwill', reason: 'bad amount test', actor: 'a' }), 'NaN adjustment is rejected');
  assert(bal(e, 'user_3') === before && Number.isFinite(bal(e, 'user_3')), 'Wallet unchanged after rejected adjustment');
  throws(() => e.executeAdministrativeAdjustment({ userId: 'user_admin', amount: 10, direction: 'credit_user', category: 'goodwill', reason: 'admin wallet test', actor: 'a' }), 'Admin wallet cannot be adjusted');

  // --- freezes are enforced ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-5', actor: 'a' });
  e.fundEscrow({ orderId: 'f1', orderTitle: 't', amount: 100, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  e.freezeWallet('user_3', 'fraud investigation', 'a');
  throws(() => e.releaseEscrow({ orderId: 'f1', actor: 'a' }), 'Release to a frozen seller wallet is blocked', 'frozen');
  e.unfreezeWallet('user_3', 'cleared', 'a');
  e.freezeWallet('user_2', 'fraud investigation', 'a');
  throws(() => e.refundEscrow({ orderId: 'f1', reason: 'refund to frozen', actor: 'a' }), 'Refund to a frozen buyer wallet is blocked', 'frozen');
  throws(() => e.creditDeposit({ userId: 'user_2', amount: 10, reference: 'r', idempotencyKey: 'k1', actor: 'a' }), 'Deposit into a frozen wallet is blocked', 'frozen');

  // --- payouts ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_1', amount: 3675, reference: 'SEED-DEP-USER1', idempotencyKey: 'SEED-U1', actor: 'a' });
  const e0 = bal(e, 'user_1'); // 3675
  throws(() => e.requestPayout({ payoutId: 'p0', freelancerId: 'user_1', amount: 10, method: 'UPI', accountDetails: 'x@upi', actor: 'a' }), 'Withdrawal below minimum is rejected', 'Minimum withdrawal');
  throws(() => e.requestPayout({ payoutId: 'p0', freelancerId: 'user_1', amount: 99999, method: 'UPI', accountDetails: 'x@upi', actor: 'a' }), 'Withdrawal above maximum is rejected');
  throws(() => e.requestPayout({ payoutId: 'p0', freelancerId: 'user_3', amount: 100, method: 'UPI', accountDetails: 'x@upi', actor: 'a' }), 'Withdrawal above balance is rejected', 'Insufficient');
  e.requestPayout({ payoutId: 'p1', freelancerId: 'user_1', amount: 500, method: 'UPI', accountDetails: 'elena@upi', actor: 'a' });
  assert(bal(e, 'user_1') === e0 - 500, 'Withdrawal request debits the wallet immediately');
  throws(() => e.requestPayout({ payoutId: 'p1', freelancerId: 'user_1', amount: 100, method: 'UPI', accountDetails: 'elena@upi', actor: 'a' }), 'Duplicate payout id is rejected', 'already exists');
  assert(invariantsOk(e), 'Invariants hold with a payout pending');
  e.cancelPayout({ payoutId: 'p1', reason: 'rejected by admin', actor: 'a' });
  throws(() => e.cancelPayout({ payoutId: 'p1', reason: 'rejected twice', actor: 'a' }), 'Cancelling a payout twice is rejected');
  assert(bal(e, 'user_1') === e0, 'Cancelled payout returns funds exactly once');
  e.requestPayout({ payoutId: 'p2', freelancerId: 'user_1', amount: 200, method: 'UPI', accountDetails: 'elena@upi', actor: 'a' });
  e.settlePayout({ payoutId: 'p2', actor: 'a' });
  throws(() => e.settlePayout({ payoutId: 'p2', actor: 'a' }), 'Settling a payout twice is rejected');
  throws(() => e.cancelPayout({ payoutId: 'p2', reason: 'cancel after paid', actor: 'a' }), 'Cancelling a settled payout is rejected');
  assert(bal(e, 'user_1') === e0 - 200, 'Settled payout stays debited');
  e.requestPayout({ payoutId: 'p3', freelancerId: 'user_1', amount: 300, method: 'UPI', accountDetails: 'elena@upi', actor: 'a' });
  e.failPayout({ payoutId: 'p3', reason: 'gateway failure', actor: 'a' });
  assert(bal(e, 'user_1') === e0 - 200, 'Failed payout returns funds');
  e.retryPayout({ payoutId: 'p3', actor: 'a' });
  assert(bal(e, 'user_1') === e0 - 500, 'Retried payout debits again');
  e.settlePayout({ payoutId: 'p3', actor: 'a' });
  assert(invariantsOk(e), 'Invariants hold after payout lifecycle');
  e.restrictWallet('user_1', 'under review', 'a');
  throws(() => e.requestPayout({ payoutId: 'p4', freelancerId: 'user_1', amount: 100, method: 'UPI', accountDetails: 'elena@upi', actor: 'a' }), 'Restricted wallet cannot withdraw', 'restricted');

  // --- reversal rules ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-6', actor: 'a' });
  e.fundEscrow({ orderId: 'r1', orderTitle: 't', amount: 100, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  const fundJournal = e.getJournals().find(j => j.eventType === 'ORDER_ESCROW_FUNDED' && j.entries.some(x => x.orderId === 'r1'))!;
  throws(() => e.reverseJournal(fundJournal.id, 'trying to reverse escrow', 'a'), 'Escrow journals cannot be reversed directly', 'cannot be reversed');
  const dep = e.getJournals().find(j => j.reference === 'TEST-DEP')!;
  throws(() => e.reverseJournal(dep.id, 'reverse a spent deposit', 'a'), 'Reversing a deposit that would overdraw a wallet is rejected', 'overdraw');
  const adj = e.executeAdministrativeAdjustment({ userId: 'user_3', amount: 40, direction: 'credit_user', category: 'goodwill', reason: 'goodwill credit test', actor: 'a' });
  const rev = e.reverseJournal(adj.journal.id, 'duplicate goodwill credit', 'a');
  throws(() => e.reverseJournal(rev.id, 'reverse the reversal', 'a'), 'A reversal cannot be reversed', 'cannot itself be reversed');
  throws(() => e.reverseJournal(adj.journal.id, 'reverse again please', 'a'), 'An adjustment cannot be reversed twice', 'already been reversed');
  assert(invariantsOk(e), 'Invariants hold after reversals');

  // --- commission follows settings ---
  e = makeEngine();
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-7', actor: 'a' });
  e.setPlatformCommissionRate(15);
  e.fundEscrow({ orderId: 'c1', orderTitle: 't', amount: 200, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  const rel = e.releaseEscrow({ orderId: 'c1', actor: 'a' });
  assert(rel.platformFee === 30 && rel.freelancerNet === 170, 'Release honours the configured 15% commission');

  // --- idempotency ---
  e = makeEngine();
  const w0 = bal(e, 'user_3');
  e.creditDeposit({ userId: 'user_3', amount: 75, reference: 'gw-1', idempotencyKey: 'evt_123', actor: 'gw' });
  const again = e.creditDeposit({ userId: 'user_3', amount: 75, reference: 'gw-1', idempotencyKey: 'evt_123', actor: 'gw' });
  assert(again.replayed && bal(e, 'user_3') === w0 + 75, 'Replayed gateway event credits the wallet only once');
  e.creditDeposit({ userId: 'user_2', amount: 1000, reference: 'TEST-DEP', idempotencyKey: 'DEP-SAFETY-8', actor: 'a' });
  e.fundEscrow({ orderId: 'i1', orderTitle: 't', amount: 100, buyerId: 'user_2', sellerId: 'user_3', actor: 'a' });
  const r1 = e.releaseEscrow({ orderId: 'i1', actor: 'a', requestKey: 'req-1' });
  const r2 = e.releaseEscrow({ orderId: 'i1', actor: 'a', requestKey: 'req-1' });
  assert(r1.journal.id === r2.journal.id, 'Same requestKey returns the original result without re-applying');

  // --- CSV formula injection ---
  e = makeEngine();
  e.executeAdministrativeAdjustment({ userId: 'user_3', amount: 20, direction: 'credit_user', category: 'goodwill', reason: 'csv injection check', actor: '=2+2' });
  const csv = e.generateCsvExport('audit_trail').content;
  assert(csv.includes(`"'=2+2"`) && !csv.includes(`"=2+2"`), 'CSV export neutralises formula-injection cells');
  assert(invariantsOk(e), 'Final invariants hold');

  console.log(`\nSAFETY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}

run();

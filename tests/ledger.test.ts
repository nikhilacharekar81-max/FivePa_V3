// Automated Financial Test Suite for Double-Entry Ledger Invariants & Workflows
import { FinanceLedgerEngine } from '../src/server/financeLedger.js';

console.log('--- RUNNING WORKPERHOUR DOUBLE-ENTRY LEDGER TEST SUITE ---');

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName} - ${details || 'Assertion failed'}`);
    failedTests++;
  }
}

function runTests() {
  const engine = new FinanceLedgerEngine();
  engine.ensureWallet({ userId: 'user_1', name: 'Alex Rivera', email: 'alex@example.com', role: 'buyer' });
  engine.ensureWallet({ userId: 'user_2', name: 'Elena Rostova', email: 'elena@example.com', role: 'freelancer' });
  engine.ensureWallet({ userId: 'user_3', name: 'Marcus Chen', email: 'marcus@example.com', role: 'freelancer' });

  // Test 1: Initial state trial balance equality (Total Debits === Total Credits)
  const initialOverview = engine.getFinancialOverview();
  assert(
    initialOverview.trialBalanceInBalance && initialOverview.trialBalanceDiscrepancy === 0,
    'Initial Trial Balance is strictly equal (Debits === Credits)',
    `Discrepancy was $${initialOverview.trialBalanceDiscrepancy}`
  );

  // Test 2: Debit-Credit Equality Enforcement - Unbalanced journals must throw and abort atomically
  let caughtUnbalanced = false;
  try {
    engine.postJournal({
      reference: 'TEST-UNBALANCED-FAIL',
      description: 'Illegal Unbalanced Entry',
      eventType: 'DEPOSIT_SETTLED',
      idempotencyKey: 'IDEMP-FAIL-1',
      actor: 'Test Suite',
      entries: [
        { accountCode: '1010', debit: 500, credit: 0, currency: 'USD', description: 'Debit $500' },
        { accountCode: '2010', debit: 0, credit: 490, currency: 'USD', description: 'Credit only $490' } // Discrepancy of $10!
      ]
    });
  } catch (err: any) {
    caughtUnbalanced = true;
    assert(
      err.message.includes('out of balance'),
      'Unbalanced Journal is rejected with explicit balance discrepancy error'
    );
  }
  assert(caughtUnbalanced, 'Atomic rejection of unbalanced journal');

  // Verify journal was NOT added (atomic rollback)
  const journalsAfterFailed = engine.getJournals();
  assert(
    !journalsAfterFailed.some(j => j.reference === 'TEST-UNBALANCED-FAIL'),
    'Atomic rollback confirmed: Rejected journal did not persist in ledger'
  );

  // Test 3: Idempotency Key - duplicate transactions cannot be posted twice
  const testKey = 'IDEMP-TEST-UNIQUE-99';
  const validPosting = {
    reference: 'TEST-IDEMP-POST',
    description: 'Valid Balanced Deposit',
    eventType: 'DEPOSIT_SETTLED' as const,
    idempotencyKey: testKey,
    actor: 'Test Runner',
    entries: [
      { accountCode: '1010', debit: 250, credit: 0, currency: 'USD', description: 'Debit 250' },
      { accountCode: '2010', debit: 0, credit: 250, currency: 'USD', description: 'Credit 250', userId: 'user_2' }
    ]
  };

  const firstPost = engine.postJournal(validPosting);
  assert(firstPost !== null, 'First valid journal posted successfully');

  // Second post with exact same idempotency key must return the existing journal or prevent double-posting
  const secondPost = engine.postJournal(validPosting);
  assert(secondPost.id === firstPost.id, 'Idempotency prevented duplicate posting and returned original journal');

  // Test 4: Currency isolation - mixed currency check must fail
  let caughtMixedCurrency = false;
  try {
    engine.postJournal({
      reference: 'TEST-MIXED-CURRENCY',
      description: 'Mixed USD and EUR',
      eventType: 'DEPOSIT_SETTLED',
      idempotencyKey: 'IDEMP-MIX-1',
      actor: 'Test Runner',
      entries: [
        { accountCode: '1010', debit: 100, credit: 0, currency: 'USD', description: 'USD debit' },
        { accountCode: '2010', debit: 0, credit: 100, currency: 'EUR', description: 'EUR credit' }
      ]
    });
  } catch (err: any) {
    caughtMixedCurrency = true;
    assert(err.message.includes('mixed currencies'), 'Multi-currency isolation enforced');
  }
  assert(caughtMixedCurrency, 'Mixed currency journal correctly rejected');

  // Ensure buyer user_2 has sufficient wallet balance for escrow funding
  engine.executeAdministrativeAdjustment({
    userId: 'user_2',
    amount: 5000,
    direction: 'credit_user',
    category: 'goodwill',
    reason: 'Initial test deposit for buyer user_2',
    actor: 'Test Admin'
  });

  // Test 5: Escrow Release Lifecycle (80% to freelancer, 20% platform fee) - escrow must be funded first
  const initialFreelancerBalance = engine.getWalletById('user_3')?.wallet.availableBalance || 0;
  const testOrderId1 = `ord_test_999_${Date.now()}`;
  engine.fundEscrow({ orderId: testOrderId1, orderTitle: 'Cloud Infrastructure Setup', amount: 1000, buyerId: 'user_2', sellerId: 'user_3', actor: 'Test Admin' });
  const releaseResult = engine.releaseEscrow({ orderId: testOrderId1, actor: 'Test Admin' });
  assert(releaseResult.freelancerNet === 800, 'Escrow release credited 80% net ($800) to freelancer');
  assert(releaseResult.platformFee === 200, 'Escrow release reserved 20% ($200) platform fee');
  assert(
    engine.getWalletById('user_3')?.wallet.availableBalance === initialFreelancerBalance + 800,
    'Freelancer available balance updated accurately in ledger & wallet projection'
  );

  // Test 6: Escrow Refund Lifecycle
  const buyerBefore = engine.getWalletById('user_2')?.wallet.availableBalance || 0;
  const testOrderId2 = `ord_test_refund_1_${Date.now()}`;
  engine.fundEscrow({ orderId: testOrderId2, orderTitle: 'Cancelled Task', amount: 400, buyerId: 'user_2', sellerId: 'user_3', actor: 'Support Agent' });
  assert(engine.getWalletById('user_2')?.wallet.availableBalance! < buyerBefore, 'Funding escrow debits the buyer wallet');
  engine.refundEscrow({ orderId: testOrderId2, reason: 'Buyer cancellation before milestone acceptance', actor: 'Support Agent' });
  assert(
    engine.getWalletById('user_2')?.wallet.availableBalance === buyerBefore,
    'Buyer available balance restored accurately via double-entry refund'
  );

  // Test 7: Administrative Adjustment with Controlled Debits & Negative Balance Prevention
  let caughtNegative = false;
  try {
    engine.executeAdministrativeAdjustment({
      userId: 'user_3',
      amount: 999999, // Exceeds balance!
      direction: 'debit_user',
      category: 'chargeback_recovery',
      reason: 'Excessive recovery',
      actor: 'Admin'
    });
  } catch (err: any) {
    caughtNegative = true;
    assert(err.message.includes('Insufficient user available balance'), 'Arbitrary negative balance rejected');
  }
  assert(caughtNegative, 'Over-debit adjustment correctly rejected');

  // Test 8: Valid Administrative Credit Adjustment
  const adjResult = engine.executeAdministrativeAdjustment({
    userId: 'user_3',
    amount: 50,
    direction: 'credit_user',
    category: 'goodwill',
    reason: 'Platform promotion goodwill credit',
    actor: 'Super Admin'
  });
  assert(adjResult.journal.totalDebit === 50 && adjResult.journal.totalCredit === 50, 'Administrative adjustment journal balances ($50 = $50)');

  // Test 9: Reversal of Journal
  const reversalJournal = engine.reverseJournal(adjResult.journal.id, 'Accidental duplicate goodwill grant', 'Chief Finance');
  assert(reversalJournal.totalDebit === 50 && reversalJournal.totalCredit === 50, 'Reversal journal balances');
  assert(adjResult.journal.status === 'reversed', 'Original journal marked as reversed with pointer to reversal');

  // Test 10: Final Trial Balance Invariant Check
  const finalOverview = engine.getFinancialOverview();
  assert(
    finalOverview.trialBalanceInBalance && finalOverview.trialBalanceDiscrepancy === 0,
    'Final System-Wide Trial Balance remains 100% in balance after all financial operations'
  );

  console.log(`\n========================================`);
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();

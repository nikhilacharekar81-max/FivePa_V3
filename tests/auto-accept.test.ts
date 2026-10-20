import assert from 'node:assert';
import {
  orders,
  users,
  messages,
  auditLogs,
  disputes,
  processAutoAcceptOrders,
  isAutoAcceptEnabled,
  getReviewWindowDays,
  siteSettings,
  saveOrdersToDisk
} from '../server.ts';
import { financeLedger } from '../src/server/financeLedger.ts';
import type { Order, DeliveryRecord, UserAccount } from '../src/types.ts';

console.log('\n--- BUYER REVIEW WINDOW & AUTO-ACCEPT UNIT & SIMULATION TESTS ---');

let passed = 0;
function ok(name: string) {
  console.log(`  ✅ ${name}`);
  passed++;
}

async function run() {
  const T0 = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // 1. Verify default review window is 3 days
  const defaultDays = getReviewWindowDays();
  assert.strictEqual(defaultDays, 3, 'Default review window must be 3 days');
  assert.strictEqual(isAutoAcceptEnabled(), true, 'Auto-accept feature must be enabled by default');
  ok('default review window is 3 days and feature is enabled');

  // Setup test users in users array if needed
  const buyerId = 'usr_buyer_auto_' + T0;
  const sellerId = 'usr_seller_auto_' + T0;

  const buyer: UserAccount = {
    id: buyerId,
    name: 'Auto Buyer',
    email: `buyer_${T0}@test.com`,
    role: 'buyer',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    title: 'Client',
    rating: 5,
    reviewsCount: 0,
    hourlyRate: 0,
    earned: 0,
    completedJobs: 0,
    bio: '',
    skills: [],
    status: 'active',
    verified: true,
    walletBalance: 2000,
    createdAt: new Date().toISOString()
  };

  const seller: UserAccount = {
    id: sellerId,
    name: 'Auto Seller',
    email: `seller_${T0}@test.com`,
    role: 'freelancer',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    title: 'Freelancer',
    rating: 5,
    reviewsCount: 0,
    hourlyRate: 50,
    earned: 0,
    completedJobs: 0,
    bio: '',
    skills: [],
    status: 'active',
    verified: true,
    walletBalance: 0,
    createdAt: new Date().toISOString()
  };

  users.push(buyer, seller);
  financeLedger.ensureWallet({ userId: buyerId, name: buyer.name, email: buyer.email, role: 'buyer' });
  financeLedger.ensureWallet({ userId: sellerId, name: seller.name, email: seller.email, role: 'freelancer' });
  financeLedger.creditDeposit({
    userId: buyerId,
    amount: 2000,
    reference: `DEP-TEST-${T0}`,
    idempotencyKey: `dep_test_${T0}`,
    actor: buyerId
  });

  // Setup order 1: delivered 2 days ago (T0 - 2 days). Window is 3 days -> Should NOT be auto-accepted yet
  const orderId1 = 'ord_auto_pending_' + T0;
  const amount1 = 100;
  financeLedger.fundEscrow({
    orderId: orderId1,
    orderTitle: 'Test Pending Review Order',
    amount: amount1,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const deliveryV1: DeliveryRecord = {
    version: 1,
    deliveredAt: new Date(T0 - 2 * ONE_DAY_MS).toISOString(),
    message: 'Finished work v1',
    files: [{ name: 'result.pdf', size: '1 MB', url: '/uploads/workstream/test1.pdf' }]
  };

  const order1: Order = {
    id: orderId1,
    title: 'Test Pending Review Order',
    buyerId,
    sellerId,
    amount: amount1,
    status: 'delivered',
    createdAt: new Date(T0 - 5 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 5 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [deliveryV1],
    deliverableFiles: deliveryV1.files
  };
  orders.push(order1);

  // Run at T0 (2 days after delivery) -> should be 0 processed
  const resPending = processAutoAcceptOrders(T0);
  assert.ok(!resPending.some(p => p.orderId === orderId1), 'Order delivered 2 days ago must not auto-accept at day 2');
  assert.strictEqual(order1.status, 'delivered', 'Order status must remain delivered');
  ok('premature order (2 days into 3-day window) remains untouched in delivered status');

  // Setup order 2: delivered 4 days ago (T0 - 4 days). Window is 3 days -> MUST be auto-accepted!
  const orderId2 = 'ord_auto_expired_' + T0;
  const amount2 = 200;
  financeLedger.fundEscrow({
    orderId: orderId2,
    orderTitle: 'Test Expired Review Order',
    amount: amount2,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const deliveryV2: DeliveryRecord = {
    version: 1,
    deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(),
    message: 'Completed deliverable v1',
    files: [{ name: 'app_final.zip', size: '5 MB', url: '/uploads/workstream/test2.zip' }]
  };

  const order2: Order = {
    id: orderId2,
    title: 'Test Expired Review Order',
    buyerId,
    sellerId,
    amount: amount2,
    status: 'delivered',
    createdAt: new Date(T0 - 7 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 3 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [deliveryV2],
    deliverableFiles: deliveryV2.files
  };
  orders.push(order2);

  const initialSellerBalance = seller.walletBalance;

  // Run at T0 (4 days after delivery)
  const resExpired = processAutoAcceptOrders(T0);
  const processed2 = resExpired.find(p => p.orderId === orderId2);
  assert.ok(processed2, 'Order delivered 4 days ago must be auto-accepted');
  assert.strictEqual(processed2.acceptedVersion, 1, 'Accepted version must be 1');
  assert.strictEqual(order2.status, 'completed', 'Order status must be updated to completed');
  assert.strictEqual(order2.acceptedVersion, 1, 'order.acceptedVersion must be recorded');
  assert.ok(order2.completedAt, 'order.completedAt must be populated');

  // Escrow check: funds must be released
  const esc2 = financeLedger.getEscrow(orderId2);
  assert.strictEqual(esc2?.status, 'released', 'Ledger escrow must be released');
  assert.strictEqual(esc2?.remaining, 0, 'Ledger escrow remaining balance must be 0');
  assert.ok(seller.walletBalance > initialSellerBalance, 'Freelancer wallet must receive net payout');
  ok('expired order is auto-accepted, escrow released to seller, and version recorded');

  // Check audit log and workstream system message
  const sysMessage = messages.find(m => m.orderId === orderId2 && m.type === 'system' && m.metadata?.action === 'order_auto_accepted');
  assert.ok(sysMessage, 'System message must be posted to order workstream');
  assert.ok(sysMessage.text.includes('automatically accepted'), 'System message text must explain review window expiration');

  const auditEntry = auditLogs.find(l => l.target === `Order #${orderId2}` && l.action === 'ORDER_AUTO_ACCEPTED');
  assert.ok(auditEntry, 'Audit log entry must be recorded for auto-acceptance');
  ok('system message and audit log entry recorded properly');

  // Idempotency: Running processAutoAcceptOrders again at T0 must not process order2 again
  const messagesCountBefore = messages.filter(m => m.orderId === orderId2).length;
  const sellerBalanceAfterFirst = seller.walletBalance;
  const resIdempotent = processAutoAcceptOrders(T0);
  assert.ok(!resIdempotent.some(p => p.orderId === orderId2), 'Second run must not re-process the completed order');
  assert.strictEqual(seller.walletBalance, sellerBalanceAfterFirst, 'Freelancer wallet balance must not increase again');
  assert.strictEqual(messages.filter(m => m.orderId === orderId2).length, messagesCountBefore, 'No duplicate messages created');
  ok('idempotency verified: re-running does not double-release or duplicate messages');

  // Safety exemption 1: Order with active revision request must NOT be auto-accepted
  const orderId3 = 'ord_auto_revised_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId3,
    orderTitle: 'Test Revision Order',
    amount: 150,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order3: Order = {
    id: orderId3,
    title: 'Test Revision Order',
    buyerId,
    sellerId,
    amount: 150,
    status: 'delivered',
    createdAt: new Date(T0 - 8 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: []
    }],
    revisions: [{
      id: 'rev_1',
      version: 1,
      requestedAt: new Date(T0 - 3 * ONE_DAY_MS).toISOString(),
      reason: 'Please adjust color palette',
      status: 'requested',
      deliveryVersion: 1
    }]
  };
  orders.push(order3);

  const resRevision = processAutoAcceptOrders(T0);
  assert.ok(!resRevision.some(p => p.orderId === orderId3), 'Order with active revision must NOT be auto-accepted');
  assert.strictEqual(order3.status, 'delivered', 'Status must stay delivered while revision is pending');
  ok('order with active revision request is exempted from auto-accept');

  // Safety exemption 2: Order with open dispute must NOT be auto-accepted
  const orderId4 = 'ord_auto_disputed_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId4,
    orderTitle: 'Test Disputed Order',
    amount: 120,
    buyerId,
    sellerId,
    actor: buyerId
  });

  disputes.push({
    id: 'disp_' + T0,
    orderId: orderId4,
    buyerId,
    sellerId,
    reason: 'Defect',
    status: 'open',
    createdAt: new Date().toISOString()
  } as any);

  const order4: Order = {
    id: orderId4,
    title: 'Test Disputed Order',
    buyerId,
    sellerId,
    amount: 120,
    status: 'delivered',
    createdAt: new Date(T0 - 10 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 8 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: []
    }]
  };
  orders.push(order4);

  const resDispute = processAutoAcceptOrders(T0);
  assert.ok(!resDispute.some(p => p.orderId === orderId4), 'Order with open dispute must NOT be auto-accepted');
  assert.strictEqual(order4.status, 'delivered', 'Status must stay delivered while disputed');
  ok('order with open dispute is exempted from auto-accept');

  // Test configurable review window (e.g. set autoCompleteDeliveredDays to 5 days)
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredDays: 5, autoCompleteDeliveredEnabled: true }, 'Test Custom Window');
  assert.strictEqual(getReviewWindowDays(), 5, 'Review window must now be 5 days');

  const orderId5 = 'ord_custom_window_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId5,
    orderTitle: 'Test Custom Window Order',
    amount: 120,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order5: Order = {
    id: orderId5,
    title: 'Test Custom Window Order',
    buyerId,
    sellerId,
    amount: 120,
    status: 'delivered',
    createdAt: new Date(T0 - 8 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: []
    }]
  };
  orders.push(order5);

  // At day 4 (4 days < 5 days): should NOT auto-accept
  const res4Days = processAutoAcceptOrders(T0);
  assert.ok(!res4Days.some(p => p.orderId === orderId5), 'Order at 4 days with 5-day window must NOT auto-accept');
  assert.strictEqual(order5.status, 'delivered');

  // Fast forward clock by 2 more days (fake clock = T0 + 2 days, so 6 days after delivery): should auto-accept!
  const res6Days = processAutoAcceptOrders(T0 + 2 * ONE_DAY_MS);
  assert.ok(res6Days.some(p => p.orderId === orderId5), 'Order at 6 days with 5-day window MUST auto-accept');
  assert.strictEqual(order5.status, 'completed');
  ok('configurable window (custom 5 days) and fake-clock fast-forwarding verified');

  // Reset site settings back to default 3 days
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredDays: 3, autoCompleteDeliveredEnabled: true }, 'Test Reset');

  console.log(`\n🎉 All ${passed} Buyer Review Window & Auto-Accept tests passed successfully!`);
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Auto-accept test failed:', err);
  process.exit(1);
});

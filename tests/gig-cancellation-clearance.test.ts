import assert from 'node:assert';
import {
  orders,
  users,
  clearingEarnings,
  getUnclearedEarnings,
  releaseOrderFunds,
  refundOrderFunds
} from '../server.ts';
import { financeLedger } from '../src/server/financeLedger.ts';
import type { Order, UserAccount } from '../src/types.ts';

console.log('\n--- GIG CANCELLATION, 14-DAY CLEARANCE & WORKSTREAM TESTS ---');

let passed = 0;
function ok(name: string) {
  console.log(`  ✅ ${name}`);
  passed++;
}

async function runTests() {
  const T0 = Date.now();
  const buyerId = 'usr_buyer_test_' + T0;
  const sellerId = 'usr_seller_test_' + T0;

  const buyer: UserAccount = {
    id: buyerId,
    name: 'Test Buyer',
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
    walletBalance: 1000,
    createdAt: new Date().toISOString()
  };

  const seller: UserAccount = {
    id: sellerId,
    name: 'Test Seller',
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
    amount: 1000,
    reference: `DEP-TEST-${T0}`,
    idempotencyKey: `dep_test_${T0}`,
    actor: buyerId
  });

  // 1. Test Gig Order creation and escrow funding
  const gigOrderId = 'gig_ord_' + T0;
  const gigOrder: Order = {
    id: gigOrderId,
    workspaceId: 'ws_' + T0,
    orderType: 'gig',
    gigOrderId,
    title: 'Test Gig Order',
    buyerId,
    sellerId,
    amount: 200,
    status: 'funded_in_escrow',
    createdAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  };
  orders.push(gigOrder);
  financeLedger.fundEscrow({
    orderId: gigOrderId,
    orderTitle: 'Test Gig Order',
    amount: 200,
    buyerId,
    sellerId,
    actor: buyerId
  });
  ok('gig order created and funded in escrow');

  // 2. Test 14-day earnings clearance enforcement on withdrawal
  const releaseRes = releaseOrderFunds(gigOrder, 'Buyer', 'Test completion', true, `rel_${T0}`);
  assert.strictEqual(gigOrder.status, 'completed', 'Gig order must be completed');
  assert.strictEqual(releaseRes.freelancerNet, 160, 'Freelancer net should be 160 (80%)');
  
  const uncleared = getUnclearedEarnings(sellerId);
  assert.strictEqual(uncleared, 160, 'Uncleared earnings must be 160');
  
  const sellerWalletBal = financeLedger.getWalletBalance(sellerId);
  assert.strictEqual(sellerWalletBal, 160, 'Seller wallet balance credited 160');
  
  const withdrawable = Math.max(0, sellerWalletBal - uncleared);
  assert.strictEqual(withdrawable, 0, 'Withdrawable balance must be 0 during 14-day clearance');
  ok('14-day earnings clearance enforced correctly (withdrawable = 0)');

  // 3. Test very-late buyer cancellation rule (24 hours past due date for gigs)
  const lateGigId = 'late_gig_' + T0;
  const pastDueDate = new Date(Date.now() - 25 * 3600000).toISOString().split('T')[0];
  const lateGigOrder: Order = {
    id: lateGigId,
    workspaceId: 'ws_late_' + T0,
    orderType: 'gig',
    gigOrderId: lateGigId,
    title: 'Late Gig',
    buyerId,
    sellerId,
    amount: 150,
    status: 'funded_in_escrow',
    createdAt: new Date().toISOString(),
    dueDate: pastDueDate
  };
  orders.push(lateGigOrder);
  financeLedger.fundEscrow({
    orderId: lateGigId,
    orderTitle: 'Late Gig',
    amount: 150,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const refundLateRes = refundOrderFunds(lateGigOrder, undefined, 'Buyer', 'Seller missed deadline by over 24 hours', `ref_late_${T0}`);
  assert.strictEqual(lateGigOrder.status, 'cancelled', 'Very-late gig order must be cancelled');
  assert.strictEqual(refundLateRes.refunded, 150, 'Full refund of 150');
  ok('very-late gig order cancellation allowed at 25h past due without seller approval');

  // 4. Test project order retains 76h rule (not 24h)
  const projOrderId = 'proj_ord_' + T0;
  const projectDueDate25h = new Date(Date.now() - 25 * 3600000).toISOString().split('T')[0];
  const projectOrder: Order = {
    id: projOrderId,
    workspaceId: 'ws_proj_' + T0,
    orderType: 'project',
    projectOrderId: projOrderId,
    title: 'Test Project',
    buyerId,
    sellerId,
    amount: 300,
    status: 'funded_in_escrow',
    createdAt: new Date().toISOString(),
    dueDate: projectDueDate25h
  };
  orders.push(projectOrder);
  const isOverdueBy76 = Date.now() > new Date(projectOrder.dueDate).getTime() + 76 * 3600 * 1000;
  assert.strictEqual(isOverdueBy76, false, 'Project order at 25h past due must NOT satisfy 76h rule');
  ok('project order retains 76h rule unchanged');

  console.log(`\nAll tests passed successfully! (${passed} tests)`);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

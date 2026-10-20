import test from 'node:test';
import assert from 'node:assert';
import { workspaceService } from '../src/server/workspaceService.js';
import { financeService } from '../src/server/financeService.js';

test('Phase 3 Invariants: Workspace vs Order and Proposal Rules', async (t) => {
  // 1. Independent public Gig purchases create independent Workspaces
  const ws1 = workspaceService.createWorkspace({
    buyerId: 'user_1',
    sellerId: 'user_2',
    originType: 'gig',
    originId: 'gig_2'
  });

  const ws2 = workspaceService.createWorkspace({
    buyerId: 'user_1',
    sellerId: 'user_2',
    originType: 'gig',
    originId: 'gig_2'
  });

  assert.notStrictEqual(ws1.workspaceId, ws2.workspaceId, 'Independent public Gig purchases must create independent Workspaces');

  // 2. Multiple orders can reference the same Workspace (follow-on work)
  const sharedWs = workspaceService.createWorkspace({
    buyerId: 'user_1',
    sellerId: 'user_2',
    originType: 'gig',
    originId: 'gig_10'
  });

  const order1 = {
    id: 'ord_test_1',
    workspaceId: sharedWs.workspaceId,
    title: 'Test Order 1',
    buyerId: 'user_1',
    sellerId: 'user_2',
    amount: 100,
    status: 'completed' as const,
    createdAt: '2026-10-19',
    dueDate: '2026-10-25'
  };

  const order2 = {
    id: 'ord_test_2',
    workspaceId: sharedWs.workspaceId,
    title: 'Test Order 2 (Follow-on)',
    buyerId: 'user_1',
    sellerId: 'user_2',
    amount: 150,
    status: 'funded_in_escrow' as const,
    createdAt: '2026-10-19',
    dueDate: '2026-10-28'
  };

  const boundWs1 = workspaceService.ensureWorkspaceForOrder(order1);
  const boundWs2 = workspaceService.ensureWorkspaceForOrder(order2);

  assert.strictEqual(boundWs1.workspaceId, sharedWs.workspaceId);
  assert.strictEqual(boundWs2.workspaceId, sharedWs.workspaceId, 'Multiple Orders can belong to the same Workspace');

  // 3. Completing or cancelling an Order does not close the Workspace
  assert.strictEqual(boundWs1.status, 'active', 'Completed Order does not close or archive Workspace');

  // 4. Financial integrity via financeService
  financeService.ensureWallet({ userId: 'user_1', name: 'Alex Rivera', email: 'alex@example.com', role: 'buyer' });
  financeService.ensureWallet({ userId: 'user_2', name: 'Elena Rostova', email: 'elena@example.com', role: 'freelancer' });

  financeService.creditDeposit({
    userId: 'user_1',
    amount: 1000,
    reference: 'TEST-DEP',
    idempotencyKey: 'TEST-DEP-KEY-' + Date.now(),
    actor: 'admin'
  });

  const initialBal = financeService.getWalletBalance('user_1') || 0;
  assert.ok(initialBal >= 1000, 'Buyer wallet credited successfully');

  console.log('✅ Phase 3 Workspace Invariants test suite passed successfully!');
});

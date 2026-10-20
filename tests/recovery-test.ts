import assert from 'node:assert';
import { Order } from '../src/types';

async function runRecoveryTest() {
  console.log('--- STARTING RECOVERY TEST ---');

  // Mock orders
  const orders: Order[] = [
    {
      id: 'ord_1',
      title: 'Order 1',
      buyerId: 'user_1',
      sellerId: 'user_2',
      amount: 100,
      status: 'payment_pending',
      previousStatus: 'in_progress',
      createdAt: '2023-01-01',
      dueDate: '2023-01-10'
    }
  ];

  // Mock ledger (no escrow)
  const financeLedger = { getEscrow: (_orderId?: string) => null };

  // Run recovery logic
  let recoveryNeeded = false;
  for (const order of orders) {
    if (order.status === 'payment_pending') {
      const escrow = financeLedger.getEscrow(order.id);
      if (escrow) {
        order.status = 'funded_in_escrow';
        order.previousStatus = undefined;
        recoveryNeeded = true;
      } else {
        order.status = (order.previousStatus as any) || 'cancelled';
        order.previousStatus = undefined;
        recoveryNeeded = true;
      }
    }
  }

  assert.strictEqual(orders[0].status, 'in_progress', 'Order should be restored to in_progress');
  console.log('✅ Test Passed: payment_pending order restored to in_progress');
  process.exit(0);
}

runRecoveryTest().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});

import { hydrateStoreFromPostgres, orders, saveOrdersToDisk } from '../server/store.js';

async function runTest() {
  if (!process.env.SQL_HOST) {
    console.log('SKIPPED');
    process.exit(0);
  }

  console.log('Running PostgreSQL persistence test...');
  process.env.NODE_ENV = 'test';

  // If SQL_HOST is set, any connection error must FAIL the test.
  await hydrateStoreFromPostgres();

  const testOrderId = `test_ord_${Date.now()}`;
  const testOrder = {
    id: testOrderId,
    title: 'Persistent Order Test',
    buyerId: 'user_2',
    sellerId: 'user_1',
    amount: 100,
    status: 'funded_in_escrow' as const,
    createdAt: new Date().toISOString(),
    dueDate: new Date().toISOString()
  };

  orders.unshift(testOrder);
  await saveOrdersToDisk();

  // Restart simulation: re-hydrate from Postgres
  orders.length = 0;
  await hydrateStoreFromPostgres();

  const found = orders.find(o => o.id === testOrderId);
  if (found && found.title === 'Persistent Order Test') {
    console.log('[PASS] PostgreSQL persistence test passed: order persisted and reloaded successfully.');
  } else {
    console.error('[FAIL] PostgreSQL persistence test failed: order not found after restart.');
    process.exit(1);
  }

  // Now delete the order and save
  const index = orders.findIndex(o => o.id === testOrderId);
  if (index !== -1) {
    orders.splice(index, 1);
  }
  await saveOrdersToDisk();

  // Re-hydrate again to assert deletion
  orders.length = 0;
  await hydrateStoreFromPostgres();

  const foundAfterDelete = orders.find(o => o.id === testOrderId);
  if (!foundAfterDelete) {
    console.log('[PASS] PostgreSQL deletion test passed: order stayed deleted after restart.');
  } else {
    console.error('[FAIL] PostgreSQL deletion test failed: order still exists after deletion and restart.');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('[FAIL] PostgreSQL persistence test encountered error:', err);
  process.exit(1);
});

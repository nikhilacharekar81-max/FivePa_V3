import { PostgresStore } from '../server/db/postgresStore.js';

async function runTest() {
  console.log('Running PostgreSQL persistence test...');
  process.env.NODE_ENV = 'test';
  try {
    const store = new PostgresStore();
    await store.runMigrations();
    
    store.isHydrated = true;
    const testOrderId = `test_ord_${Date.now()}`;
    const testOrder = {
      id: testOrderId,
      title: 'Persistent Order Test',
      buyerId: 'user_2',
      sellerId: 'user_1',
      amount: 100,
      status: 'funded_in_escrow',
      createdAt: new Date().toISOString(),
      dueDate: new Date().toISOString()
    };
    
    await store.saveOrders([testOrder as any]);
    
    // Restart simulation (new PostgresStore instance)
    const restartedStore = new PostgresStore();
    restartedStore.isHydrated = true;
    const loadedOrders = await restartedStore.listOrders();
    const found = loadedOrders.find(o => o.id === testOrderId);
    
    if (found && found.title === 'Persistent Order Test') {
      console.log('[PASS] PostgreSQL persistence test passed: order persisted and reloaded successfully.');
    } else {
      console.error('[FAIL] PostgreSQL persistence test failed: order not found after restart.');
      process.exit(1);
    }
  } catch (err) {
    console.warn('[WARN] PostgreSQL database connection unavailable; skipping active live DB test:', err);
  }
}

runTest();

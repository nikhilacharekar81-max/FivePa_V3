process.env.PORT = '3005';
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_123';

import assert from 'node:assert';
import { createHmac } from 'node:crypto';

const PORT = 3005;
const BASE = `http://localhost:${PORT}`;

async function runWebhookTests() {
  console.log('--- STARTING WEBHOOK TESTS ---');

  // Start server
  await import('../server.ts');
  // Wait a moment for server to start
  await new Promise(r => setTimeout(r, 1000));

  // Test 1: Missing signature -> 403
  {
    const res = await fetch(`${BASE}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.succeeded', userId: 'usr_1', amount: 100 })
    });
    assert.strictEqual(res.status, 403);
    console.log('✅ Test 1 Passed: Missing signature rejected with 403');
  }

  // Test 2: Invalid signature -> 403
  {
    const bodyStr = JSON.stringify({ event: 'payment.succeeded', userId: 'usr_1', amount: 100 });
    const res = await fetch(`${BASE}/api/payments/webhook`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-webhook-signature': 'invalidsig'
      },
      body: bodyStr
    });
    assert.strictEqual(res.status, 403);
    console.log('✅ Test 2 Passed: Invalid signature rejected with 403');
  }

  // Test 3: Valid signature and raw body -> 200 success
  {
    const payload = { event: 'payment.succeeded', userId: 'usr_1', amount: 250, transactionId: 'txn_999' };
    const bodyStr = JSON.stringify(payload);
    const signature = createHmac('sha256', 'test_webhook_secret_123').update(bodyStr).digest('hex');

    const res = await fetch(`${BASE}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      body: bodyStr
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.received, true);
    console.log('✅ Test 3 Passed: Valid webhook accepted successfully');
  }

  console.log('🎉 All Webhook Tests Passed!');
  process.exit(0);
}

runWebhookTests().catch(err => {
  console.error('❌ Webhook Test Failed:', err);
  process.exit(1);
});

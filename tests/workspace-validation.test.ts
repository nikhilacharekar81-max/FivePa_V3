process.env.PORT = '3006';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 3006;
const BASE = `http://localhost:${PORT}`;

async function api(p: string, opts: { method?: string; token?: string; body?: any } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${p}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch (e) { json = { error: 'Not JSON', text }; }
  return { status: res.status, json };
}

async function demoToken(userId: string): Promise<string> {
  const r = await api('/api/auth/demo-session', { method: 'POST', body: { userId } });
  return r.json.token;
}

async function runTests() {
  console.log('--- STARTING WORKSPACE VALIDATION TESTS ---');
  await import('../server.ts');
  await new Promise(r => setTimeout(r, 1000));

  // 1. Setup: Create a workspace owned by user_1 (buyer) and user_3 (seller)
  const token1 = await demoToken('user_1');
  await api('/api/wallet/deposit', { method: 'POST', token: token1, body: { amount: 5000 } });
  
  // Create a project as user_1
  const project = await api('/api/projects', { method: 'POST', token: token1, body: { title: 'Test Project', description: 'desc', budget: 100 } });
  if (!project.json.id) {
    console.error('Project creation failed:', JSON.stringify(project.json, null, 2));
    process.exit(1);
  }
  const projectId = project.json.id;

  // Create proposal as user_3
  const token3 = await demoToken('user_3');
  const proposal = await api(`/api/proposals`, { method: 'POST', token: token3, body: { projectId, bidAmount: 100, coverLetter: 'hi' } });
  if (!proposal.json.id) {
    console.error('Proposal creation failed:', JSON.stringify(proposal.json, null, 2));
    process.exit(1);
  }
  
  // Accept proposal as user_1 to create the workspace
  const acceptRes = await api(`/api/proposals/${proposal.json.id}/accept`, { method: 'POST', token: token1 });
  if (!acceptRes.json.workspace) {
    console.error('Accept proposal failed or no workspace returned:', JSON.stringify(acceptRes.json, null, 2));
    process.exit(1);
  }
  const workspaceId = acceptRes.json.workspace.workspaceId;

  // 2. Test: Try to place an order to user_2 (different seller) using the workspace belonging to user_3
  const token2 = await demoToken('user_2');
  
  const orderRes = await api('/api/orders', {
    method: 'POST',
    token: token1,
    body: {
      title: 'Invalid Workspace Order',
      sellerId: 'user_2',
      amount: 50,
      workspaceId: workspaceId
    }
  });

  assert.strictEqual(orderRes.status, 400, 'Should reject mismatched workspace with 400');
  assert.strictEqual(orderRes.json.error, 'The provided workspace does not match the buyer and seller of this order.');

  console.log('✅ Test Passed: Mismatched workspace rejected successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});

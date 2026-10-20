import assert from 'node:assert';
import { Proposal, Order } from '../src/types';

const orders: Order[] = [
  { 
    id: 'ord_1', 
    proposalId: 'prop_1', 
    title: 'Order 1', 
    buyerId: 'u1', 
    sellerId: 'u2', 
    amount: 100, 
    status: 'in_progress', 
    createdAt: '2023-01-01', 
    dueDate: '2023-01-10' 
  }
];

const proposal: Proposal = { 
  id: 'prop_2', 
  projectId: 'proj_1', 
  freelancerId: 'u2', 
  freelancerName: 'Freelancer Two',
  freelancerAvatar: 'https://avatar.png',
  freelancerTitle: 'Dev',
  deliveryDays: 5,
  createdAt: '2023-01-02',
  status: 'pending', 
  bidAmount: 100, 
  coverLetter: '' 
};

// The function logic extracted from ProjectDetailView.tsx
const resolveProposalWorkstreamId = (prop: Proposal): string | undefined => {
  if (prop.workstreamOrderId) return prop.workstreamOrderId;
  return orders.find(o => o.proposalId && o.proposalId === prop.id)?.id;
};

assert.strictEqual(resolveProposalWorkstreamId(proposal), undefined, 'Should not match prop_2 to ord_1 just by project/freelancer');
console.log('✅ Test Passed: Proposal workstream linking is restricted to proposalId');

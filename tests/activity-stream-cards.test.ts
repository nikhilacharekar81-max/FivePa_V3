import assert from 'node:assert';
import { WorkstreamMessage } from '../src/components/workstream/types';
import { classifyActivityEvent, EventCategory } from '../src/components/workstream/activityClassifier';

// Test suite verifying that every category of workstream event maps to a polished visual card
const sampleEvents: Array<{ name: string; msg: WorkstreamMessage; expectedCategory: EventCategory }> = [
  // 1. Escrow Events
  {
    name: 'Escrow deposit funded',
    msg: {
      id: 'm1',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour Escrow Vault',
      text: '🛡️ 14-Day Escrow Protection active: $1,500 USD deposited into secure escrow vault.',
      timestamp: '2026-03-02T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'escrow_funded', amount: 1500 }
    },
    expectedCategory: 'escrow'
  },
  {
    name: 'Escrow top-up funded',
    msg: {
      id: 'm1_topup',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour Escrow Vault',
      text: '🔒 Additional $500 USD funded into escrow for "Phase 2".',
      timestamp: '2026-03-02T12:00:00.000Z',
      type: 'system',
      metadata: { action: 'escrow_funded', amount: 500, isTopUp: true }
    },
    expectedCategory: 'escrow'
  },
  {
    name: 'Escrow released',
    msg: {
      id: 'm2',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour Escrow Vault',
      text: '🎉 Escrow funds ($1,500) released to Marcus Vance! Workstream completed with 5-star rating.',
      timestamp: '2026-03-02T15:00:00.000Z',
      type: 'system',
      metadata: { action: 'escrow_released', amount: 1500 }
    },
    expectedCategory: 'escrow'
  },
  {
    name: 'Escrow refunded',
    msg: {
      id: 'm3',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour Escrow Vault',
      text: '💸 Escrow refunded ($1,500) to buyer wallet. Reason: mutual cancellation',
      timestamp: '2026-03-03T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'escrow_refunded', refunded: 1500 }
    },
    expectedCategory: 'escrow'
  },

  // 2. Deliverable Events
  {
    name: 'Deliverable submitted',
    msg: {
      id: 'm4',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '📦 Delivery / Final Invoice #v1 submitted (escrow_v1.zip | Reference: https://github.com).',
      timestamp: '2026-03-04T12:00:00.000Z',
      type: 'system',
      metadata: {
        action: 'deliverable_submitted',
        version: 1,
        files: [{ name: 'escrow_v1.zip', size: '14.2 MB', url: '#' }],
        reference: 'https://github.com'
      }
    },
    expectedCategory: 'delivery'
  },
  {
    name: 'Deliverable approved',
    msg: {
      id: 'm5',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '✅ Deliverables approved by buyer.',
      timestamp: '2026-03-04T14:00:00.000Z',
      type: 'system',
      metadata: { action: 'deliverable_approved' }
    },
    expectedCategory: 'delivery'
  },

  // 3. Revision Events
  {
    name: 'Revision requested',
    msg: {
      id: 'm6',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Revision requested: "Please update the color contrast on the dashboard buttons."',
      timestamp: '2026-03-04T16:00:00.000Z',
      type: 'system',
      metadata: {
        action: 'revision_requested',
        reason: 'Please update the color contrast on the dashboard buttons.',
        deliveryVersion: 1
      }
    },
    expectedCategory: 'revision'
  },
  {
    name: 'Revision resolved',
    msg: {
      id: 'm7',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '📝 Revision resolved via Delivery #v2.',
      timestamp: '2026-03-05T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'revision_resolved', deliveryVersion: 2 }
    },
    expectedCategory: 'revision'
  },

  // 4. Invoice & Payment Events
  {
    name: 'Invoice paid',
    msg: {
      id: 'm9',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'INV-1001 was accepted and escrow funds ($950) were released to the seller. Order completed!',
      timestamp: '2026-03-05T12:00:00.000Z',
      type: 'system',
      metadata: { action: 'offer_paid', offerKind: 'invoice' }
    },
    expectedCategory: 'invoice'
  },
  {
    name: 'Invoice declined',
    msg: {
      id: 'm9_dec',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Invoice declined by buyer.',
      timestamp: '2026-03-05T13:00:00.000Z',
      type: 'system',
      metadata: { action: 'offer_declined', offerKind: 'invoice' }
    },
    expectedCategory: 'invoice'
  },

  // 5. Proposal Events
  {
    name: 'Proposal submitted',
    msg: {
      id: 'm10_sub',
      orderId: 'ord_1',
      senderId: 'user_3',
      senderName: 'Marcus Vance',
      text: 'Custom proposal submitted for review: $850 USD for 5 days delivery.',
      timestamp: '2026-03-01T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'proposal_submitted', amount: 850, deliveryDays: 5 }
    },
    expectedCategory: 'proposal'
  },
  {
    name: 'Proposal accepted',
    msg: {
      id: 'm11',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'PRP-1001 was accepted and escrow was funded ($850).',
      timestamp: '2026-03-01T11:00:00.000Z',
      type: 'system',
      metadata: { action: 'offer_accepted', offerKind: 'proposal' }
    },
    expectedCategory: 'proposal'
  },
  {
    name: 'Proposal declined',
    msg: {
      id: 'm11_dec',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Proposal declined by buyer.',
      timestamp: '2026-03-01T12:00:00.000Z',
      type: 'system',
      metadata: { action: 'proposal_declined' }
    },
    expectedCategory: 'proposal'
  },
  {
    name: 'Proposal withdrawn',
    msg: {
      id: 'm11_with',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Proposal withdrawn by freelancer.',
      timestamp: '2026-03-01T13:00:00.000Z',
      type: 'system',
      metadata: { action: 'proposal_withdrawn' }
    },
    expectedCategory: 'proposal'
  },

  // 6. Project Events
  {
    name: 'Project published',
    msg: {
      id: 'm_proj_pub',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '🚀 Project "Enterprise AI Search Engine" published to marketplace.',
      timestamp: '2026-02-28T09:00:00.000Z',
      type: 'system',
      metadata: { action: 'project_published', title: 'Enterprise AI Search Engine' }
    },
    expectedCategory: 'project'
  },
  {
    name: 'Project updated',
    msg: {
      id: 'm_proj_upd',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Project brief updated: Added Node.js WebSocket support requirements.',
      timestamp: '2026-02-28T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'project_updated' }
    },
    expectedCategory: 'project'
  },
  {
    name: 'Project closed',
    msg: {
      id: 'm_proj_close',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Project closed to new proposals.',
      timestamp: '2026-02-28T14:00:00.000Z',
      type: 'system',
      metadata: { action: 'project_closed' }
    },
    expectedCategory: 'project'
  },

  // 7. Review Events
  {
    name: 'Review submitted',
    msg: {
      id: 'm12',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '⭐ Review submitted by Alex Rivera (5/5 stars): "Exceptional work on the escrow vault!"',
      timestamp: '2026-03-06T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'review_submitted', rating: 5, comment: 'Exceptional work on the escrow vault!' }
    },
    expectedCategory: 'review'
  },
  {
    name: 'Seller review response',
    msg: {
      id: 'm13',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '💬 Public response posted by seller Marcus Vance: "Thank you Alex, pleasure collaborating!"',
      timestamp: '2026-03-06T11:00:00.000Z',
      type: 'system',
      metadata: { action: 'review_reply_submitted', reply: { text: 'Thank you Alex, pleasure collaborating!' } }
    },
    expectedCategory: 'review'
  },

  // 8. Order & Hiring Events
  {
    name: 'Freelancer hired',
    msg: {
      id: 'm_hired',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '🤝 Freelancer Marcus Vance hired for project "Payment Dashboard". Contract active.',
      timestamp: '2026-03-01T08:30:00.000Z',
      type: 'system',
      metadata: { action: 'freelancer_hired' }
    },
    expectedCategory: 'order'
  },
  {
    name: 'Order placed',
    msg: {
      id: 'm14',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Order placed: Build Escrow Payment Dashboard. Payment is held in escrow until the work is approved.',
      timestamp: '2026-03-01T09:00:00.000Z',
      type: 'system',
      metadata: { action: 'order_created' }
    },
    expectedCategory: 'order'
  },
  {
    name: 'Order auto-accepted',
    msg: {
      id: 'm15',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '🎉 Order #ord_101 automatically accepted: Buyer review window closed without revisions or dispute.',
      timestamp: '2026-03-15T09:00:00.000Z',
      type: 'system',
      metadata: { action: 'order_auto_accepted' }
    },
    expectedCategory: 'order'
  },

  // 9. Dispute & Cancellation Events
  {
    name: 'Dispute opened',
    msg: {
      id: 'm16',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '🚨 Dispute opened by user_1: "Deliverables missed required specification". Order placed under review.',
      timestamp: '2026-03-10T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'dispute_opened' }
    },
    expectedCategory: 'dispute'
  },
  {
    name: 'Dispute resolved',
    msg: {
      id: 'm17',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '⚖️ Dispute resolved by administrator: resolved_release. Notes: Specifications fulfilled upon audit.',
      timestamp: '2026-03-12T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'dispute_resolved', status: 'resolved_release', notes: 'Specifications fulfilled.' }
    },
    expectedCategory: 'dispute'
  },
  {
    name: 'Mutual cancellation requested',
    msg: {
      id: 'm_cancel_req',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Mutual cancellation requested by buyer.',
      timestamp: '2026-03-11T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'mutual_cancellation_requested' }
    },
    expectedCategory: 'cancellation'
  },

  // 10. Schedule & Timer Events
  {
    name: 'Deadline extended',
    msg: {
      id: 'm18',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '⏱️ Deadline extended from 2026-03-14 to 2026-03-20. Reason: API dependencies pending client approval.',
      timestamp: '2026-03-08T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'order_deadline_extended', oldDate: '2026-03-14', newDueDate: '2026-03-20' }
    },
    expectedCategory: 'deadline'
  },
  {
    name: 'Timer paused',
    msg: {
      id: 'm19',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '⏸️ Delivery countdown paused by Administrator. Timer held.',
      timestamp: '2026-03-08T12:00:00.000Z',
      type: 'system',
      metadata: { action: 'timer_paused' }
    },
    expectedCategory: 'timer'
  },

  // 11. Meeting & Video Calls
  {
    name: 'Missed video call',
    msg: {
      id: 'm_missed',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '📞 Missed video call from Alex Rivera at 10:15 AM.',
      timestamp: '2026-03-08T10:15:00.000Z',
      type: 'system',
      metadata: { action: 'missed_call' }
    },
    expectedCategory: 'meeting'
  },
  {
    name: 'Video meeting session',
    msg: {
      id: 'm_call_session',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '📹 Video meeting ended. Duration: 24 minutes.',
      timestamp: '2026-03-08T11:00:00.000Z',
      type: 'system',
      metadata: { action: 'video_call_ended', duration: 24 }
    },
    expectedCategory: 'meeting'
  },

  // 12. Milestones
  {
    name: 'Project milestone updated',
    msg: {
      id: 'm_milestone',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'Milestone update: Core state synchronization complete.',
      timestamp: '2026-03-09T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'milestone_submitted', milestoneTitle: 'Core State Sync' }
    },
    expectedCategory: 'milestone'
  },

  // 13. Tip & Bonus
  {
    name: 'Tip added',
    msg: {
      id: 'm_tip',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '💰 Bonus tip of $50 USD added to order by Alex Rivera.',
      timestamp: '2026-03-07T10:00:00.000Z',
      type: 'system',
      metadata: { action: 'tip_added', amount: 50 }
    },
    expectedCategory: 'tip_bonus'
  },

  // 14. Moderation & Requirements
  {
    name: 'Chat muted',
    msg: {
      id: 'm20',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: '🔒 Chat locked by Administrator. Messaging paused during review.',
      timestamp: '2026-03-08T14:00:00.000Z',
      type: 'system',
      metadata: { action: 'chat_muted' }
    },
    expectedCategory: 'chat_moderation'
  },
  {
    name: 'Requirements logged',
    msg: {
      id: 'm21',
      orderId: 'ord_1',
      senderId: 'user_1',
      senderName: 'Alex Rivera',
      text: 'Project requirements: Implement React 19 UI with Tailwind CSS and WebSocket state synchronization.',
      timestamp: '2026-03-01T09:30:00.000Z',
      type: 'message',
      metadata: { action: 'requirements_logged' }
    },
    expectedCategory: 'requirements'
  },

  // 15. Generic fallback activity
  {
    name: 'Custom system notice',
    msg: {
      id: 'm22',
      orderId: 'ord_1',
      senderId: 'system',
      senderName: 'WorkPerHour System',
      text: 'New workspace participant invited: David Miller joined as technical auditor.',
      timestamp: '2026-03-02T11:00:00.000Z',
      type: 'system'
    },
    expectedCategory: 'generic_activity'
  }
];

console.log('Testing Workstream Activity Stream Event Cards Classifier...');
let passed = 0;
for (const sample of sampleEvents) {
  const result = classifyActivityEvent(sample.msg);
  assert.strictEqual(
    result.category,
    sample.expectedCategory,
    `Event "${sample.name}" should classify as "${sample.expectedCategory}", got "${result.category}"`
  );
  assert.ok(result.title, `Event "${sample.name}" must have a non-empty title`);
  assert.ok(result.categoryLabel, `Event "${sample.name}" must have a non-empty categoryLabel`);
  assert.ok(result.headerCls, `Event "${sample.name}" must have header styles`);
  assert.ok(result.iconBgCls, `Event "${sample.name}" must have iconBg styles`);
  passed++;
  console.log(`  ✓ ${sample.name} -> Classified as [${result.category}] "${result.title}"`);
}

console.log(`\n🎉 All ${passed} comprehensive Workstream Activity Card categories classified and verified!`);

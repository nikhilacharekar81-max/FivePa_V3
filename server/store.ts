import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { financeLedger } from '../src/server/financeLedger.js';
import { siteSettings, DEFAULT_SITE_SETTINGS } from '../src/server/siteSettings.js';
import { workspaceService } from '../src/server/workspaceService.js';
import { paymentGatewayManager } from '../src/server/paymentGateways.js';
import { OrderFeeBreakdown } from '../src/shared/fees.js';

export { financeLedger, siteSettings, DEFAULT_SITE_SETTINGS };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const WORKSTREAM_UPLOADS_DIR = path.join(DATA_DIR, 'workstream_uploads');

// Canonical Interfaces from src/types.js
import type {
  User,
  GigExtra,
  Gig,
  Project,
  Proposal,
  Order,
  Dispute,
  WorkstreamOfferKind,
  WorkstreamOfferStatus,
  WorkstreamOffer,
  CustomInvoice,
  Refund,
  Payout,
  Category,
  Review,
  SupportTicket,
  AuditLog,
  Message,
  UserEmail,
  SiteFeeSettings,
  WorkstreamUploadRecord,
  Notification
} from '../src/types.js';

export type {
  User,
  GigExtra,
  Gig,
  Project,
  Proposal,
  Order,
  Dispute,
  WorkstreamOfferKind,
  WorkstreamOfferStatus,
  WorkstreamOffer,
  CustomInvoice,
  Refund,
  Payout,
  Category,
  Review,
  SupportTicket,
  AuditLog,
  Message,
  UserEmail,
  SiteFeeSettings,
  WorkstreamUploadRecord,
  Notification
};

export let notifications: Notification[] = [];

// ==========================================
// STORE INTERFACE (Prompt A requirement)
// ==========================================
export interface StoreInterface {
  getOrder(id: string): Order | undefined;
  saveOrder(order: Order): void;
  listOrders(): Order[];
  listMessages(orderId: string): Message[];
  addMessage(message: Message): void;
  addReview(review: Review): void;
  listReviews(): Review[];
  getUploadRecord(filename: string): WorkstreamUploadRecord | undefined;
  saveUploadRecord(filename: string, record: WorkstreamUploadRecord): void;
  listUploadRecords(): Record<string, WorkstreamUploadRecord>;
  deleteUploadRecord(filename: string): void;
}



export let bootstrapAdminPasswordNotice: string | null = null;

function randomPasswordHash(): string {
  const plain = randomBytes(24).toString('base64url');
  return bcrypt.hashSync(plain, 10);
}

function seedPasswordHashFor(role: string): string {
  if (role === 'super_admin') {
    const configured = process.env.ADMIN_INITIAL_PASSWORD;
    if (configured && configured.length >= 12) return bcrypt.hashSync(configured, 10);
    const generated = randomBytes(18).toString('base64url');
    bootstrapAdminPasswordNotice = generated;
    return bcrypt.hashSync(generated, 10);
  }
  return bcrypt.hashSync('password123', 10);
}

// In-Memory Data Collections (capable of starting clean with zero records)
export let users: User[] = [];
export let gigs: Gig[] = [];
export let orders: Order[] = [];
export let projects: Project[] = [];
export let proposals: Proposal[] = [];
export let reviews: Review[] = [];
export let messages: Message[] = [];

export let disputes: Dispute[] = [];
export let refunds: Refund[] = [];
export let payouts: Payout[] = [];
export let customInvoices: CustomInvoice[] = [];
export let workstreamOffers: WorkstreamOffer[] = [];

export let categories: Category[] = [
  {
    id: 'cat_ai',
    name: 'AI Services',
    slug: 'ai-services',
    enabled: true,
    order: 1,
    subcategories: [
      { id: 'sub_ai_1', name: 'Generative AI', slug: 'generative-ai', enabled: true },
      { id: 'sub_ai_2', name: 'AI Applications', slug: 'ai-applications', enabled: true },
      { id: 'sub_ai_3', name: 'AI Agents', slug: 'ai-agents', enabled: true },
      { id: 'sub_ai_4', name: 'Prompt Engineering', slug: 'prompt-engineering', enabled: true },
      { id: 'sub_ai_5', name: 'Machine Learning & Data Science', slug: 'machine-learning-data-science', enabled: true },
      { id: 'sub_ai_6', name: 'ChatGPT Integration', slug: 'chatgpt-integration', enabled: true },
      { id: 'sub_ai_7', name: 'Midjourney & AI Art', slug: 'ai-art', enabled: true }
    ]
  },
  {
    id: 'cat_tech',
    name: 'Technology & Programming',
    slug: 'tech-programming',
    enabled: true,
    order: 2,
    subcategories: [
      { id: 'sub_tech_1', name: 'Web Development', slug: 'web-development', enabled: true },
      { id: 'sub_tech_2', name: 'Mobile Apps', slug: 'mobile-apps', enabled: true },
      { id: 'sub_tech_3', name: 'DevOps & Cloud', slug: 'devops-cloud', enabled: true },
      { id: 'sub_tech_4', name: 'Database & SQL', slug: 'database-sql', enabled: true },
      { id: 'sub_tech_5', name: 'Security & Penetration Testing', slug: 'security', enabled: true },
      { id: 'sub_tech_6', name: 'APIs & Integrations', slug: 'apis-integrations', enabled: true },
      { id: 'sub_tech_7', name: 'QA & Testing', slug: 'qa-testing', enabled: true }
    ]
  },
  {
    id: 'cat_design',
    name: 'Design & Creative',
    slug: 'design-creative',
    enabled: true,
    order: 3,
    subcategories: [
      { id: 'sub_des_1', name: 'Logo & Brand Identity', slug: 'logo-brand-identity', enabled: true },
      { id: 'sub_des_2', name: 'UI/UX Design', slug: 'ui-ux-design', enabled: true },
      { id: 'sub_des_3', name: 'Illustration', slug: 'illustration', enabled: true },
      { id: 'sub_des_4', name: '3D & Industrial Design', slug: '3d-design', enabled: true },
      { id: 'sub_des_5', name: 'Animation', slug: 'animation', enabled: true },
      { id: 'sub_des_6', name: 'Print & Packaging', slug: 'print-packaging', enabled: true },
      { id: 'sub_des_7', name: 'Social Media Graphics', slug: 'social-graphics', enabled: true }
    ]
  },
  {
    id: 'cat_writing',
    name: 'Writing & Translation',
    slug: 'writing-translation',
    enabled: true,
    order: 4,
    subcategories: [
      { id: 'sub_wri_1', name: 'Copywriting', slug: 'copywriting', enabled: true },
      { id: 'sub_wri_2', name: 'Content Marketing & SEO Articles', slug: 'seo-articles', enabled: true },
      { id: 'sub_wri_3', name: 'Technical Writing', slug: 'technical-writing', enabled: true },
      { id: 'sub_wri_4', name: 'Translation & Localization', slug: 'translation', enabled: true },
      { id: 'sub_wri_5', name: 'Proofreading & Editing', slug: 'proofreading', enabled: true },
      { id: 'sub_wri_6', name: 'Ghostwriting', slug: 'ghostwriting', enabled: true },
      { id: 'sub_wri_7', name: 'Scriptwriting', slug: 'scriptwriting', enabled: true }
    ]
  },
  {
    id: 'cat_marketing',
    name: 'Digital Marketing',
    slug: 'digital-marketing',
    enabled: true,
    order: 5,
    subcategories: [
      { id: 'sub_mkt_1', name: 'Search Engine Optimization (SEO)', slug: 'seo', enabled: true },
      { id: 'sub_mkt_2', name: 'Social Media Marketing', slug: 'social-media-marketing', enabled: true },
      { id: 'sub_mkt_3', name: 'Pay-Per-Click (PPC) Advertising', slug: 'ppc-advertising', enabled: true },
      { id: 'sub_mkt_4', name: 'Email Marketing', slug: 'email-marketing', enabled: true },
      { id: 'sub_mkt_5', name: 'Marketing Strategy', slug: 'marketing-strategy', enabled: true },
      { id: 'sub_mkt_6', name: 'Influencer Marketing', slug: 'influencer-marketing', enabled: true },
      { id: 'sub_mkt_7', name: 'Affiliate Marketing', slug: 'affiliate-marketing', enabled: true }
    ]
  },
  {
    id: 'cat_video',
    name: 'Video & Animation',
    slug: 'video-animation',
    enabled: true,
    order: 6,
    subcategories: [
      { id: 'sub_vid_1', name: 'Video Editing', slug: 'video-editing', enabled: true },
      { id: 'sub_vid_2', name: 'Motion Graphics', slug: 'motion-graphics', enabled: true },
      { id: 'sub_vid_3', name: 'Visual Effects (VFX)', slug: 'vfx', enabled: true },
      { id: 'sub_vid_4', name: 'Explainer Videos', slug: 'explainer-videos', enabled: true },
      { id: 'sub_vid_5', name: 'Shorts & Reels Editing', slug: 'shorts-reels', enabled: true },
      { id: 'sub_vid_6', name: 'Intro & Outro Videos', slug: 'intros-outros', enabled: true },
      { id: 'sub_vid_7', name: 'Product Demo Videos', slug: 'product-demos', enabled: true }
    ]
  },
  {
    id: 'cat_business',
    name: 'Business & Consulting',
    slug: 'business-consulting',
    enabled: true,
    order: 7,
    subcategories: [
      { id: 'sub_bus_1', name: 'Business Plans & Strategy', slug: 'business-plans', enabled: true },
      { id: 'sub_bus_2', name: 'Financial Modeling & Forecasting', slug: 'financial-modeling', enabled: true },
      { id: 'sub_bus_3', name: 'Market Research', slug: 'market-research', enabled: true },
      { id: 'sub_bus_4', name: 'Virtual Assistance', slug: 'virtual-assistant', enabled: true },
      { id: 'sub_bus_5', name: 'Legal Consulting', slug: 'legal-consulting', enabled: true },
      { id: 'sub_bus_6', name: 'Project Management', slug: 'project-management', enabled: true },
      { id: 'sub_bus_7', name: 'HR & Recruiting', slug: 'hr-recruiting', enabled: true }
    ]
  },
  {
    id: 'cat_audio',
    name: 'Music & Audio',
    slug: 'music-audio',
    enabled: true,
    order: 8,
    subcategories: [
      { id: 'sub_aud_1', name: 'Voice Over', slug: 'voice-over', enabled: true },
      { id: 'sub_aud_2', name: 'Mixing & Mastering', slug: 'mixing-mastering', enabled: true },
      { id: 'sub_aud_3', name: 'Music Production', slug: 'music-production', enabled: true },
      { id: 'sub_aud_4', name: 'Podcast Editing', slug: 'podcast-editing', enabled: true },
      { id: 'sub_aud_5', name: 'Sound Design', slug: 'sound-design', enabled: true },
      { id: 'sub_aud_6', name: 'Audio Production', slug: 'audio-production', enabled: true },
      { id: 'sub_aud_7', name: 'Jingles & Intros', slug: 'jingles-intros', enabled: true }
    ]
  }
];

export let supportTickets: SupportTicket[] = [];
export let auditLogs: AuditLog[] = [];
export let userEmails: UserEmail[] = [];
export let workstreamUploadIndex: Record<string, WorkstreamUploadRecord> = {};

export const requestKeyCache = new Map<string, any>();
export const releaseCompletedOrders = new Set<string>();

export let siteFeeSettings: SiteFeeSettings = {
  platformName: 'WorkPerHour',
  supportEmail: 'support@workperhour.com',
  currency: 'USD',
  currencySymbol: '$',
  freelancerCommissionRate: 20,
  buyerProcessingFeeRate: DEFAULT_SITE_SETTINGS.commission.buyerProcessingFeePercent,
  smallOrderFee: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeAmount,
  smallOrderFeeThreshold: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeThreshold,
  minOrderAmount: 10,
  featuredGigFee: 10,
  urgentProjectFee: 25,
  escrowHoldDays: 14,
  autoCompleteDeliveredDays: 3,
  autoCompleteDeliveredEnabled: true,
  disputeWindowDays: 14,
  minPayoutThreshold: 50,
  instantPayoutFeeRate: 2,
  freelancerOnboardingMode: 'open',
  maintenanceMode: false,
  updatedAt: new Date().toISOString().split('T')[0],
  updatedBy: 'System Init'
};

import { postgresStore, isPostgresEnabled } from './db/postgresStore.js';

// Implement StoreInterface backed by PostgreSQL & in-memory cache
export class HybridPostgresStore implements StoreInterface {
  getOrder(id: string): Order | undefined {
    return orders.find(o => o.id === id);
  }
  saveOrder(order: Order): void {
    const idx = orders.findIndex(o => o.id === order.id);
    if (idx >= 0) {
      orders[idx] = order;
    } else {
      orders.unshift(order);
    }
    saveOrdersToDisk();
  }
  listOrders(): Order[] {
    return orders;
  }
  listMessages(orderId: string): Message[] {
    return messages.filter(m => m.orderId === orderId);
  }
  addMessage(message: Message): void {
    messages.push(message);
    saveMessagesToDisk();
  }
  addReview(review: Review): void {
    reviews.unshift(review);
    saveReviewsToDisk();
  }
  listReviews(): Review[] {
    return reviews;
  }
  getUploadRecord(filename: string): WorkstreamUploadRecord | undefined {
    return workstreamUploadIndex[filename];
  }
  saveUploadRecord(filename: string, record: WorkstreamUploadRecord): void {
    workstreamUploadIndex[filename] = record;
    saveWorkstreamUploadIndex();
  }
  listUploadRecords(): Record<string, WorkstreamUploadRecord> {
    return workstreamUploadIndex;
  }
  deleteUploadRecord(filename: string): void {
    delete workstreamUploadIndex[filename];
    postgresStore.deleteUploadRecord(filename).catch(console.error);
  }
}

export const store: StoreInterface = new HybridPostgresStore();


export function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WORKSTREAM_UPLOADS_DIR)) {
    fs.mkdirSync(WORKSTREAM_UPLOADS_DIR, { recursive: true });
  }
}

const writeQueue = new Map<string, Promise<void>>();

export async function writeJsonAtomic(filePath: string, data: any) {
  // Deprecated: No longer using JSON files for runtime data.
  return Promise.resolve();
}

export function saveMessagesToDisk() { 
  return postgresStore.saveMessages(messages).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save messages to database:', err);
  });
}
export function saveOrdersToDisk() { 
  return postgresStore.saveOrders(orders).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save orders to database:', err);
  });
}
export function saveReviewsToDisk() { 
  return postgresStore.saveReviews(reviews).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save reviews to database:', err);
  });
}
export function saveWorkstreamUploadIndex() {
  const promises = [];
  for (const [fn, rec] of Object.entries(workstreamUploadIndex)) {
    promises.push(
      postgresStore.saveUploadRecord(fn, rec).catch(err => {
        console.error('[PostgresStore ERROR] CRITICAL: Failed to save upload record to database:', err);
      })
    );
  }
  return Promise.all(promises);
}


export function loadInitialOrdersAndMessages() {
  // Deprecated: Data is now loaded from PostgreSQL via hydrateStoreFromPostgres()
}

export function syncUserBalances() {
  for (const u of users) {
    const b = financeLedger.getWalletBalance(u.id);
    if (b !== null) u.walletBalance = b;
  }
}

export function ensureWallet(userId: string) {
  const u = users.find(x => x.id === userId);
  if (!u || u.role === 'admin' || u.role === 'super_admin') return;
  const isFreelancer = gigs.some(g => g.freelancerId === u.id) || orders.some(o => o.sellerId === u.id) || u.role === 'freelancer' || u.role === 'seller';
  financeLedger.ensureWallet({ userId: u.id, name: u.name, email: u.email, role: isFreelancer ? 'freelancer' : 'buyer' });
}


export async function hydrateStoreFromPostgres() {
  if (!isPostgresEnabled()) {
    postgresStore.isHydrated = true;
    console.log('DEV mode: Postgres disabled, data not persisted');
    for (const u of users) {
      ensureWallet(u.id);
    }
    syncUserBalances();
    return;
  }

  try {
    await postgresStore.runMigrations();
  } catch (err) {
    if (isPostgresEnabled()) {
      console.error('CRITICAL: Database unreachable or migrations failed at startup:', err);
      throw err;
    }
  }

  console.log('[PostgresStore] Loading records from Postgres into memory...');
  try {
    const loadedUsers = await postgresStore.listUsers();
    if (loadedUsers) {
      users.length = 0;
      users.push(...loadedUsers);
    }

    const loadedGigs = await postgresStore.listGigs();
    if (loadedGigs) {
      gigs.length = 0;
      gigs.push(...loadedGigs);
    }

    const loadedProjects = await postgresStore.listProjects();
    if (loadedProjects) {
      projects.length = 0;
      projects.push(...loadedProjects);
    }

    const loadedProposals = await postgresStore.listProposals();
    if (loadedProposals) {
      proposals.length = 0;
      proposals.push(...loadedProposals);
    }

    const loadedOrders = await postgresStore.listOrders();
    if (loadedOrders) {
      orders.length = 0;
      orders.push(...loadedOrders);
    }

    const loadedMessages = await postgresStore.listMessages();
    if (loadedMessages) {
      messages.length = 0;
      messages.push(...loadedMessages);
    }

    const loadedReviews = await postgresStore.listReviews();
    if (loadedReviews) {
      reviews.length = 0;
      reviews.push(...loadedReviews);
    }

      const loadedDisputes = await postgresStore.listDisputes();
      if (loadedDisputes.length > 0) { disputes.length = 0; disputes.push(...loadedDisputes); }

      const loadedRefunds = await postgresStore.listRefunds();
      if (loadedRefunds.length > 0) { refunds.length = 0; refunds.push(...loadedRefunds); }

      const loadedPayouts = await postgresStore.listPayouts();
      if (loadedPayouts.length > 0) { payouts.length = 0; payouts.push(...loadedPayouts); }

      const loadedTickets = await postgresStore.listSupportTickets();
      if (loadedTickets.length > 0) { supportTickets.length = 0; supportTickets.push(...loadedTickets); }

      const loadedLogs = await postgresStore.listAuditLogs();
      if (loadedLogs.length > 0) { auditLogs.length = 0; auditLogs.push(...loadedLogs); }

      const loadedEmails = await postgresStore.listUserEmails();
      if (loadedEmails.length > 0) { userEmails.length = 0; userEmails.push(...loadedEmails); }

      const loadedUploads = await postgresStore.listUploadRecords();
      if (loadedUploads && Object.keys(loadedUploads).length > 0) {
        Object.keys(workstreamUploadIndex).forEach(k => delete workstreamUploadIndex[k]);
        Object.assign(workstreamUploadIndex, loadedUploads);
      }

      const loadedSettings = await postgresStore.loadSiteSettings();
      if (loadedSettings) {
        Object.assign(siteFeeSettings, loadedSettings);
        siteSettings.loadFromState(loadedSettings);
      }

      const loadedWorkspaces = await postgresStore.listWorkspaces();
      if (loadedWorkspaces && loadedWorkspaces.length > 0) {
        workspaceService.loadFromList(loadedWorkspaces);
      }

      const loadedOffers = await postgresStore.listOffers();
      if (loadedOffers && loadedOffers.length > 0) {
        workstreamOffers.length = 0;
        workstreamOffers.push(...loadedOffers);
      }

      const loadedInvoices = await postgresStore.listCustomInvoices();
      if (loadedInvoices && loadedInvoices.length > 0) {
        customInvoices.length = 0;
        customInvoices.push(...loadedInvoices);
      }

      const loadedGateways = await postgresStore.loadPaymentGateways();
      if (loadedGateways) paymentGatewayManager.loadFromState(loadedGateways);

      const loadedLedger = await postgresStore.loadLedgerState();
      if (loadedLedger) {
        financeLedger.loadFromState(loadedLedger);
      }

      const loadedNotifs = await postgresStore.listAllNotifications();
      if (loadedNotifs && loadedNotifs.length > 0) { notifications.length = 0; notifications.push(...loadedNotifs); }

      postgresStore.isHydrated = true;
      console.log('[PostgresStore] Successfully loaded all entities into memory.');
    } catch (loadErr) {
      console.error('CRITICAL: Failed to load entities from database:', loadErr);
      throw loadErr;
    }

  for (const u of users) {
    ensureWallet(u.id);
  }
  syncUserBalances();
}

export async function cleanAllStoreData() {
  users.length = 0;
  gigs.length = 0;
  orders.length = 0;
  projects.length = 0;
  proposals.length = 0;
  reviews.length = 0;
  messages.length = 0;
  disputes.length = 0;
  refunds.length = 0;
  payouts.length = 0;
  customInvoices.length = 0;
  workstreamOffers.length = 0;
  notifications.length = 0;
  supportTickets.length = 0;
  auditLogs.length = 0;
  userEmails.length = 0;
  for (const k of Object.keys(workstreamUploadIndex)) {
    delete workstreamUploadIndex[k];
  }
  requestKeyCache.clear();
  releaseCompletedOrders.clear();
  financeLedger.resetToCleanState();

  await postgresStore.cleanAllData();
  console.log('[Store] Cleaned all demo/runtime data from memory and PostgreSQL.');
}

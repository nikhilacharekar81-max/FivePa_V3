import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { financeLedger } from '../src/server/financeLedger.js';
import { siteSettings, DEFAULT_SITE_SETTINGS } from '../src/server/siteSettings.js';
import { OrderFeeBreakdown } from '../src/shared/fees.js';
import {
  SEED_USERS,
  SEED_GIGS,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  SEED_ORDERS,
  SEED_REVIEWS,
  SEED_MESSAGES
} from '../src/data/completeSeedDataset.js';

export { financeLedger, siteSettings, DEFAULT_SITE_SETTINGS };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const MESSAGES_FILE = path.join(DATA_DIR, 'workstream_messages.json');
export const ORDERS_FILE = path.join(DATA_DIR, 'workstream_orders.json');
export const REVIEWS_FILE = path.join(DATA_DIR, 'workstream_reviews.json');
export const UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_uploads.json');
export const WORKSTREAM_UPLOADS_DIR = path.join(DATA_DIR, 'workstream_uploads');
export const WORKSTREAM_UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_upload_index.json');

// Interfaces
export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  mobile?: string;
  role: 'user' | 'admin' | 'super_admin' | 'moderator' | 'support' | string;
  avatar: string;
  title: string;
  rating: number;
  reviewsCount: number;
  hourlyRate: number;
  earned: number;
  completedJobs: number;
  bio: string;
  skills: string[];
  status: 'active' | 'suspended' | 'restricted' | 'deactivated';
  verified: boolean;
  emailVerified?: boolean;
  mobileVerified?: boolean;
  walletBalance: number;
  createdAt: string;
  isFlagged?: boolean;
  flagReason?: string;
  password?: string;
  sessionVersion?: number;
  knownDevices?: string[];
  isAvailableNow?: boolean;
}

export interface GigExtra {
  id: string;
  title: string;
  price: number;
}

export interface Gig {
  id: string;
  freelancerId: string;
  freelancerName: string;
  freelancerUsername?: string;
  freelancerAvatar: string;
  freelancerLevel?: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  price: number;
  deliveryDays: number;
  rating: number;
  reviewsCount: number;
  image: string;
  status: 'published' | 'draft' | 'suspended' | 'paused' | 'pending' | 'declined';
  featured: boolean;
  extras?: GigExtra[];
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
}

export interface Project {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerAvatar: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  budgetMin: number;
  budgetMax: number;
  deadlineDays: number;
  proposalsCount: number;
  createdAt: string;
  status: 'open' | 'published' | 'unpublished' | 'suspended' | 'in_progress' | 'completed';
  featured: boolean;
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
}

export interface Proposal {
  id: string;
  projectId: string;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatar: string;
  freelancerTitle: string;
  coverLetter: string;
  bidAmount: number;
  deliveryDays: number;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface Order {
  id: string;
  workspaceId?: string;
  orderType?: 'gig' | 'project';
  gigOrderId?: string;
  projectOrderId?: string;
  title: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: 'payment_pending' | 'funded_in_escrow' | 'in_progress' | 'delivered' | 'completed' | 'disputed' | 'revision' | 'cancelled' | 'draft_review' | 'work_in_progress';
  previousStatus?: string;
  createdAt: string;
  dueDate: string;
  completedAt?: string;
  requirements?: string;
  deliverables?: string;
  deliverableFiles?: Array<{ id?: string; name: string; url: string; size: string; uploadedAt?: string }>;
  revisions?: Array<{ id?: string; version?: number; requestedAt: string; reason: string; status: string; deliveryVersion?: number }>;
  adminNotes?: string;
  isMuted?: boolean;
  escrowProtectionStartDate?: string;
  escrowProtectionEndDate?: string;
  gigId?: string;
  projectId?: string;
  serviceUrl?: string;
  gigSlug?: string;
  sellerUsername?: string;
  buyerUsername?: string;
  serviceTitle?: string;
  serviceThumbnail?: string;
  isTimerPaused?: boolean;
  feeBreakdown?: OrderFeeBreakdown;
  deliveryHistory?: Array<{
    version: number;
    notes?: string;
    message?: string;
    reference?: string;
    files: Array<{ id?: string; name: string; size: string; url: string; uploadedAt?: string }>;
    deliveredAt: string;
  }>;
  deliveryNotes?: string;
  deliveryReference?: string;
  acceptedVersion?: number;
  reviewWindowDays?: number;
  reviewWindowExpiresAt?: string;
  review?: Review;
}

export interface Dispute {
  id: string;
  orderId: string;
  buyerId?: string;
  sellerId?: string;
  raisedBy: string;
  reason: string;
  evidence?: string;
  status: 'open' | 'under_investigation' | 'resolved_refund' | 'resolved_release' | 'resolved_partial';
  createdAt: string;
  resolutionNotes?: string;
  resolutionType?: string;
  notes?: string;
  assignedTo?: string;
}

export type WorkstreamOfferKind = 'proposal' | 'invoice' | 'deposit';
export type WorkstreamOfferStatus = 'pending' | 'accepted' | 'paid' | 'declined' | 'cancelled';

export interface WorkstreamOffer {
  id: string;
  number?: string;
  orderId: string;
  workspaceId?: string;
  proposalId?: string;
  kind: WorkstreamOfferKind;
  title: string;
  amount: number;
  deliveryDays?: number;
  note?: string;
  files?: Array<{ id?: string; name: string; size: string; url: string; uploadedAt?: string }>;
  reference?: string;
  status: WorkstreamOfferStatus;
  createdBy: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata?: any;
}

export interface CustomInvoice {
  id: string;
  invoiceNumber: string;
  invoice_number?: string;
  userId?: string;
  buyerId?: string;
  sellerId?: string;
  recipientName?: string;
  recipientEmail?: string;
  title?: string;
  issueDate?: string;
  dueDate?: string;
  status: 'paid' | 'in_escrow' | 'unpaid' | 'refunded';
  items?: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal?: number;
  platformFee?: number;
  tax?: number;
  total?: number;
  amount?: number;
  description?: string;
  notes?: string;
  relatedOrderId?: string;
  createdAt?: string;
  paidAt?: string;
}

export interface Refund {
  id: string;
  orderId: string;
  buyerId: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Payout {
  id: string;
  freelancerId: string;
  amount: number;
  method: 'UPI' | 'Bank Transfer' | 'Stripe' | 'Razorpay' | 'PayPal';
  status: 'pending' | 'approved' | 'processed' | 'failed' | 'cancelled' | 'reversed';
  createdAt: string;
  accountDetails: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  order: number;
  subcategories: { id: string; name: string; slug: string; enabled: boolean }[];
}

export interface Review {
  id: string;
  orderId?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewerAvatar?: string;
  targetUserId?: string;
  rating: number;
  comment?: string;
  orderTitle?: string;
  gigId?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
  isCancelledOrder?: boolean;
  reply?: {
    text: string;
    createdAt: string;
    sellerId: string;
    sellerName: string;
    sellerAvatar?: string;
  };
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
  messages: { sender: string; text: string; timestamp: string }[];
}

export interface AuditLog {
  id: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

export interface Message {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  type?: 'message' | 'system' | 'file' | 'deliverable';
  fileInfo?: { name: string; size: string; url: string; type?: string; category?: string };
  metadata?: {
    amount?: number;
    action?: string;
    milestoneTitle?: string;
    version?: number;
    notes?: string;
    reference?: string;
    reason?: string;
    rating?: number;
    comment?: string;
    revisionId?: string;
    deliveryVersion?: number;
    requirementText?: string;
    clientMessageId?: string;
    acceptedVersion?: number;
    reviewWindowDays?: number;
  };
}

export interface UserEmail {
  id: string;
  userId: string;
  userEmail: string;
  subject: string;
  snippet?: string;
  body: string;
  type?: 'SUSPEND' | 'RESTRICT' | 'DEACTIVATE' | 'IMPERSONATE' | 'GENERAL';
  sentAt?: string;
  date?: string;
  read: boolean;
}

export interface SiteFeeSettings {
  platformName: string;
  supportEmail: string;
  currency: string;
  currencySymbol: string;
  freelancerCommissionRate: number;
  buyerProcessingFeeRate: number;
  smallOrderFee: number;
  smallOrderFeeThreshold: number;
  minOrderAmount: number;
  featuredGigFee: number;
  urgentProjectFee: number;
  escrowHoldDays: number;
  autoCompleteDeliveredDays: number;
  autoCompleteDeliveredEnabled?: boolean;
  disputeWindowDays: number;
  minPayoutThreshold: number;
  instantPayoutFeeRate: number;
  freelancerOnboardingMode: 'open' | 'moderated';
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface WorkstreamUploadRecord {
  ownerId: string;
  originalName?: string;
  mime?: string;
  size?: number;
  createdAt: string;
  sha256?: string;
}

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
  return randomPasswordHash();
}

// In-Memory Data Collections
export let users: User[] = SEED_USERS.map(u => ({
  ...u,
  password: seedPasswordHashFor(u.role),
  sessionVersion: u.sessionVersion || 1,
  knownDevices: u.knownDevices || ['dev_default_session']
}));

export let gigs: Gig[] = [...SEED_GIGS];
export let orders: Order[] = [...SEED_ORDERS];
export let projects: Project[] = [...SEED_PROJECTS];
export let proposals: Proposal[] = [...SEED_PROPOSALS];
export let reviews: Review[] = [...SEED_REVIEWS];
export let messages: Message[] = [...SEED_MESSAGES];

export let disputes: Dispute[] = [];
export let refunds: Refund[] = [];
export let payouts: Payout[] = [];

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

export function getReviewWindowDays(): number {
  if (process.env.REVIEW_WINDOW_DAYS !== undefined) {
    const parsed = Number(process.env.REVIEW_WINDOW_DAYS);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  const settings = siteSettings.getSettings();
  if (typeof settings.marketplace?.autoCompleteDeliveredDays === 'number') {
    return settings.marketplace.autoCompleteDeliveredDays;
  }
  if (typeof siteFeeSettings.autoCompleteDeliveredDays === 'number') {
    return siteFeeSettings.autoCompleteDeliveredDays;
  }
  return 3;
}

export function isAutoAcceptEnabled(): boolean {
  if (process.env.AUTO_ACCEPT_ENABLED !== undefined) {
    const v = process.env.AUTO_ACCEPT_ENABLED.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  }
  const settings = siteSettings.getSettings();
  if (settings.marketplace?.autoCompleteDeliveredEnabled === false) return false;
  if (siteFeeSettings.autoCompleteDeliveredEnabled === false) return false;
  return getReviewWindowDays() > 0;
}

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
  const serialized = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp.${Math.random().toString(36).substring(7)}`;
  const existingTask = writeQueue.get(filePath) || Promise.resolve();
  
  const task = existingTask.then(async () => {
    ensureDataDirectory();
    fs.writeFileSync(tempPath, serialized, 'utf-8');
    fs.renameSync(tempPath, filePath);
  }).catch(err => {
    console.error(`Failed to atomic write ${filePath}:`, err);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });
  
  writeQueue.set(filePath, task);
  return task;
}

export function saveMessagesToDisk() { 
  postgresStore.saveMessages(messages).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save messages to database:', err);
    throw err;
  });
}
export function saveOrdersToDisk() { 
  postgresStore.saveOrders(orders).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save orders to database:', err);
    throw err;
  });
}
export function saveReviewsToDisk() { 
  postgresStore.saveReviews(reviews).catch(err => {
    console.error('[PostgresStore ERROR] CRITICAL: Failed to save reviews to database:', err);
    throw err;
  });
}
export function saveWorkstreamUploadIndex() {
  for (const [fn, rec] of Object.entries(workstreamUploadIndex)) {
    postgresStore.saveUploadRecord(fn, rec).catch(err => {
      console.error('[PostgresStore ERROR] CRITICAL: Failed to save upload record to database:', err);
      throw err;
    });
  }
}

export function handleCorruption(filePath: string, error: any) {
  console.error(`DATA WARNING: Corruption or read error in ${filePath}:`, error);
  console.log('Falling back to seed / default data.');
}

export function loadInitialOrdersAndMessages() {
  ensureDataDirectory();

  if (fs.existsSync(ORDERS_FILE)) {
    try {
      const data = fs.readFileSync(ORDERS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        orders.length = 0;
        orders.push(...parsed);
      }
    } catch (e) {
      handleCorruption(ORDERS_FILE, e);
    }
  }

  if (fs.existsSync(MESSAGES_FILE)) {
    try {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        messages.length = 0;
        messages.push(...parsed);
      }
    } catch (e) {
      handleCorruption(MESSAGES_FILE, e);
    }
  }

  if (fs.existsSync(REVIEWS_FILE)) {
    try {
      const data = fs.readFileSync(REVIEWS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        reviews.length = 0;
        reviews.push(...parsed);
      }
    } catch (e) {
      handleCorruption(REVIEWS_FILE, e);
    }
  }

  if (fs.existsSync(WORKSTREAM_UPLOAD_INDEX_FILE)) {
    try {
      const data = fs.readFileSync(WORKSTREAM_UPLOAD_INDEX_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        Object.assign(workstreamUploadIndex, parsed);
      }
    } catch (e) {
      handleCorruption(WORKSTREAM_UPLOAD_INDEX_FILE, e);
    }
  }

  let messagesMigrated = false;
  for (const msg of messages) {
    if (!msg.timestamp || !/\d{4}-\d{2}-\d{2}/.test(msg.timestamp)) {
      const order = orders.find(o => o.id === msg.orderId);
      let baseDate = order?.createdAt;
      if (!baseDate || !/\d{4}-\d{2}-\d{2}/.test(baseDate)) {
        baseDate = new Date().toISOString();
      }
      const datePart = baseDate.split('T')[0];

      const timeMatch = msg.timestamp ? msg.timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i) : null;
      let hours = 0;
      let minutes = 0;
      let seconds = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4] ? timeMatch[4].toUpperCase() : '';
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
      }

      const d = new Date(`${datePart}T00:00:00.000Z`);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(hours, minutes, seconds, 0);
        msg.timestamp = d.toISOString();
        messagesMigrated = true;
      } else {
        msg.timestamp = new Date().toISOString();
        messagesMigrated = true;
      }
    }
  }
  if (messagesMigrated) {
    saveMessagesToDisk();
    console.log('Migrated legacy non-ISO message timestamps to ISO strings.');
  }

  for (const u of users) {
    const userReviews = reviews.filter(r => r.targetUserId === u.id);
    if (userReviews.length > 0) {
      u.reviewsCount = userReviews.length;
      u.rating = Number((userReviews.reduce((sum, r) => sum + r.rating, 0) / userReviews.length).toFixed(1));
    }
  }

  saveOrdersToDisk();
  saveMessagesToDisk();
  saveReviewsToDisk();
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
  const isFreelancer = gigs.some(g => g.freelancerId === u.id) || orders.some(o => o.sellerId === u.id) || u.role === 'freelancer';
  financeLedger.ensureWallet({ userId: u.id, name: u.name, email: u.email, role: isFreelancer ? 'freelancer' : 'buyer' });
}

export function pushSystemMessage(orderId: string, text: string) {
  const msg: Message = {
    id: `msg_sys_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    orderId,
    senderId: 'system',
    senderName: 'WorkSphere System',
    text,
    timestamp: new Date().toISOString(),
    type: 'system'
  };
  store.addMessage(msg);
  return msg;
}

export async function hydrateStoreFromPostgres() {
  if (!isPostgresEnabled()) {
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
      process.exit(1);
    }
  }

  let initialized = false;
  try {
    initialized = await postgresStore.isInitialized();
  } catch (err) {
    if (isPostgresEnabled()) {
      console.error('CRITICAL: Database is unreachable when checking initialization status:', err);
      process.exit(1);
    }
  }

  if (!initialized) {
    console.log('[PostgresStore] Database is empty. Seeding initial dataset...');
    try {
      postgresStore.isHydrated = true;
      await postgresStore.saveUsers(users);
      await postgresStore.saveGigs(gigs);
      await postgresStore.saveProjects(projects);
      await postgresStore.saveProposals(proposals);
      await postgresStore.saveOrders(orders);
      await postgresStore.saveMessages(messages);
      await postgresStore.saveReviews(reviews);
      await postgresStore.saveWorkspaces([]);
      await postgresStore.saveOffers([]);
      await postgresStore.saveCustomInvoices([]);
      await postgresStore.saveDisputes([]);
      await postgresStore.saveRefunds([]);
      await postgresStore.savePayouts([]);
      await postgresStore.saveSupportTickets([]);
      await postgresStore.saveAuditLogs([]);
      await postgresStore.saveUserEmails([]);
      await postgresStore.saveSiteSettings(siteFeeSettings);
      await postgresStore.savePaymentGateways({});
      await postgresStore.saveLedgerState(financeLedger.getSerializableState());
      await postgresStore.markInitialized();
      console.log('[PostgresStore] Seeding completed successfully.');
    } catch (seedErr) {
      postgresStore.isHydrated = false;
      console.error('CRITICAL: Failed to seed database:', seedErr);
      process.exit(1);
    }
  } else {
    console.log('[PostgresStore] Loading all entities from Postgres into memory...');
    try {
      const loadedUsers = await postgresStore.listUsers();
      if (loadedUsers.length > 0) { users.length = 0; users.push(...loadedUsers); }

      const loadedGigs = await postgresStore.listGigs();
      if (loadedGigs.length > 0) { gigs.length = 0; gigs.push(...loadedGigs); }

      const loadedProjects = await postgresStore.listProjects();
      if (loadedProjects.length > 0) { projects.length = 0; projects.push(...loadedProjects); }

      const loadedProposals = await postgresStore.listProposals();
      if (loadedProposals.length > 0) { proposals.length = 0; proposals.push(...loadedProposals); }

      const loadedOrders = await postgresStore.listOrders();
      if (loadedOrders.length > 0) { orders.length = 0; orders.push(...loadedOrders); }

      const loadedMessages = await postgresStore.listMessages();
      if (loadedMessages.length > 0) { messages.length = 0; messages.push(...loadedMessages); }

      const loadedReviews = await postgresStore.listReviews();
      if (loadedReviews.length > 0) { reviews.length = 0; reviews.push(...loadedReviews); }

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
      }

      const loadedLedger = await postgresStore.loadLedgerState();
      if (loadedLedger) {
        financeLedger.loadFromState(loadedLedger);
      }

      console.log('[PostgresStore] Successfully loaded all entities into memory.');
    } catch (loadErr) {
      console.error('CRITICAL: Failed to load entities from database:', loadErr);
      process.exit(1);
    }
  }

  for (const u of users) {
    ensureWallet(u.id);
  }
  syncUserBalances();
}

import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import type { 
  Order, 
  Message, 
  Review, 
  WorkstreamUploadRecord, 
  User, 
  Gig, 
  Project, 
  Proposal, 
  Dispute, 
  Refund, 
  Payout, 
  SupportTicket, 
  AuditLog, 
  UserEmail,
  WorkstreamOffer,
  CustomInvoice,
  Notification
} from '../../src/types.js';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function isPostgresEnabled(): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return true;
  return !!process.env.SQL_HOST;
}

export function getDatabaseName(): string {
  if (process.env.NODE_ENV === 'test') {
    return 'cloud_sql_test_database';
  }
  return process.env.SQL_DB_NAME || 'cloud_sql_development_database';
}

export function createPgPool(databaseName?: string): pkg.Pool {
  const db = databaseName || getDatabaseName();
  return new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER || 'ai_studio_app_user',
    password: process.env.SQL_PASSWORD,
    database: db,
    ssl: false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export function createAdminPgPool(databaseName?: string): pkg.Pool {
  const db = databaseName || getDatabaseName();
  return new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_ADMIN_USER || 'ai_studio_admin',
    password: process.env.SQL_ADMIN_PASSWORD,
    database: db,
    ssl: false,
    max: 5,
    idleTimeoutMillis: 10000,
  });
}

// Global cached pool
declare global {
  var _appPostgresPool: pkg.Pool | undefined;
}

export function getPool(): pkg.Pool {
  if (!isPostgresEnabled()) {
    throw new Error('Postgres pool requested when Postgres is not enabled.');
  }
  if (!global._appPostgresPool) {
    global._appPostgresPool = createPgPool();
  }
  return global._appPostgresPool;
}

export class PostgresStore {
  public isHydrated: boolean = process.env.NODE_ENV === 'test';
  private locks = new Map<string, Promise<void>>();

  constructor(pool?: pkg.Pool) {
    if (pool) {
      (this as any)._customPool = pool;
    }
  }

  getPool(): pkg.Pool {
    if ((this as any)._customPool) return (this as any)._customPool;
    return getPool();
  }

  private withLock(key: string, fn: () => Promise<void>): Promise<void> {
    if (!isPostgresEnabled()) {
      return Promise.resolve();
    }
    if (!this.isHydrated && key !== 'initialization') {
      // Allow saving during hydration
    }
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(key, next);
    return next;
  }

  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.locks.values()).map(p => p.catch(() => {})));
  }

  async runMigrations(): Promise<void> {
    if (!isPostgresEnabled()) return;
    const adminPool = createAdminPgPool(getDatabaseName());
    try {
      const migrationPath = path.join(__dirname, 'migration.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf-8');
        await adminPool.query(sql);
        const appUser = process.env.SQL_USER || 'ai_studio_app_user';
        await adminPool.query(`
          GRANT ALL ON SCHEMA public TO ${appUser};
          GRANT ALL ON ALL TABLES IN SCHEMA public TO ${appUser};
          GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${appUser};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${appUser};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${appUser};
        `);
        console.log(`[PostgresStore] Migrations executed successfully on ${getDatabaseName()}.`);
      }
    } finally {
      await adminPool.end();
    }
  }

  async isInitialized(): Promise<boolean> {
    if (!isPostgresEnabled()) return false;
    try {
      const res = await this.getPool().query("SELECT value FROM app_metadata WHERE key = 'seed_initialized'");
      return res.rows.length > 0 && !!res.rows[0].value;
    } catch {
      return false;
    }
  }

  async markInitialized(): Promise<void> {
    if (!isPostgresEnabled()) return;
    await this.getPool().query(
      `INSERT INTO app_metadata (key, value, updated_at) 
       VALUES ('seed_initialized', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ initializedAt: new Date().toISOString(), version: 1 })]
    );
  }

  async saveAppMetadata(key: string, value: any): Promise<void> {
    return this.withLock(`meta_${key}`, async () => {
      await this.getPool().query(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    });
  }

  async loadAppMetadata<T = any>(key: string): Promise<T | null> {
    if (!isPostgresEnabled()) return null;
    const res = await this.getPool().query('SELECT value FROM app_metadata WHERE key = $1', [key]);
    return res.rows.length > 0 ? (res.rows[0].value as T) : null;
  }

  // --- ORDERS ---
  async saveOrders(orders: Order[]): Promise<void> {
    return this.withLock('orders', async () => {
      if (!orders) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const order of orders) {
          if (!order?.id || seen.has(order.id)) continue;
          seen.add(order.id);
          await client.query(
            `INSERT INTO orders (
              id, title, buyer_id, seller_id, amount, status, created_at, due_date, completed_at, 
              requirements, deliverables, deliverable_files, revisions, admin_notes, is_muted, 
              escrow_protection_start_date, escrow_protection_end_date, gig_id, project_id, 
              service_url, gig_slug, seller_username, buyer_username, service_title, service_thumbnail, 
              is_timer_paused, fee_breakdown, delivery_history, delivery_notes, delivery_reference, 
              accepted_version, review_window_days, review_window_expires_at, review,
              workspace_id, seller_review, previous_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              buyer_id = EXCLUDED.buyer_id,
              seller_id = EXCLUDED.seller_id,
              amount = EXCLUDED.amount,
              status = EXCLUDED.status,
              created_at = EXCLUDED.created_at,
              due_date = EXCLUDED.due_date,
              completed_at = EXCLUDED.completed_at,
              requirements = EXCLUDED.requirements,
              deliverables = EXCLUDED.deliverables,
              deliverable_files = EXCLUDED.deliverable_files,
              revisions = EXCLUDED.revisions,
              admin_notes = EXCLUDED.admin_notes,
              is_muted = EXCLUDED.is_muted,
              escrow_protection_start_date = EXCLUDED.escrow_protection_start_date,
              escrow_protection_end_date = EXCLUDED.escrow_protection_end_date,
              gig_id = EXCLUDED.gig_id,
              project_id = EXCLUDED.project_id,
              service_url = EXCLUDED.service_url,
              gig_slug = EXCLUDED.gig_slug,
              seller_username = EXCLUDED.seller_username,
              buyer_username = EXCLUDED.buyer_username,
              service_title = EXCLUDED.service_title,
              service_thumbnail = EXCLUDED.service_thumbnail,
              is_timer_paused = EXCLUDED.is_timer_paused,
              fee_breakdown = EXCLUDED.fee_breakdown,
              delivery_history = EXCLUDED.delivery_history,
              delivery_notes = EXCLUDED.delivery_notes,
              delivery_reference = EXCLUDED.delivery_reference,
              accepted_version = EXCLUDED.accepted_version,
              review_window_days = EXCLUDED.review_window_days,
              review_window_expires_at = EXCLUDED.review_window_expires_at,
              review = EXCLUDED.review,
              workspace_id = EXCLUDED.workspace_id,
              seller_review = EXCLUDED.seller_review,
              previous_status = EXCLUDED.previous_status`,
            [
              order.id, order.title, order.buyerId, order.sellerId, order.amount, order.status,
              order.createdAt, order.dueDate, order.completedAt || null, order.requirements || null,
              order.deliverables || null, JSON.stringify(order.deliverableFiles || []),
              JSON.stringify(order.revisions || []), order.adminNotes || null, order.isMuted || false,
              order.escrowProtectionStartDate || null, order.escrowProtectionEndDate || null,
              order.gigId || null, order.projectId || null, order.serviceUrl || null,
              order.gigSlug || null, order.sellerUsername || null, order.buyerUsername || null,
              order.serviceTitle || null, order.serviceThumbnail || null, order.isTimerPaused || false,
              JSON.stringify(order.feeBreakdown || null), JSON.stringify(order.deliveryHistory || []),
              order.deliveryNotes || null, order.deliveryReference || null, order.acceptedVersion ?? null,
              order.reviewWindowDays ?? null, order.reviewWindowExpiresAt || null, JSON.stringify(order.review || null),
              (order as any).workspaceId || null, JSON.stringify((order as any).sellerReview || null), (order as any).previousStatus || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM orders WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM orders');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listOrders(): Promise<Order[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM orders ORDER BY created_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      title: r.title,
      buyerId: r.buyer_id,
      sellerId: r.seller_id,
      amount: Number(r.amount),
      status: r.status,
      createdAt: r.created_at,
      dueDate: r.due_date,
      completedAt: r.completed_at || undefined,
      requirements: r.requirements || undefined,
      deliverables: r.deliverables || undefined,
      deliverableFiles: r.deliverable_files || [],
      revisions: r.revisions || [],
      adminNotes: r.admin_notes || undefined,
      isMuted: r.is_muted,
      escrowProtectionStartDate: r.escrow_protection_start_date || undefined,
      escrowProtectionEndDate: r.escrow_protection_end_date || undefined,
      gigId: r.gig_id || undefined,
      projectId: r.project_id || undefined,
      serviceUrl: r.service_url || undefined,
      gigSlug: r.gig_slug || undefined,
      sellerUsername: r.seller_username || undefined,
      buyerUsername: r.buyer_username || undefined,
      serviceTitle: r.service_title || undefined,
      serviceThumbnail: r.service_thumbnail || undefined,
      isTimerPaused: r.is_timer_paused,
      feeBreakdown: r.fee_breakdown || undefined,
      deliveryHistory: r.delivery_history || [],
      deliveryNotes: r.delivery_notes || undefined,
      deliveryReference: r.delivery_reference || undefined,
      acceptedVersion: r.accepted_version ?? undefined,
      reviewWindowDays: r.review_window_days ?? undefined,
      reviewWindowExpiresAt: r.review_window_expires_at || undefined,
      review: r.review || undefined,
      ...(r.workspace_id ? { workspaceId: r.workspace_id } : {}),
      ...(r.seller_review ? { sellerReview: r.seller_review } : {}),
      ...(r.previous_status ? { previousStatus: r.previous_status } : {})
    }));
  }

  // --- MESSAGES ---
  async saveMessages(messages: Message[]): Promise<void> {
    return this.withLock('messages', async () => {
      if (!messages) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const m of messages) {
          if (!m?.id || seen.has(m.id)) continue;
          seen.add(m.id);
          await client.query(
            `INSERT INTO messages (id, order_id, sender_id, sender_name, text, timestamp, type, file_info, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
               order_id = EXCLUDED.order_id,
               sender_id = EXCLUDED.sender_id,
               sender_name = EXCLUDED.sender_name,
               text = EXCLUDED.text,
               timestamp = EXCLUDED.timestamp,
               type = EXCLUDED.type,
               file_info = EXCLUDED.file_info,
               metadata = EXCLUDED.metadata`,
            [
              m.id, m.orderId, m.senderId, m.senderName, m.text, m.timestamp,
              m.type || 'message', JSON.stringify(m.fileInfo || null), JSON.stringify(m.metadata || null)
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM messages WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM messages');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listMessages(): Promise<Message[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM messages ORDER BY timestamp ASC');
    return res.rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      senderId: r.sender_id,
      senderName: r.sender_name,
      text: r.text,
      timestamp: r.timestamp,
      type: r.type || undefined,
      fileInfo: r.file_info || undefined,
      metadata: r.metadata || undefined
    }));
  }

  // --- REVIEWS ---
  async saveReviews(reviews: Review[]): Promise<void> {
    return this.withLock('reviews', async () => {
      if (!reviews) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const r of reviews) {
          if (!r?.id || seen.has(r.id)) continue;
          seen.add(r.id);
          await client.query(
            `INSERT INTO reviews (
              id, order_id, reviewer_id, reviewer_name, reviewer_avatar, target_user_id, 
              rating, comment, order_title, gig_id, project_id, created_at, updated_at, is_cancelled_order, reply, moderation_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (id) DO UPDATE SET
              order_id = EXCLUDED.order_id,
              reviewer_id = EXCLUDED.reviewer_id,
              reviewer_name = EXCLUDED.reviewer_name,
              reviewer_avatar = EXCLUDED.reviewer_avatar,
              target_user_id = EXCLUDED.target_user_id,
              rating = EXCLUDED.rating,
              comment = EXCLUDED.comment,
              order_title = EXCLUDED.order_title,
              gig_id = EXCLUDED.gig_id,
              project_id = EXCLUDED.project_id,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              is_cancelled_order = EXCLUDED.is_cancelled_order,
              reply = EXCLUDED.reply,
              moderation_status = EXCLUDED.moderation_status`,
            [
              r.id, r.orderId || null, r.reviewerId || null, r.reviewerName || null, r.reviewerAvatar || null,
              r.targetUserId || null, r.rating, r.comment || null, r.orderTitle || null, r.gigId || null,
              r.projectId || null, r.createdAt || null, r.updatedAt || null, r.isCancelledOrder || false,
              JSON.stringify(r.reply || null), (r as any).moderationStatus || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM reviews WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM reviews');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listReviews(): Promise<Review[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM reviews ORDER BY created_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      orderId: r.order_id || undefined,
      reviewerId: r.reviewer_id || undefined,
      reviewerName: r.reviewer_name || undefined,
      reviewerAvatar: r.reviewer_avatar || undefined,
      targetUserId: r.target_user_id || undefined,
      rating: Number(r.rating),
      comment: r.comment || undefined,
      orderTitle: r.order_title || undefined,
      gigId: r.gig_id || undefined,
      projectId: r.project_id || undefined,
      createdAt: r.created_at || undefined,
      updatedAt: r.updated_at || undefined,
      isCancelledOrder: r.is_cancelled_order,
      reply: r.reply || undefined,
      ...(r.moderation_status ? { moderationStatus: r.moderation_status } : {})
    }));
  }

  // --- USERS ---
  async saveUsers(users: User[]): Promise<void> {
    return this.withLock('users', async () => {
      if (!users) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const u of users) {
          if (!u?.id || seen.has(u.id)) continue;
          seen.add(u.id);
          await client.query(
            `INSERT INTO users (
              id, name, username, email, mobile, role, avatar, title, rating, reviews_count, 
              hourly_rate, earned, completed_jobs, bio, skills, status, verified, email_verified, 
              mobile_verified, wallet_balance, created_at, is_flagged, flag_reason, password, 
              session_version, known_devices, is_available_now
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              username = EXCLUDED.username,
              email = EXCLUDED.email,
              mobile = EXCLUDED.mobile,
              role = EXCLUDED.role,
              avatar = EXCLUDED.avatar,
              title = EXCLUDED.title,
              rating = EXCLUDED.rating,
              reviews_count = EXCLUDED.reviews_count,
              hourly_rate = EXCLUDED.hourly_rate,
              earned = EXCLUDED.earned,
              completed_jobs = EXCLUDED.completed_jobs,
              bio = EXCLUDED.bio,
              skills = EXCLUDED.skills,
              status = EXCLUDED.status,
              verified = EXCLUDED.verified,
              email_verified = EXCLUDED.email_verified,
              mobile_verified = EXCLUDED.mobile_verified,
              wallet_balance = EXCLUDED.wallet_balance,
              created_at = EXCLUDED.created_at,
              is_flagged = EXCLUDED.is_flagged,
              flag_reason = EXCLUDED.flag_reason,
              password = EXCLUDED.password,
              session_version = EXCLUDED.session_version,
              known_devices = EXCLUDED.known_devices,
              is_available_now = EXCLUDED.is_available_now`,
            [
              u.id, u.name, u.username || null, u.email, u.mobile || null, u.role, u.avatar || null,
              u.title || null, u.rating ?? 5.0, u.reviewsCount ?? 0, u.hourlyRate ?? 0, u.earned ?? 0,
              u.completedJobs ?? 0, u.bio || null, u.skills || [], u.status || 'active',
              !!u.verified, !!u.emailVerified, !!u.mobileVerified, u.walletBalance ?? 0,
              u.createdAt || new Date().toISOString(), !!u.isFlagged, u.flagReason || null,
              u.password || null, u.sessionVersion ?? 1, u.knownDevices || ['dev_default_session'],
              !!u.isAvailableNow
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM users WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM users');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listUsers(): Promise<User[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM users');
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      username: r.username || undefined,
      email: r.email,
      mobile: r.mobile || undefined,
      role: r.role,
      avatar: r.avatar || '',
      title: r.title || '',
      rating: Number(r.rating),
      reviewsCount: Number(r.reviews_count),
      hourlyRate: Number(r.hourly_rate),
      earned: Number(r.earned),
      completedJobs: Number(r.completed_jobs),
      bio: r.bio || '',
      skills: r.skills || [],
      status: r.status,
      verified: r.verified,
      emailVerified: r.email_verified,
      mobileVerified: r.mobile_verified,
      walletBalance: Number(r.wallet_balance),
      createdAt: r.created_at,
      isFlagged: r.is_flagged,
      flagReason: r.flag_reason || undefined,
      password: r.password || undefined,
      sessionVersion: Number(r.session_version || 1),
      knownDevices: r.known_devices || [],
      isAvailableNow: r.is_available_now
    }));
  }

  // --- GIGS ---
  async saveGigs(gigs: Gig[]): Promise<void> {
    return this.withLock('gigs', async () => {
      if (!gigs) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const g of gigs) {
          if (!g?.id || seen.has(g.id)) continue;
          seen.add(g.id);
          await client.query(
            `INSERT INTO gigs (
              id, freelancer_id, freelancer_name, freelancer_username, freelancer_avatar, 
              freelancer_level, title, slug, category, subcategory, description, price, 
              delivery_days, rating, reviews_count, image, status, featured, extras, 
              moderation_status, moderation_notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (id) DO UPDATE SET
              freelancer_id = EXCLUDED.freelancer_id,
              freelancer_name = EXCLUDED.freelancer_name,
              freelancer_username = EXCLUDED.freelancer_username,
              freelancer_avatar = EXCLUDED.freelancer_avatar,
              freelancer_level = EXCLUDED.freelancer_level,
              title = EXCLUDED.title,
              slug = EXCLUDED.slug,
              category = EXCLUDED.category,
              subcategory = EXCLUDED.subcategory,
              description = EXCLUDED.description,
              price = EXCLUDED.price,
              delivery_days = EXCLUDED.delivery_days,
              rating = EXCLUDED.rating,
              reviews_count = EXCLUDED.reviews_count,
              image = EXCLUDED.image,
              status = EXCLUDED.status,
              featured = EXCLUDED.featured,
              extras = EXCLUDED.extras,
              moderation_status = EXCLUDED.moderation_status,
              moderation_notes = EXCLUDED.moderation_notes`,
            [
              g.id, g.freelancerId, g.freelancerName, g.freelancerUsername || null, g.freelancerAvatar || null,
              g.freelancerLevel || null, g.title, g.slug || null, g.category, g.subcategory || null,
              g.description || null, g.price, g.deliveryDays, g.rating ?? 5.0, g.reviewsCount ?? 0,
              g.image || null, g.status || 'published', !!g.featured, JSON.stringify(g.extras || []),
              g.moderationStatus || 'approved', g.moderationNotes || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM gigs WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM gigs');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listGigs(): Promise<Gig[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM gigs');
    return res.rows.map(r => ({
      id: r.id,
      freelancerId: r.freelancer_id,
      freelancerName: r.freelancer_name,
      freelancerUsername: r.freelancer_username || undefined,
      freelancerAvatar: r.freelancer_avatar || '',
      freelancerLevel: r.freelancer_level || undefined,
      title: r.title,
      slug: r.slug || undefined,
      category: r.category,
      subcategory: r.subcategory || undefined,
      description: r.description || '',
      price: Number(r.price),
      deliveryDays: Number(r.delivery_days),
      rating: Number(r.rating),
      reviewsCount: Number(r.reviews_count),
      image: r.image || '',
      status: r.status,
      featured: r.featured,
      extras: r.extras || [],
      moderationStatus: r.moderation_status || undefined,
      moderationNotes: r.moderation_notes || undefined
    }));
  }

  // --- PROJECTS ---
  async saveProjects(projects: Project[]): Promise<void> {
    return this.withLock('projects', async () => {
      if (!projects) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const p of projects) {
          if (!p?.id || seen.has(p.id)) continue;
          seen.add(p.id);
          await client.query(
            `INSERT INTO projects (
              id, buyer_id, buyer_name, buyer_avatar, title, slug, category, subcategory, 
              description, budget_min, budget_max, deadline_days, proposals_count, 
              created_at, status, featured, moderation_status, moderation_notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (id) DO UPDATE SET
              buyer_id = EXCLUDED.buyer_id,
              buyer_name = EXCLUDED.buyer_name,
              buyer_avatar = EXCLUDED.buyer_avatar,
              title = EXCLUDED.title,
              slug = EXCLUDED.slug,
              category = EXCLUDED.category,
              subcategory = EXCLUDED.subcategory,
              description = EXCLUDED.description,
              budget_min = EXCLUDED.budget_min,
              budget_max = EXCLUDED.budget_max,
              deadline_days = EXCLUDED.deadline_days,
              proposals_count = EXCLUDED.proposals_count,
              created_at = EXCLUDED.created_at,
              status = EXCLUDED.status,
              featured = EXCLUDED.featured,
              moderation_status = EXCLUDED.moderation_status,
              moderation_notes = EXCLUDED.moderation_notes`,
            [
              p.id, p.buyerId, p.buyerName, p.buyerAvatar || null, p.title, p.slug || null,
              p.category, p.subcategory || null, p.description || null, p.budgetMin,
              p.budgetMax, p.deadlineDays, p.proposalsCount ?? 0, p.createdAt,
              p.status || 'open', !!p.featured, p.moderationStatus || 'approved', p.moderationNotes || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM projects WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM projects');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listProjects(): Promise<Project[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM projects');
    return res.rows.map(r => ({
      id: r.id,
      buyerId: r.buyer_id,
      buyerName: r.buyer_name,
      buyerAvatar: r.buyer_avatar || '',
      title: r.title,
      slug: r.slug || undefined,
      category: r.category,
      subcategory: r.subcategory || undefined,
      description: r.description || '',
      budgetMin: Number(r.budget_min),
      budgetMax: Number(r.budget_max),
      deadlineDays: Number(r.deadline_days),
      proposalsCount: Number(r.proposals_count),
      createdAt: r.created_at,
      status: r.status,
      featured: r.featured,
      moderationStatus: r.moderation_status || undefined,
      moderationNotes: r.moderation_notes || undefined
    }));
  }

  // --- PROPOSALS ---
  async saveProposals(proposals: Proposal[]): Promise<void> {
    return this.withLock('proposals', async () => {
      if (!proposals) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const pr of proposals) {
          if (!pr?.id || seen.has(pr.id)) continue;
          seen.add(pr.id);
          await client.query(
            `INSERT INTO proposals (
              id, project_id, freelancer_id, freelancer_name, freelancer_avatar, 
              freelancer_title, cover_letter, bid_amount, delivery_days, created_at, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
              project_id = EXCLUDED.project_id,
              freelancer_id = EXCLUDED.freelancer_id,
              freelancer_name = EXCLUDED.freelancer_name,
              freelancer_avatar = EXCLUDED.freelancer_avatar,
              freelancer_title = EXCLUDED.freelancer_title,
              cover_letter = EXCLUDED.cover_letter,
              bid_amount = EXCLUDED.bid_amount,
              delivery_days = EXCLUDED.delivery_days,
              created_at = EXCLUDED.created_at,
              status = EXCLUDED.status`,
            [
              pr.id, pr.projectId, pr.freelancerId, pr.freelancerName, pr.freelancerAvatar || null,
              pr.freelancerTitle || null, pr.coverLetter || null, pr.bidAmount,
              pr.deliveryDays, pr.createdAt, pr.status || 'pending'
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM proposals WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM proposals');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listProposals(): Promise<Proposal[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM proposals');
    return res.rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      freelancerId: r.freelancer_id,
      freelancerName: r.freelancer_name,
      freelancerAvatar: r.freelancer_avatar || '',
      freelancerTitle: r.freelancer_title || '',
      coverLetter: r.cover_letter || '',
      bidAmount: Number(r.bid_amount),
      deliveryDays: Number(r.delivery_days),
      createdAt: r.created_at,
      status: r.status
    }));
  }

  // --- WORKSPACES ---
  async saveWorkspaces(workspaces: any[]): Promise<void> {
    return this.withLock('workspaces', async () => {
      if (!workspaces) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const w of workspaces) {
          if (!w?.workspaceId || seen.has(w.workspaceId)) continue;
          seen.add(w.workspaceId);
          const createdAt = w.createdAt || new Date().toISOString().split('T')[0];
          const updatedAt = w.updatedAt || createdAt;
          const title = w.title || w.originId || w.workspaceId;
          const orderIds = Array.isArray(w.orderIds) ? w.orderIds : (w.activeOrderId ? [w.activeOrderId] : []);
          const meta = {
            ...(w.metadata || {}),
            originType: w.originType || 'gig',
            originId: w.originId || title,
            status: w.status || 'active',
            activeOrderId: w.activeOrderId
          };
          await client.query(
            `INSERT INTO workspaces (
              workspace_id, buyer_id, seller_id, order_ids, title, created_at, updated_at, last_activity_at, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (workspace_id) DO UPDATE SET
              buyer_id = EXCLUDED.buyer_id,
              seller_id = EXCLUDED.seller_id,
              order_ids = EXCLUDED.order_ids,
              title = EXCLUDED.title,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              last_activity_at = EXCLUDED.last_activity_at,
              metadata = EXCLUDED.metadata`,
            [
              w.workspaceId, w.buyerId, w.sellerId, JSON.stringify(orderIds),
              title, createdAt, updatedAt, w.lastActivityAt || null, JSON.stringify(meta)
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM workspaces WHERE workspace_id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM workspaces');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listWorkspaces(): Promise<any[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM workspaces');
    return res.rows.map(r => {
      const meta = r.metadata || {};
      return {
        workspaceId: r.workspace_id,
        buyerId: r.buyer_id,
        sellerId: r.seller_id,
        orderIds: r.order_ids || [],
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        lastActivityAt: r.last_activity_at || undefined,
        originType: meta.originType || 'gig',
        originId: meta.originId || r.title || r.workspace_id,
        status: meta.status || 'active',
        activeOrderId: meta.activeOrderId || (Array.isArray(r.order_ids) ? r.order_ids[0] : undefined),
        metadata: meta
      };
    });
  }

  // --- OFFERS ---
  async saveOffers(offers: WorkstreamOffer[]): Promise<void> {
    return this.withLock('offers', async () => {
      if (!offers) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const o of offers) {
          if (!o?.id || seen.has(o.id)) continue;
          seen.add(o.id);
          await client.query(
            `INSERT INTO workstream_offers (
              id, number, order_id, workspace_id, kind, title, amount, delivery_days, status, 
              created_by, created_at, resolved_at, resolved_by, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO UPDATE SET
              number = EXCLUDED.number,
              order_id = EXCLUDED.order_id,
              workspace_id = EXCLUDED.workspace_id,
              kind = EXCLUDED.kind,
              title = EXCLUDED.title,
              amount = EXCLUDED.amount,
              delivery_days = EXCLUDED.delivery_days,
              status = EXCLUDED.status,
              created_by = EXCLUDED.created_by,
              created_at = EXCLUDED.created_at,
              resolved_at = EXCLUDED.resolved_at,
              resolved_by = EXCLUDED.resolved_by,
              metadata = EXCLUDED.metadata`,
            [
              o.id, o.number, o.orderId, o.workspaceId || null, o.kind, o.title, o.amount,
              o.deliveryDays ?? null, o.status, o.createdBy, o.createdAt,
              o.resolvedAt || null, o.resolvedBy || null, JSON.stringify(o.metadata || null)
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM workstream_offers WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM workstream_offers');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listOffers(): Promise<WorkstreamOffer[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM workstream_offers');
    return res.rows.map(r => ({
      id: r.id,
      number: r.number || r.id,
      orderId: r.order_id,
      workspaceId: r.workspace_id || undefined,
      kind: r.kind,
      title: r.title,
      amount: Number(r.amount),
      deliveryDays: r.delivery_days !== null ? Number(r.delivery_days) : undefined,
      status: r.status,
      createdBy: r.created_by,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at || undefined,
      resolvedBy: r.resolved_by || undefined,
      metadata: r.metadata || undefined
    }));
  }

  // --- CUSTOM INVOICES ---
  async saveCustomInvoices(invoices: CustomInvoice[]): Promise<void> {
    return this.withLock('custom_invoices', async () => {
      if (!invoices) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const inv of invoices) {
          if (!inv?.id || seen.has(inv.id)) continue;
          seen.add(inv.id);
          const buyerId = inv.buyerId || (inv as any).userId || 'unknown';
          const sellerId = inv.sellerId || (inv as any).freelancerId || 'unknown';
          const amount = Number(inv.amount || 0);
          await client.query(
            `INSERT INTO custom_invoices (
              id, invoice_number, buyer_id, seller_id, amount, status, description, created_at, paid_at, related_order_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
              invoice_number = EXCLUDED.invoice_number,
              buyer_id = EXCLUDED.buyer_id,
              seller_id = EXCLUDED.seller_id,
              amount = EXCLUDED.amount,
              status = EXCLUDED.status,
              description = EXCLUDED.description,
              created_at = EXCLUDED.created_at,
              paid_at = EXCLUDED.paid_at,
              related_order_id = EXCLUDED.related_order_id`,
            [
              inv.id, inv.invoiceNumber || inv.id, buyerId, sellerId, amount, inv.status || 'unpaid',
              inv.description || null, inv.createdAt || new Date().toISOString(), inv.paidAt || null, inv.relatedOrderId || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM custom_invoices WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM custom_invoices');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listCustomInvoices(): Promise<CustomInvoice[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM custom_invoices');
    return res.rows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      buyerId: r.buyer_id,
      sellerId: r.seller_id,
      amount: Number(r.amount),
      status: r.status,
      description: r.description || undefined,
      createdAt: r.created_at,
      paidAt: r.paid_at || undefined,
      relatedOrderId: r.related_order_id || undefined
    }));
  }

  // --- DISPUTES ---
  async saveDisputes(disputes: Dispute[]): Promise<void> {
    return this.withLock('disputes', async () => {
      if (!disputes) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const d of disputes) {
          if (!d?.id || seen.has(d.id)) continue;
          seen.add(d.id);
          await client.query(
            `INSERT INTO disputes (
              id, order_id, buyer_id, seller_id, raised_by, reason, evidence, status, 
              created_at, resolution_notes, resolution_type, notes, assigned_to
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              order_id = EXCLUDED.order_id,
              buyer_id = EXCLUDED.buyer_id,
              seller_id = EXCLUDED.seller_id,
              raised_by = EXCLUDED.raised_by,
              reason = EXCLUDED.reason,
              evidence = EXCLUDED.evidence,
              status = EXCLUDED.status,
              created_at = EXCLUDED.created_at,
              resolution_notes = EXCLUDED.resolution_notes,
              resolution_type = EXCLUDED.resolution_type,
              notes = EXCLUDED.notes,
              assigned_to = EXCLUDED.assigned_to`,
            [
              d.id, d.orderId, d.buyerId || null, d.sellerId || null, d.raisedBy, d.reason,
              d.evidence || null, d.status, d.createdAt, d.resolutionNotes || null,
              d.resolutionType || null, d.notes || null, d.assignedTo || null
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM disputes WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM disputes');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listDisputes(): Promise<Dispute[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM disputes');
    return res.rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      buyerId: r.buyer_id || undefined,
      sellerId: r.seller_id || undefined,
      raisedBy: r.raised_by,
      reason: r.reason,
      evidence: r.evidence || '',
      status: r.status,
      createdAt: r.created_at,
      resolutionNotes: r.resolution_notes || undefined,
      resolutionType: r.resolution_type || undefined,
      notes: r.notes || undefined,
      assignedTo: r.assigned_to || undefined
    }));
  }

  // --- REFUNDS ---
  async saveRefunds(refunds: Refund[]): Promise<void> {
    return this.withLock('refunds', async () => {
      if (!refunds) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const ref of refunds) {
          if (!ref?.id || seen.has(ref.id)) continue;
          seen.add(ref.id);
          await client.query(
            `INSERT INTO refunds (id, order_id, buyer_id, amount, reason, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               order_id = EXCLUDED.order_id,
               buyer_id = EXCLUDED.buyer_id,
               amount = EXCLUDED.amount,
               reason = EXCLUDED.reason,
               status = EXCLUDED.status,
               created_at = EXCLUDED.created_at`,
            [ref.id, ref.orderId, ref.buyerId, ref.amount, ref.reason || null, ref.status, ref.createdAt]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM refunds WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM refunds');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listRefunds(): Promise<Refund[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM refunds');
    return res.rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      buyerId: r.buyer_id,
      amount: Number(r.amount),
      reason: r.reason || '',
      status: r.status,
      createdAt: r.created_at
    }));
  }

  // --- PAYOUTS ---
  async savePayouts(payouts: Payout[]): Promise<void> {
    return this.withLock('payouts', async () => {
      if (!payouts) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const p of payouts) {
          if (!p?.id || seen.has(p.id)) continue;
          seen.add(p.id);
          await client.query(
            `INSERT INTO payouts (id, freelancer_id, amount, method, status, created_at, account_details)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               freelancer_id = EXCLUDED.freelancer_id,
               amount = EXCLUDED.amount,
               method = EXCLUDED.method,
               status = EXCLUDED.status,
               created_at = EXCLUDED.created_at,
               account_details = EXCLUDED.account_details`,
            [p.id, p.freelancerId, p.amount, p.method, p.status, p.createdAt, p.accountDetails || null]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM payouts WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM payouts');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listPayouts(): Promise<Payout[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM payouts');
    return res.rows.map(r => ({
      id: r.id,
      freelancerId: r.freelancer_id,
      amount: Number(r.amount),
      method: r.method,
      status: r.status,
      createdAt: r.created_at,
      accountDetails: r.account_details || ''
    }));
  }

  // --- SUPPORT TICKETS ---
  async saveSupportTickets(tickets: SupportTicket[]): Promise<void> {
    return this.withLock('support_tickets', async () => {
      if (!tickets) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const t of tickets) {
          if (!t?.id || seen.has(t.id)) continue;
          seen.add(t.id);
          await client.query(
            `INSERT INTO support_tickets (id, user_id, user_name, subject, priority, status, created_at, messages)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               user_id = EXCLUDED.user_id,
               user_name = EXCLUDED.user_name,
               subject = EXCLUDED.subject,
               priority = EXCLUDED.priority,
               status = EXCLUDED.status,
               created_at = EXCLUDED.created_at,
               messages = EXCLUDED.messages`,
            [t.id, t.userId, t.userName, t.subject, t.priority || 'medium', t.status || 'open', t.createdAt, JSON.stringify(t.messages || [])]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM support_tickets WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM support_tickets');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listSupportTickets(): Promise<SupportTicket[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM support_tickets ORDER BY created_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      subject: r.subject,
      priority: r.priority,
      status: r.status,
      createdAt: r.created_at,
      messages: r.messages || []
    }));
  }

  // --- AUDIT LOGS ---
  async saveAuditLogs(logs: AuditLog[]): Promise<void> {
    return this.withLock('audit_logs', async () => {
      if (!logs) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const l of logs) {
          if (!l?.id || seen.has(l.id)) continue;
          seen.add(l.id);
          await client.query(
            `INSERT INTO audit_logs (id, actor, role, action, target, details, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               actor = EXCLUDED.actor,
               role = EXCLUDED.role,
               action = EXCLUDED.action,
               target = EXCLUDED.target,
               details = EXCLUDED.details,
               timestamp = EXCLUDED.timestamp`,
            [l.id, l.actor, l.role, l.action, l.target, l.details || null, l.timestamp]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM audit_logs WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM audit_logs');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM audit_logs');
    return res.rows.map(r => ({
      id: r.id,
      actor: r.actor,
      role: r.role,
      action: r.action,
      target: r.target,
      details: r.details || '',
      timestamp: r.timestamp
    }));
  }

  // --- USER EMAILS ---
  async saveUserEmails(emails: UserEmail[]): Promise<void> {
    return this.withLock('user_emails', async () => {
      if (!emails) return;
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const seen = new Set<string>();
        for (const em of emails) {
          if (!em?.id || seen.has(em.id)) continue;
          seen.add(em.id);
          await client.query(
            `INSERT INTO user_emails (id, user_id, user_email, subject, snippet, body, type, sent_at, date, read)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET
               user_id = EXCLUDED.user_id,
               user_email = EXCLUDED.user_email,
               subject = EXCLUDED.subject,
               snippet = EXCLUDED.snippet,
               body = EXCLUDED.body,
               type = EXCLUDED.type,
               sent_at = EXCLUDED.sent_at,
               date = EXCLUDED.date,
               read = EXCLUDED.read`,
            [
              em.id, em.userId, em.userEmail, em.subject, em.snippet || null, em.body,
              (em as any).type || null, (em as any).sentAt || null, em.date || null, !!em.read
            ]
          );
        }
        if (seen.size > 0) {
          const placeholders = Array.from(seen).map((_, i) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM user_emails WHERE id NOT IN (${placeholders})`, Array.from(seen));
        } else {
          await client.query('DELETE FROM user_emails');
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async listUserEmails(): Promise<UserEmail[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM user_emails');
    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      subject: r.subject,
      snippet: r.snippet || '',
      body: r.body,
      date: r.date || '',
      read: r.read,
      type: r.type || 'GENERAL',
      ...(r.sent_at ? { sentAt: r.sent_at } : {})
    }));
  }

  // --- UPLOADS ---
  async saveUploadRecord(filename: string, record: WorkstreamUploadRecord): Promise<void> {
    return this.withLock('uploads', async () => {
      await this.getPool().query(
        `INSERT INTO uploads (filename, owner_id, original_name, mime, size, created_at, sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (filename) DO UPDATE SET owner_id = EXCLUDED.owner_id, size = EXCLUDED.size, original_name = EXCLUDED.original_name`,
        [filename, record.ownerId, record.originalName || null, record.mime || null, record.size || 0, record.createdAt, record.sha256 || null]
      );
    });
  }

  async deleteUploadRecord(filename: string): Promise<void> {
    return this.withLock('uploads', async () => {
      await this.getPool().query('DELETE FROM uploads WHERE filename = $1', [filename]);
    });
  }

  async listUploadRecords(): Promise<Record<string, WorkstreamUploadRecord>> {
    if (!isPostgresEnabled()) return {};
    const res = await this.getPool().query('SELECT * FROM uploads');
    const out: Record<string, WorkstreamUploadRecord> = {};
    for (const r of res.rows) {
      out[r.filename] = {
        ownerId: r.owner_id,
        originalName: r.original_name || undefined,
        mime: r.mime || undefined,
        size: Number(r.size),
        createdAt: r.created_at,
        sha256: r.sha256 || undefined
      };
    }
    return out;
  }

  // --- SITE SETTINGS ---
  async saveSiteSettings(settings: any): Promise<void> {
    return this.withLock('site_settings', async () => {
      await this.getPool().query(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES ('primary', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(settings)]
      );
    });
  }

  async loadSiteSettings(): Promise<any | null> {
    if (!isPostgresEnabled()) return null;
    const res = await this.getPool().query("SELECT value FROM site_settings WHERE key = 'primary'");
    return res.rows.length > 0 ? res.rows[0].value : null;
  }

  // --- PAYMENT GATEWAYS ---
  async savePaymentGateways(gateways: any): Promise<void> {
    return this.withLock('payment_gateways', async () => {
      await this.getPool().query(
        `INSERT INTO payment_gateways (key, value, updated_at)
         VALUES ('primary', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(gateways)]
      );
    });
  }

  async loadPaymentGateways(): Promise<any | null> {
    if (!isPostgresEnabled()) return null;
    const res = await this.getPool().query("SELECT value FROM payment_gateways WHERE key = 'primary'");
    return res.rows.length > 0 ? res.rows[0].value : null;
  }

  // --- FINANCIAL LEDGER STATE ---
  async saveLedgerState(state: any): Promise<void> {
    return this.withLock('financial_ledger_state', async () => {
      await this.getPool().query(
        `INSERT INTO financial_ledger_state (key, value, updated_at)
         VALUES ('primary', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(state)]
      );
    });
  }

  async loadLedgerState(): Promise<any | null> {
    if (!isPostgresEnabled()) return null;
    const res = await this.getPool().query("SELECT value FROM financial_ledger_state WHERE key = 'primary'");
    return res.rows.length > 0 ? res.rows[0].value : null;
  }

  // --- NOTIFICATIONS ---
  async saveNotification(n: Notification): Promise<void> {
    return this.withLock(`notif_${n.id}`, async () => {
      await this.getPool().query(
        `INSERT INTO notifications (id, user_id, type, title, message, link, read, created_at, dedup_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           read = EXCLUDED.read`,
        [n.id, n.userId, n.type, n.title, n.message, n.link || null, !!n.read, n.createdAt, n.dedupKey || null]
      );
    });
  }

  async listAllNotifications(): Promise<Notification[]> {
    if (!isPostgresEnabled()) return [];
    const res = await this.getPool().query('SELECT * FROM notifications ORDER BY created_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      message: r.message,
      link: r.link || undefined,
      read: r.read,
      createdAt: r.created_at,
      dedupKey: r.dedup_key || undefined
    }));
  }

  async markNotificationRead(id: string, userId: string): Promise<void> {
    if (!isPostgresEnabled()) return;
    await this.getPool().query('UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    if (!isPostgresEnabled()) return;
    await this.getPool().query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [userId]);
  }

  async cleanAllData(): Promise<void> {
    if (!isPostgresEnabled()) return;
    const pool = this.getPool();
    const tables = [
      'notifications',
      'audit_logs',
      'user_emails',
      'support_tickets',
      'payouts',
      'refunds',
      'disputes',
      'custom_invoices',
      'workstream_offers',
      'workspaces',
      'uploads',
      'reviews',
      'messages',
      'orders',
      'proposals',
      'projects',
      'gigs',
      'users',
      'financial_ledger_state',
      'app_metadata'
    ];
    for (const table of tables) {
      try {
        await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      } catch {
        try {
          await pool.query(`DELETE FROM ${table}`);
        } catch (delErr: any) {
          console.warn(`[PostgresStore] Notice: table ${table} clean:`, delErr?.message);
        }
      }
    }
    console.log('[PostgresStore] All application tables successfully cleaned in PostgreSQL.');
  }
}

export const postgresStore = new PostgresStore();


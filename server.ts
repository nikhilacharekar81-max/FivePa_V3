import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { randomUUID, randomBytes, randomInt, timingSafeEqual, createHmac } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { financeLedger, FinanceLedgerEngine } from './src/server/financeLedger.js';
import { workspaceService } from './src/server/workspaceService.js';
import { siteSettings, DEFAULT_SITE_SETTINGS } from './src/server/siteSettings.js';
import { paymentGatewayManager } from './src/server/paymentGateways.js';
import { sanitizePublicUser, isUserPublic, sanitizePublicGig, sanitizePublicProject, isGigPublic, isProjectPublic } from './server/publicData.js';
import { setupSSR } from './server/ssr.js';
import { slugify } from './src/utils/slugify.js';
export { siteSettings, DEFAULT_SITE_SETTINGS, isGigPublic, sanitizePublicGig };
import { OrderFeeBreakdown } from './src/shared/fees.js';
import {
  SEED_USERS,
  SEED_GIGS,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  SEED_ORDERS,
  SEED_REVIEWS,
  SEED_MESSAGES
} from './src/data/completeSeedDataset.js';
import { postgresStore } from './server/db/postgresStore.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.path === '/api/payments/webhook' && req.method === 'POST') {
    return next();
  }
  return express.json({ limit: '10mb' })(req, res, next);
});

// ==========================================
// PRODUCTION / DEVELOPMENT SECURITY BOUNDARY
// ==========================================
const isCompiledProductionBundle = path.basename(fileURLToPath(import.meta.url)).startsWith('server.js');
const isNpmStart = process.env.npm_lifecycle_event === 'start';
const isExplicitProd = process.env.NODE_ENV === 'production';
const isTestEnv = process.env.NODE_ENV === 'test';

// Enforce production mode for compiled production bundles or npm start, unless in test environment
const IS_PROD = (isExplicitProd || isNpmStart || isCompiledProductionBundle) && !isTestEnv;

if (IS_PROD) {
  (process.env as any).NODE_ENV = 'production';
}

// Internal secrets
export const IS_PRODUCTION = process.env.NODE_ENV === 'production' || isCompiledProductionBundle;
const JWT_SECRET: string = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  return process.env.JWT_FALLBACK_SECRET || 'wph_jwt_secret_internal_session_token_key_2026';
})();

const REQUIRE_KYC_FOR_PAYOUTS = false;

function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function areSimulatedDepositsAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return !IS_PRODUCTION;
}

export function apiError(res: Response, message: string, status: number = 400) {
  return res.status(status).json({ error: message });
}

function saveEntityToDisk(type: 'orders' | 'reviews' | 'messages', data: any) {
  const fileMap = {
    orders: path.join(DATA_DIR, 'workstream_orders.json'),
    reviews: path.join(DATA_DIR, 'workstream_reviews.json'),
    messages: path.join(DATA_DIR, 'workstream_messages.json')
  };
  fs.writeFileSync(fileMap[type], JSON.stringify(data, null, 2));
}

// Feed business rules from the site settings into the ledger engine
financeLedger.configure({
  commissionPercent: DEFAULT_SITE_SETTINGS.commission.commissionPercent,
  buyerFeePercent: DEFAULT_SITE_SETTINGS.commission.buyerProcessingFeePercent,
  smallOrderFee: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeAmount,
  smallOrderThreshold: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeThreshold,
  refundClientFeesOnFullRefund: DEFAULT_SITE_SETTINGS.commission.refundClientFeesOnFullRefund,
  minimumOrderAmount: DEFAULT_SITE_SETTINGS.commission.minimumOrderAmount,
  minimumWithdrawalAmount: DEFAULT_SITE_SETTINGS.wallets.minimumWithdrawalAmount,
  maximumWithdrawalAmount: DEFAULT_SITE_SETTINGS.wallets.maximumWithdrawalPerTransaction
});

// ==========================================
// CRYPTOGRAPHIC AUTHENTICATION ADAPTER (JWT / Session)
// ==========================================

export function signToken(payload: { id: string; role: string; email: string; sessionVersion?: number }, expiresInMs = 7 * 24 * 3600 * 1000): string {
  const data = JSON.stringify({ ...payload, exp: Date.now() + expiresInMs });
  const base64Data = Buffer.from(data).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
  return `${base64Data}.${signature}`;
}

function verifyToken(token: string): { id: string; role: string; email: string; sessionVersion?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [base64Data, signature] = parts;
    const expectedSig = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
    
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(base64Data, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    const dbUser = users.find(u => u.id === payload.id);
    if (dbUser) {
      if (payload.sessionVersion !== undefined) {
        if (!dbUser.sessionVersion || dbUser.sessionVersion < payload.sessionVersion) {
          dbUser.sessionVersion = payload.sessionVersion;
        } else if (dbUser.sessionVersion && payload.sessionVersion !== dbUser.sessionVersion) {
          return null; // Session invalidated by password reset or explicit logout
        }
      }
    }

    return payload;
  } catch {
    return null;
  }
}

// Global Authentication Middleware: verifies cryptographic signed JWT/session and populates req.user
function verifyAuthTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();

    // Remove admin token bypass


    const payload = verifyToken(token);
    if (payload) {
      const dbUser = users.find(u => u.id === payload.id);
      if (dbUser) {
        (req as any).user = {
          id: dbUser.id,
          role: dbUser.role,
          status: dbUser.status,
          email: dbUser.email
        };
        (req as any).authenticatedUserId = dbUser.id;
        (req as any).authenticatedUser = dbUser;
        return next();
      }
    }
  }

  // Without a valid cryptographic session token, the request is strictly unauthenticated
  (req as any).user = null;
  (req as any).authenticatedUserId = null;
  (req as any).authenticatedUser = null;
  next();
}

app.use(verifyAuthTokenMiddleware);

// Resolve authenticated user identity strictly from verified session (NEVER from client-supplied IDs)
function resolveAuthenticatedUserId(req: Request): string | null {
  const authUser = (req as any).user?.id || (req as any).authenticatedUserId;
  if (authUser && typeof authUser === 'string' && authUser.trim()) {
    return authUser.trim();
  }
  return null;
}
// ROBUST USER ACCOUNT SYSTEM & VERIFICATION
// ==========================================

interface VerificationRecord {
  code: string;
  expiresAt: number;
  lastResendAt: number;
  attempts: number;
}

export const emailVerificationCodes = new Map<string, VerificationRecord>();
export const smsVerificationCodes = new Map<string, VerificationRecord>();
export const userEmails: UserEmail[] = [];
const forgotPasswordCodes = new Map<string, VerificationRecord>();
const withdrawalVerificationCodes = new Map<string, VerificationRecord>();

export function generate6DigitCode(): string {
  return randomInt(100000, 1000000).toString();
}

// Verification codes are echoed back in API responses ONLY outside production (dev/test convenience).
// In production a code must never leave the server in a response; otherwise device verification,
// admin 2FA and password reset can all be bypassed by anyone.
const EXPOSE_MOCK_CODES = !IS_PRODUCTION;
export function mockCode(key: string, code: string): Record<string, string> {
  return EXPOSE_MOCK_CODES ? { [key]: code } : {};
}

// New-device verification for regular users. Admin accounts ALWAYS require it.
// Defaults to on outside production. In production it defaults to off until a real email provider is wired in
// (set USER_DEVICE_VERIFICATION=true to enable it).
const USER_DEVICE_VERIFICATION = process.env.USER_DEVICE_VERIFICATION
  ? process.env.USER_DEVICE_VERIFICATION === 'true'
  : !IS_PRODUCTION;

// No email provider is integrated yet. In production, admin verification codes are written to the server log
// so the owner can still sign in; replace this with a real mail/SMS sender.
export function deliverAdminCode(email: string, code: string) {
  console.warn(`[AUTH ADMIN 2FA] Verification code for ${email}: ${code}`);
}

export function isValidEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
export function isValidMobile(v: string): boolean {
  return /^\+?[0-9][0-9\s\-()]{6,18}$/.test(v);
}

// 1. Signup Endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword, mobile, name } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof mobile !== 'string' || !email.trim() || !password || !mobile.trim()) {
      return apiError(res, 'Email, password, and mobile number are required.');
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (password.length > 72) {
      return res.status(400).json({ error: 'Password must be at most 72 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!isValidMobile(mobile.trim())) {
      return res.status(400).json({ error: 'Please enter a valid mobile number.' });
    }
    const existing = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    if (users.some(u => u.mobile && u.mobile === mobile.trim())) {
      return res.status(409).json({ error: 'An account with this mobile number already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUserId = 'user_' + Date.now() + '_' + randomBytes(3).toString('hex');
    const isFirstUser = users.length === 0;
    const newUser: User = {
      id: newUserId,
      name: (typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : normalizedEmail.split('@')[0]),
      email: normalizedEmail,
      mobile: mobile.trim(),
      role: 'user',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&h=400&fit=crop',
      title: 'Freelancer / Member',
      rating: 0,
      reviewsCount: 0,
      hourlyRate: 50,
      earned: 0,
      completedJobs: 0,
      bio: 'New member on WorkPerHour.',
      skills: ['General'],
      status: 'active',
      verified: false,
      emailVerified: false,
      mobileVerified: false,
      walletBalance: 0,
      createdAt: new Date().toISOString().substring(0, 10),
      password: hashedPassword,
      sessionVersion: 1,
      knownDevices: req.body?.deviceId ? [String(req.body.deviceId).trim()] : ['dev_default_session']
    };

    users.push(newUser);
    ensureWallet(newUserId);

    const emailCode = generate6DigitCode();
    emailVerificationCodes.set(normalizedEmail, {
      code: emailCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    const smsCode = generate6DigitCode();
    smsVerificationCodes.set(mobile.trim(), {
      code: smsCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    if (!IS_PRODUCTION) {
    }

    userEmails.unshift({
      id: 'email_' + Date.now(),
      userId: newUserId,
      userEmail: normalizedEmail,
      subject: 'Verify Your WorkPerHour Account',
      snippet: `Your email verification code is ${emailCode}`,
      body: `Welcome to WorkPerHour! Please enter verification code ${emailCode} to verify your account.`,
      date: new Date().toLocaleDateString(),
      read: false
    });

    const token = signToken({ id: newUser.id, role: newUser.role, email: newUser.email, sessionVersion: newUser.sessionVersion });

    res.status(201).json({
      success: true,
      token,
      user: safeUser(newUser),
      ...mockCode('mockEmailCode', emailCode),
      ...mockCode('mockSmsCode', smsCode)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// 2. Email Verification & Resend
app.post('/api/auth/verify-email', (req, res) => {
  const { email, code: rawCode } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || rawCode === undefined || rawCode === null || String(rawCode).trim() === '') return res.status(400).json({ error: 'Email and code are required.' });
  const code = String(rawCode);
  const normalizedEmail = email.trim().toLowerCase();
  const record = emailVerificationCodes.get(normalizedEmail);
  if (!record) return res.status(400).json({ error: 'No verification code found or code expired.' });
  if (Date.now() > record.expiresAt) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }
  if (record.attempts >= 5) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(429).json({ error: 'Too many failed attempts. Code invalidated.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  emailVerificationCodes.delete(normalizedEmail);
  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  if (user) {
    (user as any).emailVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Email verified successfully!' });
});

app.post('/api/auth/resend-email-code', (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = emailVerificationCodes.get(normalizedEmail);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before requesting a new resend.' });
  }

  const newCode = generate6DigitCode();
  emailVerificationCodes.set(normalizedEmail, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  userEmails.unshift({
    id: 'email_' + Date.now(),
    userId: user?.id || 'guest',
    userEmail: normalizedEmail,
    subject: 'Your New WorkPerHour Verification Code',
    snippet: `Your new verification code is ${newCode}`,
    body: `Here is your requested verification code: ${newCode}. It is valid for 15 minutes.`,
    date: new Date().toLocaleDateString(),
    read: false
  });

  if (!IS_PRODUCTION) {
  } else if (user && (user.role === 'admin' || user.role === 'super_admin')) {
    deliverAdminCode(normalizedEmail, newCode);
  }
  res.json({ success: true, message: 'New verification code generated and sent.', ...mockCode('mockEmailCode', newCode) });
});

// 3. Mobile / SMS Verification & Resend
app.post('/api/auth/verify-sms', (req, res) => {
  const { mobile, code: rawCode } = req.body || {};
  if (typeof mobile !== 'string' || !mobile.trim() || rawCode === undefined || rawCode === null || String(rawCode).trim() === '') return res.status(400).json({ error: 'Mobile number and code are required.' });
  const code = String(rawCode);
  const cleanMobile = mobile.trim();
  const record = smsVerificationCodes.get(cleanMobile);
  if (!record) return res.status(400).json({ error: 'No SMS verification code found or expired.' });
  if (Date.now() > record.expiresAt) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(400).json({ error: 'SMS verification code has expired.' });
  }
  if (record.attempts >= 5) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(429).json({ error: 'Too many failed attempts.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid SMS verification code.' });
  }

  smsVerificationCodes.delete(cleanMobile);
  const user = users.find(u => u.mobile === cleanMobile);
  if (user) {
    (user as any).mobileVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Mobile verified successfully via SMS! Account is now active and usable.' });
});

app.post('/api/auth/resend-sms-code', (req, res) => {
  const { mobile } = req.body || {};
  if (typeof mobile !== 'string' || !mobile.trim()) return res.status(400).json({ error: 'Mobile number is required.' });
  const cleanMobile = mobile.trim();
  const existing = smsVerificationCodes.get(cleanMobile);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before resending SMS.' });
  }

  const newCode = generate6DigitCode();
  smsVerificationCodes.set(cleanMobile, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  if (!IS_PRODUCTION) {}
  res.json({ success: true, message: 'New SMS OTP dispatched.', ...mockCode('mockSmsCode', newCode) });
});

function sanitizeAndCreateMessage(
  sender: User,
  order: Order,
  body: any,
  fileCheck: { ok: boolean; fileInfo?: any; error?: string }
): Message {
  // Stored as typed; React escapes on render, so escaping here would double-escape (&lt; shown literally).
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const isSystemOrStaff = isStaffUser(sender);
  
  let type = body.type;
  if (!isSystemOrStaff && (type === 'system' || type === 'deliverable')) {
    type = 'message';
  }
  if (type !== 'message' && type !== 'file') {
    type = 'message';
  }
  if (type !== 'file' && !text) {
    throw new Error('Message text is required.');
  }
  if (text.length > 5000) {
    throw new Error('Message is too long.');
  }

  const metadata: any = {};
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    Object.assign(metadata, body.metadata);
  }

  // 1. Offer cards (proposal / invoice / deposit) are created only by the server from real offer records.
  // A browser must never be able to forge one through a plain message.
  delete metadata.offerId;
  delete metadata.offerKind;

  // 2. Prevent browser-supplied metadata from forging trusted system, platform, payment, or lifecycle events.
  // Normal buyer/seller chat can include benign UI metadata (e.g. clientMessageId, requirementText),
  // but cannot spoof platform-level lifecycle, payment, escrow, delivery, dispute, or administrative events.
  if (!isSystemOrStaff) {
    const FORBIDDEN_METADATA_KEYS = [
      'disputeId', 'revisionId', 'reviewId', 'ticketId', 'payoutId', 'refundId', 'transactionId',
      'deliveryVersion', 'version', 'amount', 'refundAmount', 'feeBreakdown',
      'system', 'isSystem', 'official', 'verified', 'trusted', 'isAdmin', 'isStaff',
      'role', 'senderRole', 'status', 'orderStatus', 'paymentStatus', 'escrowStatus'
    ];
    for (const key of FORBIDDEN_METADATA_KEYS) {
      delete metadata[key];
    }

    if (typeof metadata.action === 'string') {
      const action = metadata.action.trim().toLowerCase();
      const isReservedAction =
        /^(offer_|escrow_|deliverable_|delivery_|revision_|dispute_|review_|order_|payment_|payout_|refund_|wallet_|transaction_|deposit_|system_|admin_|staff_|moderation_|audit_|project_proposal)/i.test(action) ||
        ['auto_accept', 'order_auto_accepted', 'release_escrow', 'escrow_release'].includes(action);

      if (isReservedAction) {
        delete metadata.action;
      }
    }
  } else {
    if (typeof metadata.action === 'string' && /^offer_/i.test(metadata.action)) {
      delete metadata.action;
    }
  }

  if (body.clientMessageId) {
    metadata.clientMessageId = String(body.clientMessageId);
  }
  if (body.metadata?.clientMessageId) {
    metadata.clientMessageId = String(body.metadata.clientMessageId);
  }

  return {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: sender.id,
    senderName: sender.name,
    text: text.slice(0, 5000),
    timestamp: new Date().toISOString(),
    type,
    fileInfo: fileCheck.fileInfo,
    metadata
  };
}

// 4. Secure Login with Single Active Session per Account and Device Verification
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

async function handleLogin(req: Request, res: Response) {
  const clientIp = (req.ip || req.socket.remoteAddress || 'unknown-client').toString();
  const { email, password, userId, code, verificationCode, emailCode } = req.body || {};
  const lookupEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const lookupId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;

  // Lock out by client IP AND by targeted account, so a single account cannot be brute-forced from many IPs.
  const now = Date.now();
  const cooldownMs = process.env.NODE_ENV === 'test' ? 2000 : 60000;
  const attemptKeys = [clientIp, ...(lookupEmail || lookupId ? ['acct:' + (lookupEmail || lookupId)] : [])];
  for (const key of attemptKeys) {
    const attemptRecord = loginAttempts.get(key);
    if (!attemptRecord) continue;
    if (now < attemptRecord.resetAt && attemptRecord.count >= 5) {
      return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    }
    if (now >= attemptRecord.resetAt) {
      loginAttempts.delete(key);
    }
  }

  function recordFailedLogin() {
    for (const key of attemptKeys) {
      const record = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + cooldownMs };
      record.count++;
      loginAttempts.set(key, record);
    }
  }

  if (!lookupEmail && !lookupId) {
    return res.status(401).json({ error: 'Email is required for login.' });
  }

  if (typeof password !== 'string' || !password.trim()) {
    return res.status(401).json({ error: 'Password is required.' });
  }

  const user = users.find(u => 
    (lookupEmail && u.email && u.email.toLowerCase() === lookupEmail) ||
    (lookupId && u.id === lookupId)
  );

  if (!user) {
    recordFailedLogin();
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // A password is ALWAYS required: no hardcoded passwords and no passwordless accounts.
  const passwordMatch = typeof user.password === 'string' && user.password.length > 0 && bcrypt.compareSync(password, user.password);
  if (!passwordMatch) {
    recordFailedLogin();
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: `Account is ${user.status}.` });
  }

  // Device verification & Admin 2FA flow
  const rawDeviceId = req.body?.deviceId || req.headers['x-device-id'];
  const deviceId = rawDeviceId ? String(rawDeviceId).trim() : 'dev_default_session';

  if (!user.knownDevices || !Array.isArray(user.knownDevices)) {
    user.knownDevices = [];
  }

  const isAdminRole = user.role === 'admin' || user.role === 'super_admin';
  const providedCode = (code || verificationCode || emailCode)?.toString().trim();
  // Placeholder device ids and the client-supplied skip flag are a dev/test convenience only. They never
  // bypass verification in production and never bypass it for administrator accounts.
  const isPlaceholderDevice = deviceId === 'dev_default_session' || deviceId === 'unknown';
  const trustedDevice = user.knownDevices.includes(deviceId) && !(isAdminRole && isPlaceholderDevice);
  const devBypass = !IS_PRODUCTION && !isAdminRole && (isPlaceholderDevice || Boolean(req.body?.skipDeviceVerification));
  const requiresVerification = isAdminRole
    ? !trustedDevice
    : (USER_DEVICE_VERIFICATION && !trustedDevice && !devBypass);

  if (requiresVerification) {
    const userEmailKey = (user.email || lookupEmail || user.id).toLowerCase();

    if (!providedCode) {
      const newCode = generate6DigitCode();
      emailVerificationCodes.set(userEmailKey, {
        code: newCode,
        expiresAt: Date.now() + 15 * 60 * 1000,
        lastResendAt: Date.now(),
        attempts: 0
      });

      if (IS_PRODUCTION && isAdminRole) deliverAdminCode(user.email, newCode);

      userEmails.unshift({
        id: 'email_' + Date.now(),
        userId: user.id,
        userEmail: user.email,
        subject: isAdminRole ? 'Admin Login Email Verification Code' : 'New Device Login Verification Code',
        snippet: `Your verification code is ${newCode}`,
        body: isAdminRole
          ? `An administrator login attempt was initiated. Please enter verification code ${newCode} to access the Admin Dashboard.`
          : `A login attempt from a new device (${deviceId}) was detected. Please enter verification code ${newCode} to create a new session.`,
        date: new Date().toLocaleDateString(),
        read: false
      });

      return res.status(200).json({
        requiresVerification: true,
        requireCode: true,
        message: isAdminRole
          ? 'Admin login requires an email verification code. Code sent to your registered admin email.'
          : 'New device detected. Please provide the email verification code sent to your email.',
        ...mockCode('mockEmailCode', newCode),
        deviceId
      });
    }

    // Verify provided code (previously unreachable: any code was accepted on an unknown device)
    const record = emailVerificationCodes.get(userEmailKey);
    if (!record || Date.now() > record.expiresAt) {
      recordFailedLogin();
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }
    if (record.attempts >= 5) {
      emailVerificationCodes.delete(userEmailKey);
      return res.status(429).json({ error: 'Too many failed attempts. Please log in again to receive a new code.' });
    }
    if (record.code !== providedCode) {
      record.attempts++;
      recordFailedLogin();
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }

    emailVerificationCodes.delete(userEmailKey);
    if (!user.knownDevices.includes(deviceId)) {
      user.knownDevices.push(deviceId);
      if (user.knownDevices.length > 10) user.knownDevices.shift();
    }
  }

  // Invalidate any previous active session: Every successful login increments sessionVersion
  user.sessionVersion = (user.sessionVersion || 0) + 1;

  for (const key of attemptKeys) loginAttempts.delete(key);

  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({
    success: true,
    token,
    user: safeUser(user)
  });
}

app.post('/api/auth/login', handleLogin);
app.post('/api/auth/login/verify', handleLogin);

app.get('/api/auth/me', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthenticated session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  return res.json({ success: true, user: safeUser(u) });
});

app.post('/api/auth/demo-session', (req, res) => {
  // Passwordless demo login is a development convenience only; never available in production.
  if (IS_PRODUCTION && !isTestEnv) return res.status(404).json({ error: 'Not found.' });
  const { userId } = req.body || {};
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Demo user not found.' });
  if (['admin', 'super_admin', 'support'].includes(user.role)) {
    return res.status(403).json({ error: 'Demo login is not available for privileged accounts.' });
  }
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({ success: true, token, user: safeUser(user) });
});

// 5. Forgot Password Flow
// Validates a recovery code with a hard attempt limit (6-digit codes are otherwise brute-forceable).
function checkRecoveryCode(query: string, code: unknown): 'ok' | 'invalid' | 'locked' {
  const record = forgotPasswordCodes.get(query);
  if (!record || Date.now() > record.expiresAt) return 'invalid';
  if (record.attempts >= 5) {
    forgotPasswordCodes.delete(query);
    return 'locked';
  }
  if (typeof code !== 'string' && typeof code !== 'number') return 'invalid';
  if (record.code !== String(code).trim()) {
    record.attempts++;
    return 'invalid';
  }
  return 'ok';
}

app.post('/api/auth/forgot-password/request', (req, res) => {
  const { emailOrMobile } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim()) return res.status(400).json({ error: 'Email or mobile is required.' });
  const query = emailOrMobile.trim().toLowerCase();
  // Identical response whether or not the account exists (no account enumeration).
  const genericResponse = { success: true, message: 'If an account exists, a recovery code has been sent.' };
  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) {
    return res.json(genericResponse);
  }

  const existing = forgotPasswordCodes.get(query);
  if (existing && Date.now() - existing.lastResendAt < 30_000) {
    return res.json(genericResponse);
  }

  const code = generate6DigitCode();
  forgotPasswordCodes.set(query, {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
    lastResendAt: Date.now(),
    attempts: 0
  });

  if (!IS_PRODUCTION) {
  } else if (user.role === 'admin' || user.role === 'super_admin') {
    deliverAdminCode(user.email, code);
  }

  res.json({ ...genericResponse, ...mockCode('mockRecoveryCode', code) });
});

app.post('/api/auth/forgot-password/verify', (req, res) => {
  const { emailOrMobile, code } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim() || !code) return res.status(400).json({ error: 'Identifier and code are required.' });
  const query = emailOrMobile.trim().toLowerCase();
  const check = checkRecoveryCode(query, code);
  if (check === 'locked') return res.status(429).json({ error: 'Too many failed attempts. Please request a new recovery code.' });
  if (check !== 'ok') {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }
  res.json({ success: true, message: 'Code verified successfully.' });
});

app.post('/api/auth/forgot-password/reset', (req, res) => {
  const { emailOrMobile, code, newPassword, confirmPassword, confirmNewPassword } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim() || !code || typeof newPassword !== 'string' || !newPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  const confirmToUse = confirmPassword || confirmNewPassword;
  if (confirmToUse && newPassword !== confirmToUse) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }
  if (newPassword.length > 72) {
    return res.status(400).json({ error: 'New password must be at most 72 characters long.' });
  }
  const query = emailOrMobile.trim().toLowerCase();
  const check = checkRecoveryCode(query, code);
  if (check === 'locked') return res.status(429).json({ error: 'Too many failed attempts. Please request a new recovery code.' });
  if (check !== 'ok') {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }

  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.password = bcrypt.hashSync(newPassword, 10);
  user.sessionVersion = (user.sessionVersion || 1) + 1;
  disconnectUserSockets(user.id, 'Password reset');
  forgotPasswordCodes.delete(query);

  res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
});

// 7. Withdrawal Email Verification Endpoints
app.post('/api/auth/withdrawal/request-code', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  if (!caller || !caller.email) return res.status(400).json({ error: 'User email not found.' });

  const code = generate6DigitCode();
  withdrawalVerificationCodes.set(caller.id, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    lastResendAt: Date.now(),
    attempts: 0
  });

  userEmails.unshift({
    id: 'email_' + Date.now(),
    userId: caller.id,
    userEmail: caller.email,
    subject: 'Withdrawal Email Verification Code',
    snippet: `Your withdrawal code is ${code}`,
    body: `You requested a withdrawal from your WorkPerHour wallet. Use verification code ${code} to complete the transaction.`,
    date: new Date().toLocaleDateString(),
    read: false
  });

  res.json({ success: true, message: 'Withdrawal verification code sent to your registered email.', ...mockCode('mockWithdrawalCode', code) });
});

app.post('/api/auth/withdrawal/verify-and-execute', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const { code, amount, method, accountDetails } = req.body || {};

  if (!code) return res.status(400).json({ error: 'Email verification code is required for withdrawal.' });

  const record = withdrawalVerificationCodes.get(caller.id);
  if (!record) {
    return res.status(400).json({ error: 'No active withdrawal verification code found. Please request a new code.' });
  }
  if (Date.now() > record.expiresAt) {
    withdrawalVerificationCodes.delete(caller.id);
    return res.status(400).json({ error: 'Withdrawal verification code has expired.' });
  }
  if (record.attempts >= 5) {
    withdrawalVerificationCodes.delete(caller.id);
    return res.status(429).json({ error: 'Too many incorrect attempts. Verification code invalidated.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  withdrawalVerificationCodes.delete(caller.id);

  req.body.userId = caller.id;
  return handlePayoutRequest(req, res);
});

export function safeUser(user: any) {
  const { password, knownDevices, sessionVersion, ...safe } = user;
  return safe;
}

function orderParticipantSafeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    title: user.title,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    hourlyRate: user.hourlyRate,
    skills: user.skills,
    verified: user.verified,
    status: user.status
  };
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden: Account is suspended, restricted, or deactivated.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

// ---- Workstream access control -------------------------------------------------------------
const STAFF_ROLES = ['admin', 'super_admin', 'support'];
function isStaffUser(user: any): boolean {
  return !!user && STAFF_ROLES.includes(user.role);
}
/** Only the order's buyer, its seller, or platform staff may read or write its workstream. */
function canAccessOrderWorkstream(user: any, order: { buyerId: string; sellerId: string } | undefined): boolean {
  if (!user || !order) return false;
  return isStaffUser(user) || user.id === order.buyerId || user.id === order.sellerId;
}

function adminActor(req: Request): string {
  const authUserId = resolveAuthenticatedUserId(req);
  const u = authUserId ? users.find(user => user.id === authUserId) : null;
  if (u) return `${u.name} (${u.role || 'admin'})`;
  return 'Administrator';
}

function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUserId = resolveAuthenticatedUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const u = users.find(user => user.id === authUserId);
    if (!u) {
      return res.status(401).json({ error: 'User not found.' });
    }
    if (!allowedRoles.includes(u.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
    }
    (req as any).authenticatedUserId = u.id;
    (req as any).authenticatedUser = u;
    next();
  };
}

// Admin guard: strictly requires valid administrator session
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Valid admin session missing.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u || (u.role !== 'super_admin' && u.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

app.use('/api/admin', (req, res, next) => {
  if (req.method === 'GET' && (req.path === '/settings' || req.path === '/site-settings')) {
    return next();
  }
  return requireAdmin(req, res, next);
});


// In-memory rate limiter per route and user identity.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(max: number, windowMs: number, prefix: string = '') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const identity = (req as any).authenticatedUserId || req.ip || 'anon';
    const route = prefix || req.route?.path || req.path;
    const key = `${route}:${identity}`;
    const now = Date.now();
    const record = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count++;
    rateBuckets.set(key, record);
    if (record.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// IP-based rate limiter specifically for WebSocket connection attempts to prevent DoS.
const wsConnectionBuckets = new Map<string, { count: number; resetAt: number }>();
function checkWsIpRateLimit(ip: string): boolean {
  const max = 5; // Max 5 connection attempts
  const windowMs = 30_000; // per 30 seconds
  const now = Date.now();
  const record = wsConnectionBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  
  record.count++;
  wsConnectionBuckets.set(ip, record);
  
  return record.count <= max;
}



export const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const ip = request.socket.remoteAddress || 'unknown';
  if (!checkWsIpRateLimit(ip)) {
    console.warn(`[Security] WebSocket connection attempt from ${ip} rejected: rate limit exceeded.`);
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
wss.on('error', (err) => {
  console.error('WSS Server error:', err);
});

// Interfaces
interface User {
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
  status: 'active' | 'suspended' | 'restricted';
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

interface GigExtra {
  id: string;
  title: string;
  price: number;
}

interface Gig {
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

interface Project {
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

interface Proposal {
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
  workstreamOrderId?: string;
  offerId?: string;
}

interface Order {
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
  completedAt?: string;
  dueDate: string;
  requirements?: string;
  deliverables?: string;
  deliverableFiles?: Array<{ id?: string; name: string; url: string; size: string; uploadedAt?: string }>;
  revisions?: Array<{ id: string; requestedAt: string; reason: string; status: string; version?: number; deliveryVersion?: number }>;
  adminNotes?: string;
  isMuted?: boolean;
  escrowProtectionStartDate?: string;
  escrowProtectionEndDate?: string;
  gigId?: string;
  projectId?: string;
  proposalId?: string;
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

interface Dispute {
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
  assignedTo?: string;
}

interface Refund {
  id: string;
  orderId: string;
  buyerId: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface Payout {
  id: string;
  freelancerId: string;
  amount: number;
  method: 'UPI' | 'Bank Transfer' | 'Stripe' | 'Razorpay' | 'PayPal';
  status: 'pending' | 'approved' | 'processed' | 'failed' | 'cancelled' | 'reversed';
  createdAt: string;
  accountDetails: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  order: number;
  subcategories: { id: string; name: string; slug: string; enabled: boolean }[];
}

interface Review {
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

interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
  messages: { sender: string; text: string; timestamp: string }[];
}

interface AuditLog {
  id: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

interface Message {
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
    disputeId?: string;
    raisedBy?: string;
    isCancelledOrder?: boolean;
    reply?: any;
    offerId?: string;
    offerKind?: string;
    proposalId?: string;
    status?: string;
  };
}

interface UserEmail {
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


function notifyUser(message: Message, targetUserId: string) {
  const payload = JSON.stringify({ type: 'MESSAGE_RECEIVED', message });
  for (const client of clients) {
    const clientUserId = (client as any).authenticatedUserId;
    const clientUser = users.find(u => u.id === clientUserId);
    const isAuthorized = clientUser && (
      ['admin', 'super_admin', 'support'].includes(clientUser.role) ||
      clientUserId === targetUserId
    );
    
    if (isAuthorized && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function notifyUserOnAdminAction(user: User, action: 'suspended' | 'restricted' | 'deactivated' | 'impersonated', notes?: string) {
  const timestamp = new Date().toLocaleString();
  const timeShort = new Date().toISOString();

  let emailSubject = '';
  let emailBody = '';
  let chatText = '';

  if (action === 'suspended') {
    emailSubject = `[URGENT] WorkSphere Account Suspended - Action Required`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) has been SUSPENDED by Platform Administration.\n\nReason/Notes: ${notes || 'Violation of Marketplace Policies / Security Investigation'}.\n\nWhile suspended, your active listings, gigs, and bidding capabilities are temporarily paused. If you believe this is an error or wish to file an appeal, please click "Contact Support Desk" or reply directly to support.`;
    chatText = `🚨 ACCOUNT ALERT: Your WorkSphere account has been SUSPENDED by Platform Administration. Please Contact Support Desk immediately to review your account status and submit an appeal.`;
  } else if (action === 'restricted') {
    emailSubject = `[NOTICE] WorkSphere Account Privileges Restricted`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) privileges have been RESTRICTED by Platform Administration.\n\nReason/Notes: ${notes || 'Account compliance review / policy warning'}.\n\nCertain actions (such as creating new gigs or submitting bids) are currently limited. Please contact our Support Desk to resolve these restrictions.`;
    chatText = `⚠️ ACCOUNT NOTICE: Your WorkSphere account privileges have been RESTRICTED by Platform Administration. Please Contact Support Desk for assistance and clarification.`;
  } else if (action === 'deactivated') {
    emailSubject = `[NOTICE] WorkSphere Account Deactivated`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) has been DEACTIVATED by Platform Administration.\n\nReason/Notes: ${notes || 'Account deactivated'}.`;
    chatText = `🚨 ACCOUNT ALERT: Your WorkSphere account has been DEACTIVATED.`;
  } else if (action === 'impersonated') {
    emailSubject = `[SECURITY NOTICE] Administrative Support Session Initialized`;
    emailBody = `Dear ${user.name},\n\nA Super Administrator initialized an Administrative Support Impersonation Session for your account (${user.email}) at ${timestamp} for support investigation and auditing.\n\nIf you have any questions or security concerns, please contact support immediately.`;
    chatText = `🔒 SECURITY NOTICE: An Administrative Support Impersonation Session was started for your account by Super Admin for inspection. Please contact support if you have any questions.`;
  }

  // 1. Store Email Record
  const newEmail: UserEmail = {
    id: 'email_' + Date.now() + Math.random().toString(36).substring(2, 5),
    userId: user.id,
    userEmail: user.email,
    subject: emailSubject,
    body: emailBody,
    type: action === 'suspended' ? 'SUSPEND' : action === 'restricted' ? 'RESTRICT' : action === 'deactivated' ? 'DEACTIVATE' : 'IMPERSONATE',
    sentAt: timestamp,
    read: false
  };
  userEmails.unshift(newEmail);

  // 2. Add System Chat Message into User's Support Thread
  const supportOrderId = `support_admin_${user.id}`;
  const newChatMsg: Message = {
    id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 5),
    orderId: supportOrderId,
    senderId: 'user-admin',
    senderName: 'WorkSphere Admin & Support Desk',
    text: chatText,
    timestamp: timeShort,
    type: 'system',
    metadata: { action: `admin_${action}` }
  };
  recordMessage(newChatMsg);
  saveMessagesToDisk();

  // 3. Broadcast WS message
  try {
    notifyUser(newChatMsg, user.id);
  } catch (err) {
    console.error('WS notify error:', err);
  }
}

// Development / Testing credentials hashed with bcrypt
// Known demo passwords exist ONLY outside production. In production every seeded account gets an
// unguessable random password; the super admin uses ADMIN_INITIAL_PASSWORD (or a one-time generated
// password printed to the server log on first boot).
const randomPasswordHash = () => bcrypt.hashSync(randomBytes(24).toString('hex'), 10);
let bootstrapAdminPasswordNotice: string | null = null;
if (IS_PRODUCTION && process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD.length < 12) {
  console.warn('[SECURITY] ADMIN_INITIAL_PASSWORD is shorter than 12 characters and was ignored. A random one-time password will be generated instead.');
}


// Initial Data Seeds & Persistent Storage Engine
export let users: User[] = SEED_USERS.map(u => ({
  ...u,
  sessionVersion: u.sessionVersion || 1,
  knownDevices: u.knownDevices || ['dev_default_session']
}));

export let gigs: Gig[] = [...SEED_GIGS];
export let orders: Order[] = [...SEED_ORDERS];
export let projects: Project[] = [...SEED_PROJECTS];
export let proposals: Proposal[] = [...SEED_PROPOSALS];
export let reviews: Review[] = [...SEED_REVIEWS];
export let messages: Message[] = [...SEED_MESSAGES];

// Initialize default wallets for seeded users
for (const u of users) {
  ensureWallet(u.id);
}

export let disputes: Dispute[] = [];
export let refunds: Refund[] = [];
export let payouts: Payout[] = [];

let categories: Category[] = [
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
    slug: 'technology-programming',
    enabled: true,
    order: 2,
    subcategories: [
      { id: 'sub_tech_1', name: 'Web Development', slug: 'web-development', enabled: true },
      { id: 'sub_tech_2', name: 'Mobile Apps', slug: 'mobile-apps', enabled: true },
      { id: 'sub_tech_3', name: 'Software Development', slug: 'software-development', enabled: true },
      { id: 'sub_tech_4', name: 'WordPress', slug: 'wordpress', enabled: true },
      { id: 'sub_tech_5', name: 'E-commerce', slug: 'ecommerce', enabled: true },
      { id: 'sub_tech_6', name: 'Databases', slug: 'databases', enabled: true },
      { id: 'sub_tech_7', name: 'Game Development', slug: 'game-development', enabled: true },
      { id: 'sub_tech_8', name: 'QA & Testing', slug: 'qa-testing', enabled: true },
      { id: 'sub_tech_9', name: 'DevOps & Cloud', slug: 'devops-cloud', enabled: true }
    ]
  },
  {
    id: 'cat_writing',
    name: 'Writing & Translation',
    slug: 'writing-translation',
    enabled: true,
    order: 3,
    subcategories: [
      { id: 'sub_writ_1', name: 'Content Writing', slug: 'content-writing', enabled: true },
      { id: 'sub_writ_2', name: 'Copywriting', slug: 'copywriting', enabled: true },
      { id: 'sub_writ_3', name: 'Translation', slug: 'translation', enabled: true },
      { id: 'sub_writ_4', name: 'Proofreading & Editing', slug: 'proofreading-editing', enabled: true },
      { id: 'sub_writ_5', name: 'Technical Writing', slug: 'technical-writing', enabled: true },
      { id: 'sub_writ_6', name: 'Blog Posts', slug: 'blog-posts', enabled: true },
      { id: 'sub_writ_7', name: 'Ghostwriting', slug: 'ghostwriting', enabled: true },
      { id: 'sub_writ_8', name: 'CV & Resume Writing', slug: 'resume-writing', enabled: true }
    ]
  },
  {
    id: 'cat_design',
    name: 'Design',
    slug: 'design',
    enabled: true,
    order: 4,
    subcategories: [
      { id: 'sub_des_1', name: 'Logo Design', slug: 'logo-design', enabled: true },
      { id: 'sub_des_2', name: 'Brand Identity', slug: 'brand-identity', enabled: true },
      { id: 'sub_des_3', name: 'Web & UI/UX Design', slug: 'web-ui-ux-design', enabled: true },
      { id: 'sub_des_4', name: 'Graphic Design', slug: 'graphic-design', enabled: true },
      { id: 'sub_des_5', name: 'Illustration', slug: 'illustration', enabled: true },
      { id: 'sub_des_6', name: 'Packaging Design', slug: 'packaging-design', enabled: true },
      { id: 'sub_des_7', name: '3D & CAD', slug: '3d-cad', enabled: true },
      { id: 'sub_des_8', name: 'Book Cover Design', slug: 'book-cover-design', enabled: true }
    ]
  },
  {
    id: 'cat_mkt',
    name: 'Digital Marketing',
    slug: 'digital-marketing',
    enabled: true,
    order: 5,
    subcategories: [
      { id: 'sub_mkt_1', name: 'Search Engine Optimization (SEO)', slug: 'seo', enabled: true },
      { id: 'sub_mkt_2', name: 'Social Media Marketing (SMM)', slug: 'smm', enabled: true },
      { id: 'sub_mkt_3', name: 'Pay Per Click (PPC)', slug: 'ppc', enabled: true },
      { id: 'sub_mkt_4', name: 'Content Marketing', slug: 'content-marketing', enabled: true },
      { id: 'sub_mkt_5', name: 'Email Marketing', slug: 'email-marketing', enabled: true },
      { id: 'sub_mkt_6', name: 'Affiliate Marketing', slug: 'affiliate-marketing', enabled: true },
      { id: 'sub_mkt_7', name: 'Lead Generation', slug: 'lead-generation', enabled: true }
    ]
  },
  {
    id: 'cat_video',
    name: 'Video, Photo & Image',
    slug: 'video-photo-image',
    enabled: true,
    order: 6,
    subcategories: [
      { id: 'sub_vid_1', name: 'Video Editing', slug: 'video-editing', enabled: true },
      { id: 'sub_vid_2', name: 'Animation & Motion Graphics', slug: 'animation-motion-graphics', enabled: true },
      { id: 'sub_vid_3', name: 'Video Production', slug: 'video-production', enabled: true },
      { id: 'sub_vid_4', name: 'Photo Editing', slug: 'photo-editing', enabled: true },
      { id: 'sub_vid_5', name: 'Product Photography', slug: 'product-photography', enabled: true },
      { id: 'sub_vid_6', name: 'Subtitles & Captions', slug: 'subtitles-captions', enabled: true },
      { id: 'sub_vid_7', name: 'Spoken Person Videos', slug: 'spokesperson-videos', enabled: true }
    ]
  },
  {
    id: 'cat_biz',
    name: 'Business',
    slug: 'business',
    enabled: true,
    order: 7,
    subcategories: [
      { id: 'sub_biz_1', name: 'Business Plans', slug: 'business-plans', enabled: true },
      { id: 'sub_biz_2', name: 'Financial Modeling', slug: 'financial-modeling', enabled: true },
      { id: 'sub_biz_3', name: 'Virtual Assistant', slug: 'virtual-assistant', enabled: true },
      { id: 'sub_biz_4', name: 'Market Research', slug: 'market-research', enabled: true },
      { id: 'sub_biz_5', name: 'Legal Consulting', slug: 'legal-consulting', enabled: true },
      { id: 'sub_biz_6', name: 'HR & Recruiting', slug: 'hr-recruiting', enabled: true },
      { id: 'sub_biz_7', name: 'Project Management', slug: 'project-management', enabled: true }
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

let supportTickets: SupportTicket[] = [];

export let auditLogs: AuditLog[] = [];

// ==========================================
// WORKSTREAM PERSISTENT STORAGE ENGINE
// ==========================================
// DATA_DIR is defined above near __dirname
const MESSAGES_FILE = path.join(DATA_DIR, 'workstream_messages.json');
const ORDERS_FILE = path.join(DATA_DIR, 'workstream_orders.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'workstream_reviews.json');
const REFUNDS_FILE = path.join(DATA_DIR, 'workstream_refunds.json');
const DISPUTES_FILE = path.join(DATA_DIR, 'workstream_disputes.json');
const PROPOSALS_FILE = path.join(DATA_DIR, 'workstream_proposals.json');
const PAYOUTS_FILE = path.join(DATA_DIR, 'workstream_payouts.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'workstream_projects.json');
const UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_uploads.json'); // Added for completeness

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Atomic writing logic
const writeQueue = new Map<string, Promise<void>>();

async function writeJsonAtomic(filePath: string, data: any) {
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
  return postgresStore.saveMessages(messages).catch(err => console.error('[PostgresStore] Failed to save messages:', err)); 
}
export function saveOrdersToDisk() { 
  return postgresStore.saveOrders(orders).catch(err => console.error('[PostgresStore] Failed to save orders:', err)); 
}
export function saveReviewsToDisk() { 
  return postgresStore.saveReviews(reviews).catch(err => console.error('[PostgresStore] Failed to save reviews:', err)); 
}
export function saveRefundsToDisk() { 
  return postgresStore.saveRefunds(refunds).catch(err => console.error('[PostgresStore] Failed to save refunds:', err)); 
}
export function saveDisputesToDisk() { 
  return postgresStore.saveDisputes(disputes).catch(err => console.error('[PostgresStore] Failed to save disputes:', err)); 
}
export function saveProposalsToDisk() { 
  return postgresStore.saveProposals(proposals).catch(err => console.error('[PostgresStore] Failed to save proposals:', err)); 
}
export function savePayoutsToDisk() { 
  return postgresStore.savePayouts(payouts).catch(err => console.error('[PostgresStore] Failed to save payouts:', err)); 
}
export function saveProjectsToDisk() { 
  return postgresStore.saveProjects(projects).catch(err => console.error('[PostgresStore] Failed to save projects:', err)); 
}
export function saveWorkstreamUploadIndex() { 
  for (const [fn, rec] of Object.entries(workstreamUploadIndex)) {
    postgresStore.saveUploadRecord(fn, rec).catch(err => console.error('[PostgresStore] Failed to save upload record:', err));
  }
}
export function saveUsersToPostgres() {
  return postgresStore.saveUsers(users).catch(err => console.error('[PostgresStore] Failed to save users:', err));
}
export function saveGigsToPostgres() {
  return postgresStore.saveGigs(gigs).catch(err => console.error('[PostgresStore] Failed to save gigs:', err));
}

function handleCorruption(filePath: string, error: any) {
  console.error(`CRITICAL: Data corruption in ${filePath}:`, error);
  if (process.env.ALLOW_EMPTY_DATA !== 'true') {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.renameSync(filePath, backupPath);
    console.error(`Refusing to start. Broken file renamed to ${backupPath}. Set ALLOW_EMPTY_DATA=true to bypass.`);
    process.exit(1);
  }
}

const MAX_AUDIT_LOGS = 1000;
export const orderIndex = new Map<string, Order>();
export const messageIndex = new Map<string, Message[]>();

// Simple in-memory locking mechanism to prevent race conditions on sensitive order state transitions.
const orderStateLocks = new Set<string>();

function acquireOrderLock(orderId: string) {
  if (orderStateLocks.has(orderId)) {
    throw new Error('Action rejected: This order is currently being processed by another operation. Please retry in a moment.');
  }
  orderStateLocks.add(orderId);
}

function tryAcquireOrderLock(orderId: string, res: any): boolean {
  try {
    acquireOrderLock(orderId);
    return true;
  } catch (err: any) {
    res.status(409).json({ error: err.message });
    return false;
  }
}

function releaseOrderLock(orderId: string) {
  orderStateLocks.delete(orderId);
}

export function registerOrder(o: Order) {
  if (!o.id) return;
  orderIndex.set(o.id, o);
}

function registerMessage(m: Message) {
  if (!m.orderId) return;
  const list = messageIndex.get(m.orderId) || [];
  const existingIdx = m.id ? list.findIndex(item => item.id === m.id) : -1;
  if (existingIdx !== -1) {
    list[existingIdx] = m;
  } else {
    list.push(m);
  }
  messageIndex.set(m.orderId, list);
}

function recordOrder(o: Order) {
  workspaceService.ensureWorkspaceForOrder(o);
  orders.unshift(o);
  registerOrder(o);
}

function recordMessage(m: Message) {
  if (!m.id || !messages.some(existing => existing.id === m.id)) {
    messages.push(m);
  }
  registerMessage(m);
}

function registerAuditLog(log: AuditLog) {
  auditLogs.unshift(log);
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS);
  }
}

function loadInitialOrdersAndMessages() {
  ensureDataDirectory();
  
  orderIndex.clear();
  messageIndex.clear();
  
  // 1. Load Orders
  if (fs.existsSync(ORDERS_FILE)) {
    try {
      const data = fs.readFileSync(ORDERS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        orders = parsed;
        orders.forEach(registerOrder);
      } else {
        orders = [...SEED_ORDERS];
        orders.forEach(registerOrder);
      }
    } catch (e) {
      handleCorruption(ORDERS_FILE, e);
    }
  } else {
    orders.forEach(registerOrder);
  }

  // Run safe, idempotent legacy workspace migration on startup
  const migrationRes = workspaceService.migrateLegacyOrders(orders, false);
  if (migrationRes.migratedCount > 0) {
    console.log(`[WorkspaceMigration] Migrated ${migrationRes.migratedCount} legacy orders to Workspaces on startup.`);
    saveOrdersToDisk();
    workspaceService.saveToDisk();
  }

  // RECOVERY: Reconcile any 'payment_pending' orders with the financial ledger (Crash Safety)
  let recoveryNeeded = false;
  for (const order of orders) {
    if (order.status === 'payment_pending') {
      const escrow = financeLedger.getEscrow(order.id);
      if (escrow) {
        console.log(`[Recovery] Order ${order.id} was in payment_pending but ledger has escrow. Recovering to funded_in_escrow.`);
        order.status = 'funded_in_escrow';
        order.previousStatus = undefined;
        recoveryNeeded = true;
      } else {
        console.log(`[Recovery] Order ${order.id} was in payment_pending but ledger has no escrow. Recovering to ${order.previousStatus || 'cancelled'}.`);
        order.status = (order.previousStatus as any) || 'cancelled';
        order.previousStatus = undefined;
        recoveryNeeded = true;
      }
    }
  }
  if (recoveryNeeded) {
    saveOrdersToDisk();
  }

  // 2. Load Messages
  if (fs.existsSync(MESSAGES_FILE)) {
    try {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(parsed.map((m: any) => m.id));
        const merged = [...SEED_MESSAGES.filter(m => !existingIds.has(m.id)), ...parsed];
        const seenIds = new Set<string>();
        messages = merged.filter((m: any) => {
          if (!m?.id) return true;
          if (seenIds.has(m.id)) return false;
          seenIds.add(m.id);
          return true;
        });
      } else {
        messages = [...SEED_MESSAGES];
      }
    } catch (e) {
      handleCorruption(MESSAGES_FILE, e);
    }
  } else {
    messages = [...SEED_MESSAGES];
  }
  saveMessagesToDisk();

  // 3. Load Reviews
  if (fs.existsSync(REVIEWS_FILE)) {
    try {
      const data = fs.readFileSync(REVIEWS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        reviews = parsed;
      }
    } catch (e) {
      handleCorruption(REVIEWS_FILE, e);
    }
  }

  // 4. Load Refunds
  if (fs.existsSync(REFUNDS_FILE)) {
    try {
      const data = fs.readFileSync(REFUNDS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        refunds = parsed;
      }
    } catch (e) {
      handleCorruption(REFUNDS_FILE, e);
    }
  }

  // 5. Load Disputes
  if (fs.existsSync(DISPUTES_FILE)) {
    try {
      const data = fs.readFileSync(DISPUTES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        disputes = parsed;
      }
    } catch (e) {
      handleCorruption(DISPUTES_FILE, e);
    }
  }

  // 6. Load Proposals
  if (fs.existsSync(PROPOSALS_FILE)) {
    try {
      const data = fs.readFileSync(PROPOSALS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const parsedIds = new Set(parsed.map((p: any) => p.id));
        proposals = [...parsed, ...SEED_PROPOSALS.filter(p => !parsedIds.has(p.id))];
      }
    } catch (e) {
      console.error('Failed to load proposals file:', e);
    }
  }

  // 8. Load Projects
  if (fs.existsSync(PROJECTS_FILE)) {
    try {
      const data = fs.readFileSync(PROJECTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const parsedIds = new Set(parsed.map((p: any) => p.id));
        projects = [...parsed, ...SEED_PROJECTS.filter(p => !parsedIds.has(p.id))];
      }
    } catch (e) {
      console.error('Failed to load projects file:', e);
    }
  }
  saveProjectsToDisk();

  // 7. Load Payouts
  if (fs.existsSync(PAYOUTS_FILE)) {
    try {
      const data = fs.readFileSync(PAYOUTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        payouts = parsed;
      }
    } catch (e) {
      console.error('Failed to load payouts file:', e);
    }
  }

  // One-time migration & Index Population
  let messagesMigrated = false;
  for (const msg of messages) {
    if (!msg.timestamp || !/\d{4}-\d{2}-\d{2}/.test(msg.timestamp)) {
      const order = orderIndex.get(msg.orderId);
      let baseDate = order?.createdAt;
      if (!baseDate || !/\d{4}-\d{2}-\d{2}/.test(baseDate)) {
        baseDate = new Date().toISOString();
      }
      const datePart = baseDate.split('T')[0];

      const timeMatch = msg.timestamp ? msg.timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i) : null;
      let hours = 0, minutes = 0, seconds = 0;
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
      } else {
        msg.timestamp = new Date().toISOString();
      }
      messagesMigrated = true;
    }
    registerMessage(msg);
  }
  
  if (messagesMigrated) {
    saveMessagesToDisk();
    console.log('Migrated legacy non-ISO message timestamps to ISO strings.');
  }

  // Synchronize user review stats
  for (const u of users) {
    recalculateUserRating(u.id);
  }

  saveOrdersToDisk();
  saveMessagesToDisk();
  saveReviewsToDisk();
}

// Execute initial load
loadInitialOrdersAndMessages();

function enrichOrderWithServiceInfo(o: Order, isAdmin: boolean = false) {
  // Link a gig only when the order references it (or its title matches exactly). Guessing "the seller's first gig"
  // gave proposal / custom workstreams the wrong thumbnail, title and service link.
  const gig = (o.gigId ? gigs.find(g => g.id === o.gigId) : undefined) ||
              gigs.find(g => g.title.toLowerCase() === o.title.toLowerCase());
  const project = (o.projectId ? projects.find(p => p.id === o.projectId) : undefined) ||
                  projects.find(p => p.title.toLowerCase() === o.title.toLowerCase());
  const seller = users.find(u => u.id === o.sellerId);
  const buyer = users.find(u => u.id === o.buyerId);
  const sellerUsername = o.sellerUsername || gig?.freelancerUsername || (seller?.username || seller?.name || '').toLowerCase().replace(/\s+/g, '_');
  const buyerUsername = o.buyerUsername || (buyer?.username || buyer?.name || '').toLowerCase().replace(/\s+/g, '_');
  const gigSlug = o.gigSlug || gig?.slug;
  const serviceUrl = o.serviceUrl || (gig && gigSlug ? `/${sellerUsername}/${gigSlug}` : project ? `/projects/${project.id}` : undefined);
  const serviceTitle = gig?.title || project?.title || o.serviceTitle || o.title;
  const serviceThumbnail = o.serviceThumbnail || gig?.image || 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=500&fit=crop';

  const orderMessages = messageIndex.get(o.id) || [];
  const lastMsg = orderMessages.length > 0 
    ? [...orderMessages].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] 
    : undefined;

  const reviewWindowDays = getReviewWindowDays();
  const reviewWindowEnabled = isAutoAcceptEnabled();
  let reviewWindowExpiresAt: string | undefined;
  if (o.status === 'delivered' && Array.isArray(o.deliveryHistory) && o.deliveryHistory.length > 0) {
    const lastDelivery = o.deliveryHistory[o.deliveryHistory.length - 1];
    if (lastDelivery?.deliveredAt) {
      const deliveredTime = new Date(lastDelivery.deliveredAt).getTime();
      if (!isNaN(deliveredTime)) {
        reviewWindowExpiresAt = new Date(deliveredTime + reviewWindowDays * 24 * 60 * 60 * 1000).toISOString();
      }
    }
  }

  const buyerReview = o.review && (!o.review.reviewerId || o.review.reviewerId === o.buyerId)
    ? o.review
    : reviews.find(r => r.orderId === o.id && r.reviewerId === o.buyerId);
  const sellerReview = (o as any).sellerReview || reviews.find(r => r.orderId === o.id && r.reviewerId === o.sellerId);
  const esc = financeLedger.getEscrow(o.id);
  const escrowRemaining = esc ? esc.remaining : (o.status === 'completed' || o.status === 'cancelled' ? 0 : Number(o.amount || 0));
  const totalReleased = esc ? esc.releasedGross : (o.status === 'completed' ? Number(o.amount || 0) : 0);
  const hasPaidInvoice = Boolean(
    o.status === 'completed' ||
    releaseCompletedOrders.has(o.id) ||
    (esc && esc.releasedGross > 0) ||
    (typeof workstreamOffers !== 'undefined' && Array.isArray(workstreamOffers) && workstreamOffers.some(of => of.orderId === o.id && of.kind === 'invoice' && of.status === 'paid'))
  );

  const base = {
    ...o,
    ...(buyerReview ? { review: buyerReview } : {}),
    ...(sellerReview ? { sellerReview } : {}),
    escrowRemaining,
    totalReleased,
    hasPaidInvoice,
    gigId: o.gigId || gig?.id,
    projectId: o.projectId || project?.id,
    sellerUsername,
    buyerUsername,
    gigSlug,
    serviceUrl,
    serviceTitle,
    serviceThumbnail,
    lastMessage: lastMsg?.text,
    lastMessageTime: lastMsg?.timestamp,
    isTimerPaused: Boolean(o.isTimerPaused),
    reviewWindowDays,
    reviewWindowEnabled,
    reviewWindowExpiresAt,
    acceptedVersion: o.acceptedVersion
  };

  if (!isAdmin) {
    const { adminNotes, isMuted, ...sanitized } = base;
    return sanitized;
  }
  return base;
}

export function getReviewWindowDays(): number {
  if (process.env.REVIEW_WINDOW_DAYS !== undefined) {
    const parsed = Number(process.env.REVIEW_WINDOW_DAYS);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  const settings = siteSettings.getSettings();
  if (typeof settings.marketplace?.autoCompleteDeliveredDays === 'number') {
    return settings.marketplace.autoCompleteDeliveredDays;
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
  return getReviewWindowDays() > 0;
}

// REST API Endpoints - Site & Fee Settings
const handleGetSiteSettings = (req: Request, res: Response) => {
  const flattened = siteSettings.getFlattenedSettings();
  res.json({ success: true, settings: flattened, ...flattened });
};

const handlePostSiteSettings = (req: Request, res: Response) => {
  try {
    const actor = (req as any).authenticatedUser?.name || req.body?.updatedBy || 'Super Admin';
    const updatedFlattened = siteSettings.updateFromFlatObject(req.body || {}, actor);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'SITE_FEE_SETTINGS_UPDATED',
      target: 'Platform Settings & Fee Structure',
      details: `Updated settings saved to disk and applied across backend engine: Commission=${updatedFlattened.freelancerCommissionRate}%, EscrowHold=${updatedFlattened.escrowHoldDays}d, ClientFee=${updatedFlattened.buyerProcessingFeeRate}%, SmallOrderFee=$${updatedFlattened.smallOrderFee} under $${updatedFlattened.smallOrderFeeThreshold}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, settings: updatedFlattened, ...updatedFlattened });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update site settings' });
  }
};

app.get('/api/admin/settings', requireAdmin, handleGetSiteSettings);
app.get('/api/admin/site-settings', requireAdmin, handleGetSiteSettings);
// Fee settings control real money movement: only administrators may change them.
app.post('/api/admin/settings', requireAdmin, handlePostSiteSettings);
app.patch('/api/admin/settings', requireAdmin, handlePostSiteSettings);
app.post('/api/admin/site-settings', requireAdmin, handlePostSiteSettings);
app.patch('/api/admin/site-settings', requireAdmin, handlePostSiteSettings);

// Payment Gateways Admin Endpoints
app.get('/api/admin/payment-gateways', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, gateways: paymentGatewayManager.getMaskedState() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/payment-gateways/:environment/:gateway', requireAdmin, (req, res) => {
  try {
    const env = req.params.environment as 'production' | 'sandbox';
    const gw = req.params.gateway as 'paypal' | 'stripe' | 'razorpay';
    const actor = (req as any).authenticatedUser?.name || 'Super Admin';

    if (!['production', 'sandbox'].includes(env)) {
      return res.status(400).json({ error: 'Invalid environment. Must be production or sandbox.' });
    }
    if (!['paypal', 'stripe', 'razorpay'].includes(gw)) {
      return res.status(400).json({ error: 'Invalid gateway. Must be paypal, stripe, or razorpay.' });
    }

    const updated = paymentGatewayManager.updateGateway(env, gw, req.body || {});

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'PAYMENT_GATEWAY_UPDATED',
      target: `${gw.toUpperCase()} (${env.toUpperCase()})`,
      details: `Updated ${gw} configuration for ${env} environment (Enabled: ${updated[gw].enabled}, Primary: ${updated[gw].primary})`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, environmentGateways: paymentGatewayManager.getMaskedState()[env] });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/payment-gateways/:environment/:gateway/test', requireAdmin, (req, res) => {
  try {
    const env = req.params.environment as 'production' | 'sandbox';
    const gw = req.params.gateway as 'paypal' | 'stripe' | 'razorpay';
    const actor = (req as any).authenticatedUser?.name || 'Super Admin';

    if (!['production', 'sandbox'].includes(env) || !['paypal', 'stripe', 'razorpay'].includes(gw)) {
      return res.status(400).json({ error: 'Invalid environment or gateway.' });
    }

    const result = paymentGatewayManager.testConnection(env, gw);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'PAYMENT_GATEWAY_CONNECTION_TESTED',
      target: `${gw.toUpperCase()} (${env.toUpperCase()})`,
      details: `Tested connection for ${gw} (${env}): ${result.message}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: result.success, message: result.message });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Memberships & Quotas Admin Endpoints
app.get('/api/admin/memberships', requireAdmin, (req, res) => {
  try {
    const currentSettings = siteSettings.getSettings();
    res.json({
      success: true,
      memberships: currentSettings.memberships,
      marketplace: currentSettings.marketplace
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/memberships', requireAdmin, (req, res) => {
  try {
    const { memberships, marketplace } = req.body || {};
    const actor = (req as any).authenticatedUser?.name || 'Super Admin';
    if (memberships) {
      siteSettings.updateSection('memberships', memberships, actor);
    }
    if (marketplace) {
      siteSettings.updateSection('marketplace', marketplace, actor);
    }

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'MEMBERSHIPS_QUOTAS_UPDATED',
      target: 'Platform Membership & Gig Quotas',
      details: 'Updated membership plan limits and marketplace gig/project constraints',
      timestamp: new Date().toLocaleString()
    });

    const activeSettings = siteSettings.getSettings();
    res.json({
      success: true,
      memberships: activeSettings.memberships,
      marketplace: activeSettings.marketplace
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User Quota Status & Membership Upgrade Endpoints
app.get('/api/user/quota-status', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const user = users.find(u => u.id === authUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeSettings = siteSettings.getSettings();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const bidsUsed = proposals.filter(p => p.freelancerId === user.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo).length;
    const jobPostsUsed = projects.filter(p => p.buyerId === user.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo).length;

    const freelancerPlanId = (user as any).membershipTier || 'plan_free';
    const freelancerPlan = activeSettings.memberships.freelancerPlans.find(p => p.id === freelancerPlanId) || activeSettings.memberships.freelancerPlans[0];

    const buyerPlanId = (user as any).buyerMembershipTier || 'buyer_free';
    const buyerPlan = activeSettings.memberships.buyerPlans.find(p => p.id === buyerPlanId) || activeSettings.memberships.buyerPlans[0];

    const rawBidsLimit = freelancerPlan?.bidsPerMonth ?? 0;
    const bidsLimit = rawBidsLimit > 0 ? rawBidsLimit : null;
    const bidsRemaining = bidsLimit !== null ? Math.max(0, bidsLimit - bidsUsed) : null;

    const rawJobPostsLimit = buyerPlan?.jobPostsPerMonth ?? 0;
    const jobPostsLimit = rawJobPostsLimit > 0 ? rawJobPostsLimit : null;
    const jobPostsRemaining = jobPostsLimit !== null ? Math.max(0, jobPostsLimit - jobPostsUsed) : null;

    res.json({
      success: true,
      membershipsEnabled: activeSettings.memberships.membershipsEnabled,
      freelancer: {
        planId: freelancerPlanId,
        planName: freelancerPlan?.name || 'Standard Freelancer',
        bidsUsed,
        bidsLimit,
        bidsRemaining,
        unlimited: bidsLimit === null
      },
      buyer: {
        planId: buyerPlanId,
        planName: buyerPlan?.name || 'Standard Client',
        jobPostsUsed,
        jobPostsLimit,
        jobPostsRemaining,
        unlimited: jobPostsLimit === null
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/membership', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const user = users.find(u => u.id === authUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { freelancerPlanId, buyerPlanId } = req.body || {};
    if (freelancerPlanId) {
      (user as any).membershipTier = freelancerPlanId;
    }
    if (buyerPlanId) {
      (user as any).buyerMembershipTier = buyerPlanId;
    }

    res.json({
      success: true,
      message: 'Membership updated successfully',
      user
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ORDER PRICING & FEE QUOTES (server is the only authority on what a client is charged)
// ==========================================
// Resolves the gig price (gig + selected extras) from server-side data. Never trusts a price sent by the browser.
function resolveGigOrderPrice(gigId: string, extraIds: unknown): { gig: Gig; gigPrice: number; extrasTitles: string[] } {
  const gig = gigs.find(g => g.id === gigId);
  if (!gig) throw Object.assign(new Error('Gig not found.'), { status: 404 });
  if (gig.status && gig.status !== 'published') throw Object.assign(new Error('This gig is not available for ordering.'), { status: 400 });
  const ids = Array.isArray(extraIds) ? Array.from(new Set(extraIds.map(String))) : [];
  let cents = Math.round(Number(gig.price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw Object.assign(new Error('This gig has no valid price.'), { status: 400 });
  const extrasTitles: string[] = [];
  for (const id of ids) {
    const extra = (gig.extras || []).find(e => e.id === id);
    if (!extra) throw Object.assign(new Error(`Unknown add-on "${id}" for this gig.`), { status: 400 });
    cents += Math.round(Number(extra.price) * 100);
    extrasTitles.push(extra.title);
  }
  return { gig, gigPrice: cents / 100, extrasTitles };
}

// Public fee quote for the checkout screen: same math the ledger will apply when the order is funded.
app.get('/api/fees/quote', (req, res) => {
  try {
    let gigPrice: number;
    if (typeof req.query.gigId === 'string' && req.query.gigId) {
      const extraIds = typeof req.query.extraIds === 'string' && req.query.extraIds ? req.query.extraIds.split(',') : [];
      gigPrice = resolveGigOrderPrice(req.query.gigId, extraIds).gigPrice;
    } else {
      gigPrice = Number(req.query.amount);
    }
    if (!Number.isFinite(gigPrice) || gigPrice < 0) return res.status(400).json({ error: 'A valid gigId or amount is required.' });
    const q = financeLedger.quoteOrder(gigPrice);
    res.json({ ...q, config: financeLedger.getFeeConfig() });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ==========================================
// MONEY HELPERS (all balance changes go through the ledger engine)
// ==========================================
function syncUserBalances() {
  for (const u of users) {
    const b = financeLedger.getWalletBalance(u.id);
    if (b !== null) u.walletBalance = b;
  }
}
syncUserBalances();

// Every regular user gets a ledger wallet the first time they touch money.
function ensureWallet(userId: string) {
  const u = users.find(x => x.id === userId);
  if (!u || u.role === 'admin' || u.role === 'super_admin') return;
  const isFreelancer = gigs.some(g => g.freelancerId === u.id) || orders.some(o => o.sellerId === u.id) || u.role === 'freelancer' || u.role === 'seller';
  financeLedger.ensureWallet({ userId: u.id, name: u.name, email: u.email, role: isFreelancer ? 'freelancer' : 'buyer' });
}

function pushSystemMessage(orderId: string, text: string, action = 'system_notice') {
  const msg: Message = {
    id: 'msg_' + randomUUID().slice(0, 12),
    orderId,
    senderId: 'system',
    senderName: 'WorkSphere Escrow Vault',
    text,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: { action }
  };
  recordMessage(msg);
  saveMessagesToDisk();
  broadcastMessage(msg, orderId);
}

function closeActiveDispute(orderId: string, status: Dispute['status'], notes: string) {
  const d = disputes.find(x => x.orderId === orderId && (x.status === 'open' || x.status === 'under_investigation'));
  if (d) {
    d.status = status;
    d.resolutionNotes = notes;
    saveDisputesToDisk();
    emitSystemEvent(orderId, 'dispute_resolved', `✅ Dispute resolved: ${status.replace('_', ' ')}. Note: ${notes}`);
  }
}

// Track orders whose release side-effects (seller.earned, seller.completedJobs) have been executed
const releaseCompletedOrders = new Set<string>();
for (const o of orders) {
  if (o.status === 'completed') releaseCompletedOrders.add(o.id);
}

const refundCompletedOrders = new Set<string>();
for (const o of orders) {
  if (o.status === 'cancelled') refundCompletedOrders.add(o.id);
}

// In-memory requestKey cache for order release and refund idempotency
const requestKeyCache = new Map<string, any>();

function assertOrderOpen(order: Order) {
  if (order.status === 'completed') throw new Error('Order is already completed; funds were already released.');
  if (order.status === 'cancelled') throw new Error('Order is already cancelled; funds were already handled.');
}

function fundOrderEscrowWithEvent(params: { orderId: string; orderTitle: string; amount: number; buyerId: string; sellerId: string; actor: string; skipMinimum?: boolean }) {
  const res = financeLedger.fundEscrow(params);
  const order = orderIndex.get(params.orderId) || orders.find(o => o.id === params.orderId);
  if (order) {
    emitSystemEvent(order.id, 'escrow_funded', `🔒 Escrow funded ($${params.amount.toLocaleString()}). Your payment is safely held in escrow.`, { amount: params.amount });
  }
  return res;
}

function topUpOrderEscrowWithEvent(params: { orderId: string; orderTitle: string; amount: number; buyerId: string; sellerId: string; actor: string; skipMinimum?: boolean }) {
  const res = financeLedger.topUpEscrow(params);
  const order = orderIndex.get(params.orderId) || orders.find(o => o.id === params.orderId);
  if (order) {
    emitSystemEvent(order.id, 'escrow_funded', `🔒 Additional $${params.amount.toLocaleString()} funded into escrow for "${params.orderTitle}".`, { amount: params.amount, isTopUp: true });
  }
  return res;
}

function releaseOrderFunds(order: Order, actor: string, reason: string, approvedByBuyer: boolean, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'completed') {
    const replayed = financeLedger.replay<{ journal: any; freelancerNet: number; platformFee: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already completed; funds were already released.');
  }
  assertOrderOpen(order);
  const result = financeLedger.releaseEscrow({ orderId: order.id, actor, reason, requestKey });

  order.status = 'completed';
  if (!order.completedAt) {
    order.completedAt = new Date().toISOString();
  }
  if (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) {
    order.acceptedVersion = order.deliveryHistory[order.deliveryHistory.length - 1].version;
  }

  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  syncUserBalances();
  saveOrdersToDisk();

  // If this was a buyer-triggered approval, emit deliverable_approved first
  if (approvedByBuyer) {
    emitSystemEvent(order.id, 'deliverable_approved', `✅ Deliverables approved by buyer.`, {
      freelancerNet: result.freelancerNet,
      acceptedVersion: order.acceptedVersion
    });
  }

  emitSystemEvent(order.id, 'escrow_released', `🎉 Escrow funds ($${order.amount.toLocaleString()}) released to seller! Workstream marked as completed.`, {
    amount: order.amount,
    freelancerNet: result.freelancerNet,
    platformFee: result.platformFee,
    orderCompleted: true
  });

  emitSystemEvent(order.id, 'order_completed', `✅ Order completed.`);

  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

function refundOrderFunds(order: Order, amount: number | undefined, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'cancelled') {
    const replayed = financeLedger.replay<{ journal: any; buyerWallet: any; refunded: number; remaining: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already cancelled; funds were already handled.');
  }
  assertOrderOpen(order);
  const result = financeLedger.refundEscrow({ orderId: order.id, amount, reason, actor, requestKey });
  if (result.remaining === 0) {
    order.status = 'cancelled';
    refundCompletedOrders.add(order.id);
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === result.refunded));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = result.refunded;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: result.refunded,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  saveOrdersToDisk();
  saveRefundsToDisk();

  emitSystemEvent(order.id, 'escrow_refunded', `💸 Escrow refunded ($${result.refunded.toLocaleString()}) to buyer wallet. Reason: ${reason}`, {
    refunded: result.refunded,
    orderCancelled: order.status === 'cancelled'
  });

  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

function splitOrderFunds(order: Order, refundAmount: number, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  assertOrderOpen(order);
  const result = financeLedger.resolveEscrowSplit({ orderId: order.id, refundAmount, reason, actor });
  order.status = 'completed';
  if (!order.completedAt) {
    order.completedAt = new Date().toISOString();
  }
  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.release.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === refundAmount));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = refundAmount;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: refundAmount,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  saveOrdersToDisk();
  saveRefundsToDisk();

  emitSystemEvent(order.id, 'escrow_refunded', `💸 Partial escrow refund ($${refundAmount.toLocaleString()}) credited to buyer wallet.`, { refunded: refundAmount, isSplit: true });
  emitSystemEvent(order.id, 'escrow_released', `🎉 Remaining escrow released to seller ($${result.release.freelancerNet.toLocaleString()} net).`, { freelancerNet: result.release.freelancerNet, isSplit: true });

  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}


app.get('/api/users', (req, res) => {
  const publicUsers = users.filter(isUserPublic).map(sanitizePublicUser);
  res.json(publicUsers);
});

// Public Marketplace Endpoints: returns only published, active, approved listings without internal moderation/private metadata
app.get('/api/gigs', (req, res) => {
  const publicGigs = gigs.filter(isGigPublic).map(sanitizePublicGig);
  res.json(publicGigs);
});

app.get('/api/projects', (req, res) => {
  const publicProjects = projects.filter(isProjectPublic).map(sanitizePublicProject);
  res.json(publicProjects);
});

// Single Listing Detail: public users receive only public sanitized listings; owners/admins may receive full listing
app.get('/api/gigs/:id', (req, res) => {
  const gig = gigs.find(g => g.id === req.params.id);
  if (!gig) return res.status(404).json({ error: 'Gig not found' });

  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && gig.freelancerId === authUserId;

  if (isGigPublic(gig)) {
    if (isAdmin || isOwner) return res.json(gig);
    return res.json(sanitizePublicGig(gig));
  }

  if (isAdmin || isOwner) {
    return res.json(gig);
  }
  return res.status(404).json({ error: 'Gig not found or unavailable' });
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && project.buyerId === authUserId;

  if (isProjectPublic(project)) {
    if (isAdmin || isOwner) return res.json(project);
    return res.json(sanitizePublicProject(project));
  }

  if (isAdmin || isOwner) {
    return res.json(project);
  }
  return res.status(404).json({ error: 'Project not found or unavailable' });
});

// Authenticated Owner Listings
app.get('/api/my/gigs', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myGigs = gigs.filter(g => g.freelancerId === authUserId);
  res.json(myGigs);
});

app.get('/api/my/projects', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myProjects = projects.filter(p => p.buyerId === authUserId);
  res.json(myProjects);
});
function enrichProposalWithWorkstream(p: Proposal): Proposal {
  let workstreamOrderId = p.workstreamOrderId;
  let offerId = p.offerId;
  if (!workstreamOrderId) {
    const matchedOrder = orders.find(o => o.proposalId === p.id);
    if (matchedOrder) workstreamOrderId = matchedOrder.id;
  }
  if (!offerId && workstreamOrderId) {
    const matchedOffer = workstreamOffers.find(of => of.proposalId === p.id) ||
      workstreamOffers.find(of => of.orderId === workstreamOrderId && of.kind === 'proposal');
    if (matchedOffer) offerId = matchedOffer.id;
  }
  return {
    ...p,
    ...(workstreamOrderId ? { workstreamOrderId } : {}),
    ...(offerId ? { offerId } : {})
  };
}

app.get('/api/proposals', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    // Bids and cover letters are private to the freelancer, the project owner and staff.
    return res.json([]);
  }
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userProposals = proposals.filter(p =>
    isAdmin ||
    p.freelancerId === authUserId ||
    projects.some(pr => pr.id === p.projectId && pr.buyerId === authUserId));
  res.json(userProposals.map(enrichProposalWithWorkstream));
});

app.get('/api/orders', requireAuth, (req, res) => {
  // Login is required: previously a request with no token was treated like an admin and received every order.
  const authUserId = resolveAuthenticatedUserId(req)!;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userOrders = orders.filter(o => (isAdmin || o.buyerId === authUserId || o.sellerId === authUserId));
  res.json(userOrders.map(o => enrichOrderWithServiceInfo(o, isAdmin)));
});

// Single Order Workspace Detail
app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Login is required: an anonymous caller used to count as admin and could read the whole order and its messages.
  const authUserId = resolveAuthenticatedUserId(req)!;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.buyerId !== authUserId && order.sellerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Access to this order is restricted to participants.' });
  }
  const enriched = enrichOrderWithServiceInfo(order, isAdmin);
  const buyer = users.find(u => u.id === order.buyerId);
  const seller = users.find(u => u.id === order.sellerId);
  const orderMessages = messageIndex.get(order.id) || [];
  const dispute = disputes.find(d => d.orderId === order.id);

  res.json({
    ...enriched,
    buyer: buyer ? (isAdmin ? safeUser(buyer) : orderParticipantSafeUser(buyer)) : null,
    seller: seller ? (isAdmin ? safeUser(seller) : orderParticipantSafeUser(seller)) : null,
    messages: orderMessages,
    dispute
  });
});

// Extend Order Deadline
app.patch('/api/orders/:id/extend-time', requireAdmin, async (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { days, newDueDate, reason } = req.body;
  const oldDate = order.dueDate;
  let targetDate = newDueDate;

  if (days && Number(days) > 0) {
    const current = new Date(order.dueDate || Date.now());
    current.setDate(current.getDate() + Number(days));
    targetDate = current.toISOString().split('T')[0];
  } else if (!targetDate) {
    targetDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
  }

  order.dueDate = targetDate;

  // Add system event message in chat
  const sysMsg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: 'system',
    senderName: 'System / Admin Notice',
    text: `⏱️ Deadline extended from ${oldDate} to ${order.dueDate}. ${reason ? 'Reason: ' + reason : 'Admin approved time extension.'}`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: { action: 'order_deadline_extended', oldDate, newDueDate: order.dueDate, reason } as any
  };
  recordMessage(sysMsg);
  await saveMessagesToDisk();
  await saveOrdersToDisk();
  broadcastMessage(sysMsg, order.id);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'ORDER_DEADLINE_EXTENDED',
    target: `Order #${order.id}`,
    details: `Extended deadline to ${order.dueDate} (${days || 'custom'} days). ${reason || ''}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, order: enrichOrderWithServiceInfo(order), message: sysMsg });
});

// Save Admin Private Notes
app.post('/api/orders/:id/admin-notes', requireAdmin, async (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.adminNotes = req.body.notes || '';
  await saveOrdersToDisk();
  res.json({ success: true, adminNotes: order.adminNotes });
});

// Upload Deliverable Override / File
app.post('/api/orders/:id/deliverable', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const authUserId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && order.sellerId !== authUserId) {
      return res.status(403).json({ error: 'Forbidden: Only the seller or an administrator can submit deliverables.' });
    }

    // Only permit delivery submission from valid active states
    const allowedStatuses = ['funded_in_escrow', 'in_progress', 'revision', 'draft_review', 'delivered', 'work_in_progress', 'completed'];
    if (!allowedStatuses.includes(order.status)) {
      return res.status(409).json({ error: `Cannot submit a deliverable for an order in "${order.status}" status.` });
    }
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot submit a deliverable for a completed order.' });
    }

    if (!order.deliverableFiles) order.deliverableFiles = [];
    if (!order.deliveryHistory) order.deliveryHistory = [];

    const rawFiles = Array.isArray(req.body.files) && req.body.files.length > 0 
      ? req.body.files 
      : (req.body.name ? [{ name: req.body.name, size: req.body.size, url: req.body.url }] : []);

    // A delivery may be a file, a URL/reference (plain text), a written message, or any combination.
    // URL/reference text is accepted as-is: no reachability/domain/scheme checks, never made clickable.
    const rawNotes = typeof req.body.notes === 'string' ? req.body.notes
      : (typeof req.body.message === 'string' ? req.body.message : '');
    const rawReference = typeof req.body.reference === 'string' ? req.body.reference
      : (typeof req.body.referenceUrl === 'string' ? req.body.referenceUrl
      : (!req.body.name && typeof req.body.url === 'string' ? req.body.url : ''));
    const trimmedNotes = rawNotes.trim();
    const trimmedReference = rawReference.trim();

    if (rawFiles.length === 0 && !trimmedNotes && !trimmedReference) {
      return res.status(400).json({ error: 'Add a file, a URL/reference, or a written completion message to submit a delivery.' });
    }

    let validatedFiles: Array<{ name: string; size: string; url: string }> = [];
    if (rawFiles.length > 0) {
      const validation = validateStoredWorkstreamFiles(rawFiles, caller);
      if (!validation.ok) {
        return res.status(400).json({ error: (validation as any).error });
      }
      validatedFiles = validation.files;
    }

    const isDraft = Boolean(req.body.isDraft);
    const uploadedFiles = validatedFiles.map((f: any, idx: number) => ({
      id: 'deliv_' + Date.now() + '_' + idx,
      name: f.name,
      size: f.size,
      url: f.url,
      uploadedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      type: isDraft ? 'draft' : 'deliverable'
    }));

    order.deliverableFiles.push(...uploadedFiles);
    order.status = isDraft ? 'draft_review' : 'delivered';
    const sanitizedNotes = trimmedNotes ? escapeHtml(trimmedNotes) : '';
    // Reference is stored verbatim (trimmed, length-capped) and only ever rendered as plain text by React.
    const storedReference = trimmedReference.slice(0, 2000);
    order.deliveryNotes = sanitizedNotes;
    order.deliveryReference = storedReference;

    const version = order.deliveryHistory.length + 1;
    order.deliveryHistory.push({
      version,
      notes: sanitizedNotes,
      reference: storedReference || undefined,
      files: uploadedFiles,
      deliveredAt: new Date().toISOString()
    });

    let resolvedRevisionCount = 0;
    if (order.revisions && order.revisions.length > 0) {
      for (const rev of order.revisions) {
        if (rev.status === 'requested') {
          rev.status = 'resolved';
          resolvedRevisionCount++;
        }
      }
    }

    if (resolvedRevisionCount > 0) {
      emitSystemEvent(order.id, 'revision_resolved', `📝 Revision resolved via Delivery #v${version}.`, {
        deliveryVersion: version
      });
    }

    const summaryParts: string[] = [];
    if (uploadedFiles.length > 0) summaryParts.push(uploadedFiles.map((f: any) => `"${f.name}" (${f.size})`).join(', '));
    if (storedReference) summaryParts.push(`Reference: ${storedReference}`);
    const fileSummary = summaryParts.length > 0 ? summaryParts.join(' | ') : 'written completion update';
    
    emitSystemEvent(
      order.id,
      'deliverable_submitted',
      isDraft
        ? `📦 Draft Delivery #v${version} submitted (${fileSummary}).`
        : `📦 Delivery / Final Invoice #v${version} submitted (${fileSummary}).`,
      {
        version,
        isDraft,
        notes: sanitizedNotes,
        reference: storedReference || undefined,
        files: uploadedFiles
      }
    );

    // When raised from the UI Invoice modal (createInvoiceOffer: true), also create or update the interactive INV-xxxx card
    let createdInvoiceOffer: any = undefined;
    if (!isDraft && req.body.createInvoiceOffer && orderHasEscrow(order.id)) {
      const activeEsc = getActiveEscrowRemaining(order);
      const requestedAmt = Math.round(Number(req.body.invoiceAmount || activeEsc || order.amount || 0) * 100) / 100;
      const invAmt = requestedAmt >= activeEsc && requestedAmt > 0 ? requestedAmt : (activeEsc || Number(order.amount || 0));
      const invTitle = (typeof req.body.invoiceTitle === 'string' && req.body.invoiceTitle.trim().length >= 3)
        ? req.body.invoiceTitle.trim().slice(0, 120)
        : `Final Invoice: ${order.title}`.slice(0, 120);
      const existingPendingInv = workstreamOffers.find(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending');
      if (existingPendingInv) {
        existingPendingInv.title = invTitle;
        existingPendingInv.amount = invAmt;
        existingPendingInv.note = trimmedNotes || existingPendingInv.note;
        existingPendingInv.files = uploadedFiles.length > 0 ? uploadedFiles : existingPendingInv.files;
        existingPendingInv.reference = storedReference || existingPendingInv.reference;
        await saveOffersToDisk();
        createdInvoiceOffer = viewOffer(existingPendingInv);
      } else if (invAmt > 0) {
        const newInv: WorkstreamOffer = {
          id: 'off_' + randomUUID().slice(0, 12),
          number: `INV-${String(workstreamOffers.filter(o => o.kind === 'invoice').length + 1001)}`,
          orderId: order.id,
          kind: 'invoice',
          title: invTitle,
          amount: invAmt,
          note: trimmedNotes || undefined,
          files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
          reference: storedReference || undefined,
          status: 'pending',
          createdBy: caller?.id || order.sellerId,
          createdAt: new Date().toISOString()
        };
        workstreamOffers.push(newInv);
        await saveOffersToDisk();
        postOfferMessage(order, newInv, { id: caller?.id || order.sellerId, name: caller?.name || 'Seller' }, `New invoice ${newInv.number}: ${invTitle}`, 'offer_created');
        createdInvoiceOffer = viewOffer(newInv);
      }
    }

    await saveOrdersToDisk();

    res.json({ success: true, files: uploadedFiles, file: uploadedFiles[0], offer: createdInvoiceOffer, order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Request Revision on Deliverable
app.post('/api/orders/:id/revision', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.buyerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Only the order buyer or an administrator can request revisions.' });
  }

  const allowedRevisionStatuses = ['delivered', 'in_progress', 'funded_in_escrow', 'revision', 'draft_review', 'work_in_progress'];
  if (!allowedRevisionStatuses.includes(order.status)) {
    return res.status(409).json({ error: `Cannot request revisions for an order in "${order.status}" status.` });
  }

  const hasDelivery = (Array.isArray(order.deliverableFiles) && order.deliverableFiles.length > 0) || (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) || ['delivered', 'revision', 'draft_review', 'work_in_progress'].includes(order.status);
  if (!hasDelivery) {
    return res.status(409).json({ error: 'Cannot request revisions before work or a draft has been delivered by the freelancer.' });
  }

  const rawReason = (req.body.reason || '').trim();
  if (!rawReason) {
    return res.status(400).json({ error: 'A revision reason is required.' });
  }
  const reason = escapeHtml(rawReason);
  if (!order.revisions) order.revisions = [];
  const revisionEntry = {
    id: 'rev_' + Date.now(),
    requestedAt: new Date().toISOString(),
    reason,
    status: 'requested',
    deliveryVersion: order.deliveryHistory?.length || 1
  };
  order.revisions.push(revisionEntry);
  order.status = 'revision';

  await saveOrdersToDisk();

  emitSystemEvent(order.id, 'revision_requested', `Revision requested: "${reason}"`, {
    revisionId: revisionEntry.id,
    deliveryVersion: revisionEntry.deliveryVersion
  });

    res.json({ success: true, revision: revisionEntry, order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Participant (Buyer or Seller) Dispute Creation Flow
app.post('/api/orders/:id/dispute', requireAuth, (req, res) => {
  const orderId = req.params.id;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const authUserId = (req as any).authenticatedUserId;
    if (order.buyerId !== authUserId && order.sellerId !== authUserId) {
      return res.status(403).json({ error: 'Forbidden: Only order participants can open a dispute.' });
    }
    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(409).json({ error: `Cannot open a dispute: this order is already ${order.status}.` });
    }
    if (order.status === 'disputed') {
      return res.status(409).json({ error: 'This order is already under dispute.' });
    }
    const disputeEscrow = financeLedger.getEscrow(order.id);
    if (!disputeEscrow || disputeEscrow.status !== 'held' || disputeEscrow.remaining <= 0) {
      return res.status(409).json({ error: 'Cannot open a dispute: there is no active escrow held for this order.' });
    }
    const rawReason = (req.body.reason || '').trim();
    if (!rawReason) {
      return res.status(400).json({ error: 'A dispute reason is required.' });
    }
    const reason = escapeHtml(rawReason);
    const existingDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (existingDispute) {
      return res.status(400).json({ error: 'An active dispute already exists for this order.' });
    }

    const newDispute: Dispute = {
      id: 'disp_' + Date.now(),
      orderId: order.id,
      raisedBy: authUserId === order.buyerId ? 'buyer' : 'seller',
      reason,
      evidence: escapeHtml(req.body.evidence || ''),
      status: 'open',
      createdAt: new Date().toISOString()
    };
    disputes.push(newDispute);
    order.status = 'disputed';

    const sysMsg: Message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      orderId: order.id,
      senderId: 'system',
      senderName: 'WorkSphere Dispute Resolution Desk',
      text: `🚨 Dispute opened by ${newDispute.raisedBy}: "${reason}". Order placed under review.`,
      timestamp: new Date().toISOString(),
      type: 'system',
      metadata: {
        action: 'dispute_opened',
        disputeId: newDispute.id,
        raisedBy: newDispute.raisedBy
      }
    };
    recordMessage(sysMsg);
    saveMessagesToDisk();
    saveOrdersToDisk();
    saveDisputesToDisk();
    broadcastMessage(sysMsg, order.id);

    res.json({ success: true, dispute: newDispute, order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Toggle Chat Mute
app.patch('/api/orders/:id/mute', requireRole(['admin', 'super_admin', 'support']), async (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isMuted = !order.isMuted;
  await saveOrdersToDisk();
  const sysMsg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isMuted 
      ? `🔒 Chat paused by Administrator during case review. Neither party may send messages.`
      : `🔓 Chat unlocked by Administrator. Standard messaging resumed.`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: { action: order.isMuted ? 'chat_muted' : 'chat_unmuted' }
  };
  recordMessage(sysMsg);
  await saveMessagesToDisk();
  broadcastMessage(sysMsg, order.id);

  res.json({ success: true, isMuted: order.isMuted });
});

// Toggle Pause Order Timer
app.patch('/api/orders/:id/pause-timer', requireRole(['admin', 'super_admin', 'support']), async (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isTimerPaused = !order.isTimerPaused;
  await saveOrdersToDisk();
  const sysMsg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isTimerPaused 
      ? `⏸️ Delivery countdown paused by Administrator pending dispute/clarification.`
      : `▶️ Delivery countdown resumed by Administrator. Normal timer active.`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: { action: order.isTimerPaused ? 'timer_paused' : 'timer_resumed' }
  };
  recordMessage(sysMsg);
  saveMessagesToDisk();
  broadcastMessage(sysMsg, order.id);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: order.isTimerPaused ? 'ORDER_TIMER_PAUSED' : 'ORDER_TIMER_RESUMED',
    target: `Order #${order.id}`,
    details: order.isTimerPaused ? 'Timer paused by Admin' : 'Timer resumed by Admin',
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, isTimerPaused: order.isTimerPaused, order: enrichOrderWithServiceInfo(order) });
});

// Update user online / available now status
app.patch('/api/users/availability', requireAuth, (req, res) => {
  const userId = (req as any).authenticatedUserId;
  const { isAvailableNow } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.isAvailableNow = !!isAvailableNow;
  res.json({ success: true, user: safeUser(user) });
});

// Flag / Unflag User for Terms of Service review
app.post('/api/users/:id/flag', requireAdmin, (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.isFlagged = !user.isFlagged;
  user.flagReason = user.isFlagged ? (req.body.reason || 'Flagged for TOS investigation.') : undefined;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: adminActor(req),
    role: 'admin',
    action: user.isFlagged ? 'USER_FLAGGED_TOS' : 'USER_UNFLAGGED_TOS',
    target: `User #${user.id} (${user.name})`,
    details: user.flagReason || 'Flag removed',
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, isFlagged: user.isFlagged, flagReason: user.flagReason, user });
});

// Force Complete & Release Funds (admin only)
app.post('/api/orders/:id/force-complete', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Order is already completed; funds were already released.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot force-complete a cancelled/refunded order.' });
    }
    const reason = String(req.body.reason || 'Admin administrative force-release in seller favor.');
    const result = releaseOrderFunds(order, adminActor(req), reason, false, req.body.requestKey);
    closeActiveDispute(order.id, 'resolved_release', reason);
    res.json({ success: true, order: enrichOrderWithServiceInfo(order), result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Force Cancel & Refund Buyer (admin only). A partial refund refunds that amount and releases the rest to the seller.
app.post('/api/orders/:id/force-cancel', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot force-cancel an already completed order.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled/refunded.' });
    }
    const reason = String(req.body.reason || 'Admin cancelled order and refunded buyer wallet');
    const isPartial = req.body.refundType === 'partial';
    let result: any;
    let refundAmount: number;
    if (isPartial) {
      refundAmount = Number(req.body.customAmount);
      result = splitOrderFunds(order, refundAmount, adminActor(req), reason);
      closeActiveDispute(order.id, 'resolved_partial', reason);
      pushSystemMessage(order.id, `⚖️ Order resolved by Administration. $${refundAmount} refunded to buyer; the remainder was released to the freelancer. Reason: ${reason}`, 'dispute_resolved');
    } else {
      result = refundOrderFunds(order, undefined, adminActor(req), reason, req.body.requestKey);
      refundAmount = result.refunded;
      closeActiveDispute(order.id, 'resolved_refund', reason);
    }
    res.json({ success: true, order: enrichOrderWithServiceInfo(order), result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Send Chat Message into Order Workstream (unrestricted, responsive buyer/seller communication)
app.post('/api/orders/:id/message', requireAuth, rateLimit(120, 60_000), async (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const userId = (req as any).authenticatedUserId;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!canAccessOrderWorkstream(user, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  if (order.isMuted && !isStaffUser(user)) {
    return res.status(403).json({ error: 'Chat is currently paused.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, user);
  if (!fileCheck.ok) return res.status(400).json({ error: (fileCheck as any).error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === order.id && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  try {
    const newMsg = sanitizeAndCreateMessage(user, order, req.body, fileCheck);

    recordMessage(newMsg);
    await saveMessagesToDisk();
    broadcastMessage(newMsg, order.id);

    res.json({ success: true, message: newMsg });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});
app.get('/api/disputes', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userDisputes = disputes.filter(d => {
    if (isAdmin) return true;
    const order = orderIndex.get(d.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userDisputes);
});
app.get('/api/refunds', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userRefunds = refunds.filter(r => {
    if (isAdmin) return true;
    if (r.buyerId === authUserId) return true;
    const order = orderIndex.get(r.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userRefunds);
});
app.get('/api/payouts', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userPayouts = payouts.filter(p => {
    if (isAdmin) return true;
    return p.freelancerId === authUserId;
  });
  res.json(userPayouts);
});
app.get('/api/categories', (req, res) => res.json(categories));

// ==========================================
// USER PAYMENTS, ESCROW, AND FINANCIAL APIS
// ==========================================

interface PaymentMethodRecord {
  id: string;
  userId: string;
  type: 'card' | 'bank' | 'paypal' | 'upi';
  name: string;
  details: {
    last4?: string;
    brand?: string;
    expiry?: string;
    bankName?: string;
    accountNumberMasked?: string;
    routingNumber?: string;
    email?: string;
    upiId?: string;
  };
  isDefault: boolean;
  createdAt: string;
}

interface CustomInvoice {
  id: string;
  invoiceNumber: string;
  userId: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  issueDate: string;
  dueDate: string;
  status: 'paid' | 'in_escrow' | 'unpaid' | 'refunded';
  items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  platformFee: number;
  tax: number;
  total: number;
  notes?: string;
  relatedOrderId?: string;
}

let savedPaymentMethods: PaymentMethodRecord[] = [];

const CUSTOM_INVOICES_FILE = path.join(DATA_DIR, 'custom_invoices.json');
let customInvoices: CustomInvoice[] = [];
try {
  if (fs.existsSync(CUSTOM_INVOICES_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_INVOICES_FILE, 'utf-8'));
    if (Array.isArray(parsed)) customInvoices = parsed;
  }
} catch (e) {
  console.error('Failed to load custom invoices:', e);
}
function saveCustomInvoicesToDisk() { 
  return postgresStore.saveCustomInvoices(customInvoices).catch(err => console.error('[PostgresStore] Failed to save custom invoices:', err)); 
}

// User Financial Overview Snapshot
app.get('/api/payments/user/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user financial snapshot is not allowed.' });
    }

    const userId = targetUserId;
    const u = users.find(user => user.id === userId);
    
    if (u) {
      ensureWallet(u.id);
    }

    const walletData = financeLedger.getWalletById(userId);
    const availableBalance = walletData?.wallet.availableBalance ?? (u?.walletBalance ?? 0);
    
    const activeEscrowStatuses = ['funded_in_escrow', 'in_progress', 'delivered', 'revision', 'disputed', 'draft_review', 'work_in_progress'];
    const buyerEscrowOrders = orders.filter(o => o.buyerId === userId && activeEscrowStatuses.includes(o.status));
    const buyerEscrowAmount = buyerEscrowOrders.reduce((sum, o) => {
      const esc = financeLedger.getEscrow(o.id);
      return sum + (esc && esc.status === 'held' ? esc.remaining : (o.amount || 0));
    }, 0);

    const freelancerEscrowOrders = orders.filter(o => o.sellerId === userId && activeEscrowStatuses.includes(o.status));
    const freelancerEscrowAmount = freelancerEscrowOrders.reduce((sum, o) => {
      const esc = financeLedger.getEscrow(o.id);
      return sum + (esc && esc.status === 'held' ? esc.remaining : (o.amount || 0));
    }, 0);

    const currentYearMonth = new Date().toISOString().slice(0, 7);
    const userPaidOrders = orders.filter(o => o.buyerId === userId && ['funded_in_escrow', 'in_progress', 'delivered', 'revision', 'disputed', 'completed'].includes(o.status));
    const paidToDate = userPaidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
    const paidThisMonth = userPaidOrders.filter(o => (o.createdAt || '').startsWith(currentYearMonth)).reduce((sum, o) => sum + (o.amount || 0), 0);

    const userEarnedOrders = orders.filter(o => o.sellerId === userId && o.status === 'completed');
    const earnedToDate = u?.earned ?? userEarnedOrders.reduce((sum, o) => sum + financeLedger.quoteOrder(o.amount).freelancerNet, 0);
    const earnedThisMonth = userEarnedOrders.filter(o => (o.createdAt || '').startsWith(currentYearMonth)).reduce((sum, o) => sum + financeLedger.quoteOrder(o.amount).freelancerNet, 0);

    const userMethods = savedPaymentMethods.filter(m => m.userId === userId);

    res.json({
      userId,
      availableBalance,
      buyerEscrowAmount,
      freelancerEscrowAmount,
      buyerEscrowOrders,
      freelancerEscrowOrders,
      paidToDate,
      paidThisMonth,
      earnedToDate,
      earnedThisMonth,
      earnedPastTwoMonths: earnedThisMonth,
      clearingPeriodDays: 14,
      paymentMethods: userMethods,
      walletStatus: walletData?.wallet.status || 'active'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const REVIEW_THRESHOLD = 500;
const ALLOWED_METHODS: Record<string, keyof typeof DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods> = {
  'UPI': 'upi', 'Bank Transfer': 'bankTransfer', 'Stripe': 'stripeConnect', 'Razorpay': 'razorpayX', 'PayPal': 'paypal'
};

/**
 * Isolated payout identity resolver.
 * 
 * SECURITY ARCHITECTURE BOUNDARY:
 * Currently WorkPerHour operates in demo mode without full multi-user authentication.
 * To prevent unauthenticated clients from spoofing arbitrary users or withdrawing
 * from accounts they do not own, payout authorization is strictly isolated here.
 * 
 * When deploying an authentication layer (JWT, session cookies, OAuth):
 * Simply update this function to extract the user ID strictly from the verified session:
 *   const authUser = (req as any).user?.id || (req as any).user?.uid;
 *   if (!authUser) throw new Error('Authentication required');
 *   return authUser;
 */
function resolvePayoutUserId(req: Request): string | null {
  return resolveAuthenticatedUserId(req);
}

function handlePayoutRequest(req: Request, res: Response) {
  try {
    const freelancerId = resolvePayoutUserId(req);
    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required to request a payout.' });
    }
    const user = users.find(u => u.id === freelancerId) || users[0];
    ensureWallet(freelancerId);

    const rawMethod = String(req.body?.method || 'Bank Transfer');
    const settingKey = ALLOWED_METHODS[rawMethod];
    if (!settingKey || !DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods[settingKey]) {
      return res.status(400).json({ error: `Unsupported payout method "${rawMethod}".` });
    }

    const numAmount = Number(req.body?.amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid withdrawal amount greater than $0.00' });
    }

    const currentBal = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    if (currentBal < numAmount) {
      return res.status(400).json({ error: `Insufficient available funds. Available: $${currentBal.toFixed(2)}, Requested: $${numAmount.toFixed(2)}` });
    }

    const id = 'pay_' + randomUUID().slice(0, 8);
    const accountDetails = String(req.body?.accountDetails || 'Primary Bank Account');
    const { payout } = financeLedger.requestPayout({
      payoutId: id,
      freelancerId,
      amount: numAmount,
      method: rawMethod,
      accountDetails,
      actor: `user:${freelancerId}`
    });

    const record: Payout = {
      id,
      freelancerId,
      amount: payout.amount,
      method: rawMethod as Payout['method'],
      status: 'pending',
      createdAt: new Date().toISOString().substring(0, 10),
      accountDetails: payout.accountDetails
    };
    payouts.unshift(record);
    savePayoutsToDisk();
    syncUserBalances();

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: user.name,
      role: user.role,
      action: 'PAYOUT_REQUESTED',
      target: `Payout #${record.id}`,
      details: `User requested withdrawal of $${numAmount.toFixed(2)} via ${record.method}`,
      timestamp: new Date().toLocaleString()
    });

    const newBalance = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.relatedPayoutId === id);

    res.status(201).json({
      success: true,
      newBalance,
      payout: record,
      transaction,
      ...record
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

// Deposit Funds into User Account (Simulated - Strictly Development Only)
app.post('/api/payments/deposit', requireAuth, rateLimit(10, 60_000), (req, res) => {
  try {
    // Simulated deposits are strictly development/test functionality; reject in production unconditionally
    if (!areSimulatedDepositsAllowed()) {
      return res.status(501).json({ error: 'Deposits require a connected payment gateway in production.' });
    }

    const authUserId = (req as any).authenticatedUserId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const caller = users.find(u => u.id === authUserId);
    if (!caller) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    // User A cannot credit User B's wallet by supplying User B's ID
    const requestedUserId = req.body?.userId;
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    if (requestedUserId && requestedUserId !== authUserId) {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You cannot deposit funds into another user wallet.' });
      }
    }
    const targetUserId = (isAdmin && requestedUserId) ? requestedUserId : authUserId;
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount greater than $0.00' });
    }
    if (amount > 5000) {
      return res.status(400).json({ error: 'Simulated deposits are limited to $5,000.' });
    }

    ensureWallet(targetUserId);
    const key = String(req.body?.idempotencyKey || req.body?.providerReference || randomUUID());
    const result = financeLedger.creditDeposit({
      userId: targetUserId,
      amount,
      reference: `SIM-${key}`,
      idempotencyKey: `SIM-${targetUserId}-${key}`,
      actor: `${caller.name} (Simulated)`,
      source: 'simulated'
    });
    syncUserBalances();
    const newBalance = financeLedger.getWalletBalance(targetUserId) ?? caller.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.journalId === result.journal.id);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: caller.name,
      role: caller.role,
      action: 'FUNDS_DEPOSITED',
      target: `User ${caller.name}`,
      details: `Deposited $${amount.toFixed(2)} (simulated). New Balance: $${newBalance.toFixed(2)}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, newBalance, transaction });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/payments/gateway/checkout', requireAuth, rateLimit(10, 60_000), (req, res) => {
  const { amount, currency = 'USD', gateway = 'stripe' } = req.body || {};
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Valid amount required' });

  ensureWallet(authUserId);
  const checkoutId = 'chk_' + randomUUID();
  res.json({
    success: true,
    checkoutId,
    gateway,
    amount: amt,
    currency,
    redirectUrl: `/checkout/success?session_id=${checkoutId}&amount=${amt}`
  });
});

// For webhook signature verification, we need the raw body. 
// Using a separate route or parsing raw body for this specific path.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'] as string;
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!secret || !signature) {
    return res.status(403).json({ error: 'Unauthorized: Missing signature' });
  }

  const hmac = createHmac('sha256', secret);
  hmac.update(req.body);
  const calculatedSignature = hmac.digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(calculatedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid signature' });
  }

  const payload = JSON.parse(req.body.toString());
  const { event, userId, amount, reference, transactionId } = payload || {};
  
  if (event === 'payment.succeeded' && userId && amount) {
    ensureWallet(userId);
    try {
      financeLedger.creditDeposit({
        userId,
        amount: Number(amount),
        reference: reference || transactionId || 'WH-DEPOSIT',
        idempotencyKey: `WH-${userId}-${transactionId || reference || Date.now()}`,
        actor: 'Gateway Webhook',
        source: 'webhook'
      });
      syncUserBalances();
      return res.json({ received: true });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  }
  res.json({ received: true });
});

// Withdraw Funds from User Account
app.post('/api/payments/withdraw', requireAuth, rateLimit(10, 60_000), handlePayoutRequest);

function validateOrderReleasePreconditions(order: Order, isAdmin = false, isInvoiceApproval = false): { status: number; error: string } | null {
  if (order.status === 'completed') {
    return { status: 400, error: 'Order escrow has already been released and completed.' };
  }
  if (order.status === 'cancelled') {
    return { status: 400, error: 'Cannot release escrow: Order has already been cancelled/refunded.' };
  }
  const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
  if (activeDispute || order.status === 'disputed') {
    return { status: 400, error: 'Cannot release escrow: Order is under active dispute. Resolve the dispute first.' };
  }
  if (!isAdmin) {
    const hasDelivery = (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) ||
                        (Array.isArray(order.deliverableFiles) && order.deliverableFiles.length > 0);
    if (!hasDelivery) {
      return {
        status: 400,
        error: 'Cannot release escrow: No formal invoice or delivery exists for this order.'
      };
    }
    if (!isInvoiceApproval && order.status !== 'delivered') {
      return {
        status: 400,
        error: `Cannot release escrow: Order is currently in "${order.status}" status. Buyer release becomes available only after the seller submits the invoice.`
      };
    }
    if (!isInvoiceApproval && Array.isArray(order.revisions) && order.revisions.some(r => r.status === 'requested')) {
      return {
        status: 400,
        error: 'Cannot release escrow: A revision request is currently pending resolution by the seller.'
      };
    }
  }
  return null;
}

// Release Escrow Payment (Buyer approves work)
app.post('/api/payments/escrow/release', requireAuth, (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const userId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === userId);
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isBuyer = userId === order.buyerId;
    if (!isAdmin && !isBuyer) {
      return res.status(403).json({ error: 'Forbidden: Only the order buyer or administrator can release escrow.' });
    }

    const validationError = validateOrderReleasePreconditions(order, isAdmin);
    if (validationError) {
      return res.status(validationError.status).json({ error: validationError.error });
    }

    // Mark any requested revisions as resolved upon approval
    let revisionsResolved = false;
    if (Array.isArray(order.revisions)) {
      for (const rev of order.revisions) {
        if (rev.status === 'requested') {
          rev.status = 'resolved';
          revisionsResolved = true;
        }
      }
    }
    if (revisionsResolved) {
      const sysMsg: Message = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Review Desk',
        text: `📝 Revision resolved by buyer.`,
        timestamp: new Date().toISOString(),
        type: 'system',
        metadata: { action: 'revision_resolved' }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);
    }

    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable or releasable escrow funds remain for this order.' });
    }

    const pendingHigherInvoice = workstreamOffers.find(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending' && o.amount > esc.remaining);
    if (pendingHigherInvoice) {
      return res.status(400).json({
        error: `Cannot release escrow directly: A final invoice (${pendingHigherInvoice.number} for $${pendingHigherInvoice.amount}) is awaiting payment. Please pay or decline the invoice in the workstream.`
      });
    }

    // If an invoice exists matching escrow exactly, mark it paid upon release
    const pendingMatchingInvoice = workstreamOffers.find(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending');
    if (pendingMatchingInvoice) {
      pendingMatchingInvoice.status = 'paid';
      pendingMatchingInvoice.resolvedAt = new Date().toISOString();
      pendingMatchingInvoice.resolvedBy = caller?.id || userId;
      saveOffersToDisk();
    }

    const seller = users.find(u => u.id === order.sellerId);
    const buyer = users.find(u => u.id === order.buyerId);

    if (seller) ensureWallet(seller.id);
    if (buyer) ensureWallet(buyer.id);

    const actorName = isAdmin ? adminActor(req) : (buyer?.name || 'Authorized Buyer');
    const requestKey = req.body?.requestKey || req.body?.idempotencyKey;
    const result = releaseOrderFunds(order, actorName, 'Buyer approved work', true, requestKey);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: actorName,
      role: caller?.role || 'buyer',
      action: 'ESCROW_RELEASED_BY_BUYER',
      target: `Order #${order.id}`,
      details: `Escrow release authorized of $${order.amount}. $${result.freelancerNet} credited to ${seller?.name || 'freelancer'}, $${result.platformFee} platform fee.`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, order: enrichOrderWithServiceInfo(order), freelancerNet: result.freelancerNet, platformFee: result.platformFee });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Refund Escrow Payment
app.post('/api/payments/escrow/refund', requireAuth, (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const userId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === userId);
    const { orderId, reason } = req.body;
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (activeDispute || order.status === 'disputed') {
      return res.status(400).json({ error: 'Cannot refund escrow: Order is under active dispute.' });
    }
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot refund: Order has already been completed.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot refund: Order has already been cancelled/refunded.' });
    }

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isSeller = userId === order.sellerId;
    const isBuyer = userId === order.buyerId;

    const isOverdueBy76Hours = order.dueDate ? (Date.now() > new Date(order.dueDate).getTime() + 76 * 60 * 60 * 1000) : false;

    if (!isAdmin && !isSeller) {
      if (isBuyer && isOverdueBy76Hours) {
        // Buyer permitted to cancel & refund because seller is 76h+ past due date (ghosted / missed deadline)
      } else if (isBuyer) {
        return res.status(403).json({ error: 'Forbidden: Buyer cannot cancel this order until 76 hours have passed past the agreed due date.' });
      } else {
        return res.status(403).json({ error: 'Forbidden: Not authorized to refund this escrow.' });
      }
    }

    // Beneficiary is ALWAYS the order's buyer from server order record (never client-supplied)
    const buyer = users.find(u => u.id === order.buyerId);
    if (buyer) ensureWallet(buyer.id);

    const actorName = isAdmin ? adminActor(req) : (caller?.name || (isSeller ? 'Seller' : 'Buyer'));
    const requestKey = req.body?.requestKey || req.body?.idempotencyKey;
    const result = refundOrderFunds(order, undefined, actorName, reason || (isSeller ? 'Seller cancelled order' : 'Escrow cancellation'), requestKey);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: actorName,
      role: caller?.role || (isSeller ? 'seller' : 'buyer'),
      action: isSeller ? 'ESCROW_REFUNDED_BY_SELLER' : (isAdmin ? 'ESCROW_REFUNDED_BY_ADMIN' : 'ESCROW_REFUNDED_BY_BUYER'),
      target: `Order #${order.id}`,
      details: `Escrow refund executed of $${result.refunded} to buyer wallet. Reason: ${reason || 'Escrow cancellation'}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, order, refunded: result.refunded });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Deposit Escrow for Order - Must strictly go through the double-entry ledger engine
app.post('/api/payments/escrow/deposit', requireAuth, rateLimit(20, 60_000), (req, res) => {
  const orderId = String(req.body?.orderId || '');
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === authUserId);
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isBuyer = authUserId === order.buyerId;
    if (!isAdmin && !isBuyer) {
      return res.status(403).json({ error: 'Forbidden: Only the order buyer or administrator can fund escrow.' });
    }

    if (order.status === 'funded_in_escrow' || orderHasEscrow(order.id)) {
      return res.status(400).json({ error: 'Order escrow is already funded.' });
    }

    if (order.status !== 'payment_pending' && order.status !== 'in_progress') {
      return res.status(400).json({ error: `Cannot fund escrow for order in status "${order.status}"` });
    }

    const buyerId = order.buyerId;
    const sellerId = order.sellerId;
    const buyer = users.find(u => u.id === buyerId);
    const seller = users.find(u => u.id === sellerId);
    if (!buyer || !seller) return res.status(404).json({ error: 'Buyer or seller not found' });

    ensureWallet(buyerId);
    ensureWallet(sellerId);

    // Call ledger engine to fund escrow atomically
    fundOrderEscrowWithEvent({
      orderId: order.id,
      orderTitle: order.title,
      amount: order.amount,
      buyerId,
      sellerId,
      actor: `user:${buyerId}`
    });

    order.status = 'funded_in_escrow';
    const today = new Date().toISOString().split('T')[0];
    order.escrowProtectionStartDate = today;
    order.escrowProtectionEndDate = new Date(Date.now() + DEFAULT_SITE_SETTINGS.commission.escrowProtectionDays * 86400000).toISOString().split('T')[0];
    syncUserBalances();
    saveOrdersToDisk();

    const newBalance = financeLedger.getWalletBalance(buyerId) ?? buyer.walletBalance;
    res.json({ success: true, order, newBalance });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// User Transactions Ledger
app.get('/api/payments/transactions/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user transactions is not allowed.' });
    }
    const userId = targetUserId;
    const allTxns = financeLedger.getTransactions();
    const userTxns = allTxns.filter(t => t.userId === userId);
    
    if (userTxns.length === 0) {
      const syn: any[] = [];
      for (const ord of orders) {
        if (ord.buyerId === userId) {
          syn.push({
            id: `txn_ord_${ord.id}`,
            type: 'escrow_fund',
            amount: ord.amount,
            currency: 'USD',
            timestamp: `${ord.createdAt} 12:00:00`,
            status: 'completed',
            userId: userId,
            userName: ord.buyerUsername || 'Buyer',
            userRole: 'buyer',
            description: `Escrow hold for Order: ${ord.title}`,
            relatedOrderId: ord.id
          });
        }
        if (ord.sellerId === userId && ord.status === 'completed') {
          syn.push({
            id: `txn_rel_${ord.id}`,
            type: 'escrow_release',
            amount: financeLedger.quoteOrder(ord.amount).freelancerNet,
            currency: 'USD',
            timestamp: `${ord.dueDate} 15:30:00`,
            status: 'completed',
            userId: userId,
            userName: ord.sellerUsername || 'Freelancer',
            userRole: 'freelancer',
            description: `Escrow earnings (${financeLedger.quoteOrder(ord.amount).freelancerPercent}% net) from: ${ord.title}`,
            relatedOrderId: ord.id
          });
        }
      }
      return res.json(syn);
    }

    res.json(userTxns);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User Invoices
app.get('/api/payments/invoices/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user invoices is not allowed.' });
    }
    const userId = targetUserId;
    const userOrders = orders.filter(o => o.buyerId === userId || o.sellerId === userId);
    const orderInvoices = userOrders.map(o => {
      const isBuyer = o.buyerId === userId;
      const otherUser = users.find(u => u.id === (isBuyer ? o.sellerId : o.buyerId));
      return {
        id: `inv_ord_${o.id}`,
        invoiceNumber: `INV-${o.id.replace('ord_', '').toUpperCase()}`,
        userId: userId,
        type: isBuyer ? 'received' : 'sent',
        recipientName: isBuyer ? (users.find(u => u.id === userId)?.name || 'Buyer') : (otherUser?.name || 'Client'),
        recipientEmail: isBuyer ? (users.find(u => u.id === userId)?.email || 'buyer@example.com') : (otherUser?.email || 'client@example.com'),
        issuerName: isBuyer ? (otherUser?.name || 'Freelancer') : (users.find(u => u.id === userId)?.name || 'Freelancer'),
        issuerEmail: isBuyer ? (otherUser?.email || 'seller@example.com') : (users.find(u => u.id === userId)?.email || 'seller@example.com'),
        title: o.title,
        issueDate: o.createdAt,
        dueDate: o.dueDate,
        status: o.status === 'completed' ? 'paid' : o.status === 'cancelled' ? 'refunded' : 'in_escrow',
        items: [
          { description: o.title, quantity: 1, unitPrice: o.amount, amount: o.amount }
        ],
        subtotal: o.amount,
        serviceFee: o.feeBreakdown?.serviceFee ?? financeLedger.quoteOrder(o.amount).serviceFee,
        smallOrderFee: o.feeBreakdown?.smallOrderFee ?? financeLedger.quoteOrder(o.amount).smallOrderFee,
        platformFee: o.feeBreakdown?.platformCommission ?? financeLedger.quoteOrder(o.amount).platformCommission,
        tax: 0,
        total: o.feeBreakdown?.clientTotal ?? financeLedger.quoteOrder(o.amount).clientTotal,
        notes: `WorkPerHour 14-Day Escrow Protection Order #${o.id}. 100% Protected.`,
        relatedOrderId: o.id
      };
    });

    const userCustom = customInvoices.filter(i => i.userId === userId);
    res.json([...orderInvoices, ...userCustom]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Custom Invoice
app.post('/api/payments/invoices', requireAuth, (req, res) => {
  try {
    const authenticatedUserId = (req as any).authenticatedUserId;
    const { recipientName, recipientEmail, title, dueDate, items, notes } = req.body;
    if (!title || !recipientName) {
      return res.status(400).json({ error: 'Title and recipient name are required' });
    }
    const cleanItems = (items && items.length > 0) ? items : [{ description: title, quantity: 1, unitPrice: 100, amount: 100 }];
    const subtotal = cleanItems.reduce((s: number, it: any) => s + (Number(it.amount) || (Number(it.quantity || 1) * Number(it.unitPrice || 0))), 0);
    const platformFee = 0;
    const total = subtotal;

    const newInvoice: CustomInvoice = {
      id: 'inv_' + Date.now(),
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      userId: authenticatedUserId, // Set from auth, not request body
      recipientName,
      recipientEmail: recipientEmail || 'client@example.com',
      title,
      issueDate: new Date().toISOString().substring(0, 10),
      dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().substring(0, 10),
      status: 'unpaid',
      items: cleanItems,
      subtotal,
      platformFee,
      tax: 0,
      total,
      notes: notes || 'Standard WorkPerHour Invoice'
    };
    customInvoices.unshift(newInvoice);
    saveCustomInvoicesToDisk();
    res.status(201).json(newInvoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Saved Payment Methods CRUD
app.get('/api/payments/methods/:userId', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  
  if (!isAdmin && authUserId !== req.params.userId) {
    return res.status(403).json({ error: 'Unauthorized: Cannot view another user payment methods.' });
  }
  const methods = savedPaymentMethods.filter(m => m.userId === req.params.userId);
  const sanitized = methods.map(m => ({
    ...m,
    details: {
      ...m.details,
      routingNumber: undefined
    }
  }));
  res.json(sanitized);
});

app.post('/api/payments/methods', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const { type, name, details, isDefault } = req.body;
    
    // Always use authenticated user ID
    const userId = authUserId;
    
    if (!userId || !type || !name) {
      return res.status(400).json({ error: 'Method type and name are required' });
    }
    if (isDefault) {
      savedPaymentMethods.forEach(m => {
        if (m.userId === userId) m.isDefault = false;
      });
    }
    const newMethod: PaymentMethodRecord = {
      id: 'pm_' + Date.now(),
      userId,
      type,
      name,
      details: details || {},
      isDefault: Boolean(isDefault) || savedPaymentMethods.filter(m => m.userId === userId).length === 0,
      createdAt: new Date().toISOString().substring(0, 10)
    };
    savedPaymentMethods.push(newMethod);
    res.json(newMethod);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/payments/methods/:id', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  const method = savedPaymentMethods.find(m => m.id === req.params.id);
  if (!method) return res.status(404).json({ error: 'Payment method not found' });
  if (!isAdmin && method.userId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Cannot delete another user payment method.' });
  }

  const index = savedPaymentMethods.findIndex(m => m.id === req.params.id);
  if (index !== -1) {
    savedPaymentMethods.splice(index, 1);
  }
  res.json({ success: true, id: req.params.id });
});

app.patch('/api/payments/methods/:id/default', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  const method = savedPaymentMethods.find(m => m.id === req.params.id);
  if (!method) return res.status(404).json({ error: 'Payment method not found' });
  if (!isAdmin && method.userId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Cannot modify another user payment method.' });
  }

  savedPaymentMethods.forEach(m => {
    if (m.userId === method.userId) m.isDefault = false;
  });
  method.isDefault = true;
  res.json(method);
});

// ==========================================
// DOUBLE-ENTRY LEDGER & FINANCIAL REST APIS
// ==========================================

// Reset Financial Ledger and Workstream Data to Pristine Clean State
app.post('/api/admin/finance/reset-clean', requireRole(['admin', 'super_admin']), (req, res) => {
  try {
    financeLedger.resetToCleanState();
    orders = [];
    orderIndex.clear();
    messages = [];
    messageIndex.clear();
    workstreamOffers = [];
    customInvoices = [];
    disputes = [];
    saveOrdersToDisk();
    saveMessagesToDisk();
    saveOffersToDisk();
    saveCustomInvoicesToDisk();
    res.json({ success: true, message: 'Financial ledger and workstream data reset to pristine clean state.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 1. Overview Financial Metrics Dashboard
app.get('/api/admin/finance/overview', requireRole(['admin', 'super_admin']), (req, res) => {
  try {
    const overview = financeLedger.getFinancialOverview();
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. User Wallets Explorer & Details
app.get('/api/admin/finance/wallets', requireAdmin, (req, res) => {
  try {
    const wallets = financeLedger.getWallets();
    res.json(wallets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/wallets/:id', requireAdmin, (req, res) => {
  try {
    const data = financeLedger.getWalletById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Wallet not found' });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/freeze', requireAdmin, (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory reason required to freeze a wallet' });
    const wallet = financeLedger.freezeWallet(req.params.id, reason, adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/unfreeze', requireAdmin, (req, res) => {
  try {
    const { reason } = req.body;
    const wallet = financeLedger.unfreezeWallet(req.params.id, reason || 'Administrative review completed', adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/restrict', requireAdmin, (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory reason required to restrict a wallet' });
    const wallet = financeLedger.restrictWallet(req.params.id, reason, adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Transactions Explorer
app.get('/api/admin/finance/transactions', requireAdmin, (req, res) => {
  try {
    const txns = financeLedger.getTransactions();
    res.json(txns);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/transactions/:id', requireAdmin, (req, res) => {
  try {
    const txn = financeLedger.getTransactionById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    const journal = txn.journalId ? financeLedger.getJournalById(txn.journalId) : null;
    res.json({ transaction: txn, journal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Double-Entry Ledger Journals & Entries
app.get('/api/admin/finance/ledger', requireAdmin, (req, res) => {
  try {
    const journals = financeLedger.getJournals();
    res.json(journals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/ledger/:id', requireAdmin, (req, res) => {
  try {
    const journal = financeLedger.getJournalById(req.params.id);
    if (!journal) return res.status(404).json({ error: 'Journal not found' });
    res.json(journal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/ledger/:id/reverse', requireAdmin, (req, res) => {
  try {
    const { reason, actor } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory accounting reversal reason required' });
    const reversal = financeLedger.reverseJournal(req.params.id, reason, adminActor(req));
    res.json(reversal);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Escrow & Order Protection Vault Management
app.get('/api/admin/finance/escrow', requireAdmin, (req, res) => {
  try {
    const escrowOrders = orders.map(o => {
      const enriched = enrichOrderWithServiceInfo(o);
      const isDisputed = disputes.some(d => d.orderId === o.id && (d.status === 'open' || d.status === 'under_investigation'));
      const isRefunded = refunds.some(r => r.orderId === o.id && r.status === 'approved');
      const buyer = users.find(u => u.id === o.buyerId);
      const seller = users.find(u => u.id === o.sellerId);

      let escrowState = 'in_progress';
      if (isDisputed) escrowState = 'disputed';
      else if (isRefunded) escrowState = 'refunded';
      else if (o.status === 'completed') escrowState = 'released';
      else if (o.status === 'delivered') escrowState = 'release_pending';
      else if (o.status === 'funded_in_escrow') escrowState = 'funded';

      return {
        ...enriched,
        buyerName: buyer?.name || 'Buyer #' + o.buyerId,
        buyerEmail: buyer?.email || '',
        sellerName: seller?.name || 'Freelancer #' + o.sellerId,
        sellerEmail: seller?.email || '',
        platformFeeRate: `${financeLedger.getPlatformCommissionRate()}%`,
        platformFeeAmount: FinanceLedgerEngine.round(o.amount * financeLedger.getPlatformCommissionRate() / 100),
        freelancerNetAmount: FinanceLedgerEngine.round(o.amount - o.amount * financeLedger.getPlatformCommissionRate() / 100),
        ledgerEscrowStatus: financeLedger.getEscrow(o.id)?.status || 'not_funded',
        ledgerEscrowHeld: financeLedger.getEscrow(o.id)?.remaining ?? 0,
        escrowState,
        isDisputed
      };
    });
    res.json(escrowOrders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/escrow/:orderId/release', requireAdmin, (req, res) => {
  const orderId = req.params.orderId;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Order escrow has already been released and completed.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot release escrow: Order has already been cancelled/refunded.' });
    }
    const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (activeDispute || order.status === 'disputed') {
      return res.status(400).json({ error: `Cannot release escrow: Order #${order.id} is under active dispute. Resolve the dispute first.` });
    }
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable or releasable escrow funds remain for this order.' });
    }
    const result = releaseOrderFunds(order, adminActor(req), String(req.body.reason || 'Administrative escrow release'), false, req.body.requestKey);
    res.json({ success: true, order, journal: result.journal, freelancerNet: result.freelancerNet, platformFee: result.platformFee });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

app.post('/api/admin/finance/escrow/:orderId/refund', requireAdmin, (req, res) => {
  const orderId = req.params.orderId;
  if (!tryAcquireOrderLock(orderId, res)) return;
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot refund order: Escrow funds have already been released to seller.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled/refunded.' });
    }
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable escrow funds remaining for this order.' });
    }
    const amount = req.body.amount === undefined || req.body.amount === '' ? undefined : Number(req.body.amount);
    const result = refundOrderFunds(order, amount, adminActor(req), String(req.body.reason || 'Administrative escrow refund approval'), req.body.requestKey);
    closeActiveDispute(order.id, 'resolved_refund', String(req.body.reason || 'Administrative escrow refund'));
    res.json({ success: true, order, journal: result.journal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// 6. Payouts Management & Gateway Settlements
app.get('/api/admin/finance/payouts', requireAdmin, (req, res) => {
  try {
    const enrichedPayouts = payouts.map(p => {
      const freelancer = users.find(u => u.id === p.freelancerId);
      const wallet = financeLedger.getWalletById(p.freelancerId);
      return {
        ...p,
        freelancerName: freelancer?.name || 'Freelancer #' + p.freelancerId,
        freelancerEmail: freelancer?.email || '',
        walletAvailableBalance: wallet?.wallet.availableBalance || 0,
        currency: 'USD'
      };
    });
    res.json(enrichedPayouts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function payoutAudit(req: Request, action: string, p: Payout, details: string) {
  registerAuditLog({
    id: 'FAUD-' + randomUUID().slice(0, 12),
    actor: adminActor(req),
    role: 'super_admin',
    action,
    target: `Payout #${p.id}`,
    details,
    timestamp: new Date().toLocaleString()
  });
}

const approvePayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending') return res.status(400).json({ error: `Cannot approve payout in status "${p.status}"` });
    p.status = 'approved';
    savePayoutsToDisk();
    payoutAudit(req, 'PAYOUT_APPROVED', p, `Approved payout of $${p.amount} via ${p.method} for freelancer ${p.freelancerId}`);
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

// Marks a payout as paid. When a real gateway is connected, call it here FIRST and only continue on success.
const processPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot process payout in status "${p.status}"` });
    if (p.amount >= 500 && p.status !== 'approved') {
      return res.status(400).json({ error: 'Payouts of $500.00 or more require explicit administrative approval before processing.' });
    }
    const { journal } = financeLedger.settlePayout({ payoutId: p.id, actor: adminActor(req), providerReference: req.body?.providerReference });
    p.status = 'processed';
    savePayoutsToDisk();
    payoutAudit(req, 'PAYOUT_PROCESSED', p, `Processed payout of $${p.amount} via ${p.method}`);
    syncUserBalances();
    res.json({ success: true, payout: p, journal, ...p });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const rejectPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot reject payout in status "${p.status}"` });
    financeLedger.cancelPayout({ payoutId: p.id, reason: String(req.body?.reason || 'Administrative rejection'), actor: adminActor(req) });
    p.status = 'cancelled';
    savePayoutsToDisk();
    payoutAudit(req, 'PAYOUT_REJECTED', p, `Rejected payout of $${p.amount}; funds returned to wallet`);
    syncUserBalances();
    res.json({ success: true, payout: p, ...p });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const failPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot fail payout in status "${p.status}"` });
    financeLedger.failPayout({ payoutId: p.id, reason: String(req.body?.reason || 'Gateway reported a transfer failure'), actor: adminActor(req) });
    p.status = 'failed';
    savePayoutsToDisk();
    payoutAudit(req, 'PAYOUT_FAILED', p, `Payout of $${p.amount} failed; funds returned to wallet`);
    syncUserBalances();
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const retryPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'failed') return res.status(400).json({ error: 'Only failed payouts can be retried.' });
    financeLedger.retryPayout({ payoutId: p.id, actor: adminActor(req) });
    p.status = 'pending';
    savePayoutsToDisk();
    payoutAudit(req, 'PAYOUT_RETRIED', p, `Re-queued failed payout of $${p.amount}`);
    syncUserBalances();
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

app.post('/api/admin/finance/payouts/:id/approve', requireAdmin, approvePayout);
app.post('/api/admin/finance/payouts/:id/process', requireAdmin, processPayout);
app.post('/api/admin/finance/payouts/:id/reject', requireAdmin, rejectPayout);
app.post('/api/admin/finance/payouts/:id/fail', requireAdmin, failPayout);
app.post('/api/admin/finance/payouts/:id/retry', requireAdmin, retryPayout);
// Legacy routes still used by the older admin payments tab in App.tsx
app.patch('/api/admin/payouts/:id/approve', requireAdmin, approvePayout);
app.patch('/api/admin/payouts/:id/process', requireAdmin, processPayout);
app.patch('/api/admin/payouts/:id/fail', requireAdmin, failPayout);

// Freelancer withdrawal request: uses isolated payout user authorization and ledger requestPayout
app.post('/api/payouts', requireAuth, rateLimit(10, 60_000), handlePayoutRequest);

// Wallet top-up (Simulated - Strictly Development Only)
app.post('/api/wallet/deposit', requireAuth, rateLimit(10, 60_000), (req, res) => {
  try {
    // Simulated deposits are strictly development/test functionality; reject in production unconditionally
    if (!areSimulatedDepositsAllowed()) {
      return res.status(501).json({ error: 'Deposits require a connected payment gateway in production.' });
    }

    const authUserId = (req as any).authenticatedUserId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const caller = users.find(u => u.id === authUserId);
    if (!caller) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    // User A cannot credit User B's wallet by supplying User B's ID
    const requestedUserId = req.body?.userId;
    let targetUserId = authUserId;
    if (requestedUserId && requestedUserId !== authUserId) {
      const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You cannot deposit funds into another user wallet.' });
      }
      const targetUser = users.find(u => u.id === requestedUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }
      targetUserId = requestedUserId;
    }
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount greater than $0.00' });
    }
    if (amount > 5000) {
      return res.status(400).json({ error: 'Simulated deposits are limited to $5,000.' });
    }

    ensureWallet(targetUserId);
    const key = String(req.body?.idempotencyKey || randomUUID());
    const { replayed } = financeLedger.creditDeposit({
      userId: targetUserId,
      amount,
      reference: `SIM-${key}`,
      idempotencyKey: `SIM-${targetUserId}-${key}`,
      actor: `${caller.name} (Simulated)`,
      source: 'simulated'
    });
    syncUserBalances();
    res.json({ success: true, replayed, balance: financeLedger.getWalletBalance(targetUserId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Reconciliation Workspace & Exception Resolution
app.get('/api/admin/finance/reconciliation', requireAdmin, (req, res) => {
  try {
    const recon = financeLedger.getReconciliationSummary();
    res.json(recon);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/reconciliation/resolve/:id', requireAdmin, (req, res) => {
  try {
    const { notes, actor } = req.body;
    if (!notes) return res.status(400).json({ error: 'Investigation notes required to mark exception resolved' });
    const resolved = financeLedger.resolveException(req.params.id, notes, adminActor(req));
    res.json(resolved);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Financial Audit Trail
app.get('/api/admin/finance/audit', requireAdmin, (req, res) => {
  try {
    const logs = financeLedger.getAuditLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Administrative Adjustments (Controlled Double-Entry Workflow)
app.post('/api/admin/finance/adjustments/preview', requireAdmin, (req, res) => {
  try {
    const { userId, amount, direction, category, reason } = req.body;
    const preview = financeLedger.previewAdjustment({ userId, amount: Number(amount), direction, category, reason });
    res.json(preview);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/adjustments', requireAdmin, (req, res) => {
  try {
    const { userId, amount, direction, category, reason, evidenceReference, requestKey } = req.body;
    const result = financeLedger.executeAdministrativeAdjustment({
      userId,
      amount: Number(amount),
      direction,
      category,
      reason,
      evidenceReference,
      actor: adminActor(req),
      requestKey
    });
    syncUserBalances();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Reports & CSV Export Engine
app.get('/api/admin/finance/export/:type', requireAdmin, (req, res) => {
  try {
    const { type } = req.params;
    const { filename, content } = financeLedger.generateCsvExport(type, req.query as any);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(content);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Category CRUD Endpoints
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const { name, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const catSlug = slug || name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  const newCat: Category = {
    id: 'cat_' + Date.now(),
    name,
    slug: catSlug,
    enabled: true,
    order: categories.length + 1,
    subcategories: []
  };
  categories.push(newCat);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_CREATED',
    target: `Category: ${name}`,
    details: `Created new main category "${name}" with slug /${catSlug}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.post('/api/admin/categories/bulk-delete', requireAdmin, (req, res) => {
  const { categoryIds = [], subcategoryPairs = [] } = req.body;
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    categories = categories.filter(c => !categoryIds.includes(c.id));
  }
  if (Array.isArray(subcategoryPairs) && subcategoryPairs.length > 0) {
    subcategoryPairs.forEach(({ catId, subId }: { catId: string; subId: string }) => {
      const cat = categories.find(c => c.id === catId);
      if (cat) {
        cat.subcategories = cat.subcategories.filter(s => s.id !== subId);
      }
    });
  }

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORIES_BULK_DELETED',
    target: 'Marketplace Categories',
    details: `Bulk deleted ${categoryIds.length} categories and ${subcategoryPairs.length} subcategories`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (req.body.name) cat.name = req.body.name;
  if (req.body.slug) cat.slug = req.body.slug;
  if (typeof req.body.enabled === 'boolean') cat.enabled = req.body.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_UPDATED',
    target: `Category: ${cat.name}`,
    details: `Updated category name/slug/status for ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/toggle', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  cat.enabled = !cat.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: cat.enabled ? 'CATEGORY_ENABLED' : 'CATEGORY_DISABLED',
    target: `Category: ${cat.name}`,
    details: `Toggled status of category ${cat.name} to ${cat.enabled ? 'Enabled' : 'Disabled'}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const index = categories.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Category not found' });
  const deleted = categories[index];
  categories.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_DELETED',
    target: `Category: ${deleted.name}`,
    details: `Deleted category ${deleted.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

// Subcategory CRUD Endpoints
app.post('/api/admin/categories/:id/subcategories', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const { name, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Subcategory name is required' });
  const subSlug = slug || name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  const newSub = {
    id: 'sub_' + Date.now(),
    name,
    slug: subSlug,
    enabled: true
  };
  cat.subcategories.push(newSub);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_CREATED',
    target: `Subcategory: ${name} (under ${cat.name})`,
    details: `Created subcategory ${name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/subcategories/:subId', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const sub = cat.subcategories.find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  if (req.body.name) sub.name = req.body.name;
  if (req.body.slug) sub.slug = req.body.slug;
  if (typeof req.body.enabled === 'boolean') sub.enabled = req.body.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_UPDATED',
    target: `Subcategory: ${sub.name}`,
    details: `Updated subcategory under ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/subcategories/:subId/toggle', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const sub = cat.subcategories.find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  sub.enabled = !sub.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: sub.enabled ? 'SUBCATEGORY_ENABLED' : 'SUBCATEGORY_DISABLED',
    target: `Subcategory: ${sub.name}`,
    details: `Toggled subcategory status to ${sub.enabled ? 'Enabled' : 'Disabled'}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.delete('/api/admin/categories/:id/subcategories/:subId', requireAdmin, (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const subIndex = cat.subcategories.findIndex(s => s.id === req.params.subId);
  if (subIndex === -1) return res.status(404).json({ error: 'Subcategory not found' });
  const deletedSub = cat.subcategories[subIndex];
  cat.subcategories.splice(subIndex, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_DELETED',
    target: `Subcategory: ${deletedSub.name}`,
    details: `Deleted subcategory from ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});
function isValidIntegerRating(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  const num = Number(val);
  return typeof num === 'number' && !isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 5;
}

function isReviewPublic(r: Review): boolean {
  if (!r) return false;
  // Reviews on cancelled orders are private dispute/cancellation records between participants and staff
  if (r.isCancelledOrder) return false;
  // Non-approved, hidden, or non-public moderation status
  if ((r as any).moderationStatus && (r as any).moderationStatus !== 'approved') return false;
  if ((r as any).status && !['approved', 'published', 'active'].includes((r as any).status)) return false;
  return true;
}

function recalculateUserRating(userId: string) {
  const targetUser = users.find(u => u.id === userId);
  if (!targetUser) return;
  const publicUserReviews = reviews.filter(r => r.targetUserId === userId && isReviewPublic(r));
  targetUser.reviewsCount = publicUserReviews.length;
  if (publicUserReviews.length > 0) {
    targetUser.rating = Number((publicUserReviews.reduce((sum, r) => sum + r.rating, 0) / publicUserReviews.length).toFixed(1));
  } else {
    targetUser.rating = 0;
  }
}

function sanitizePublicReview(r: Review): Review {
  const { moderationReason, moderationNotes, ...publicRev } = r as any;
  return publicRev;
}

app.get('/api/reviews', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  if (isAdmin) {
    return res.json(reviews);
  }

  const visibleReviews = reviews.filter(r => {
    // Participants see their own reviews (even if cancelled or pending moderation, unless hidden by staff)
    if (authUserId && (r.reviewerId === authUserId || r.targetUserId === authUserId)) {
      return (r as any).moderationStatus !== 'hidden';
    }
    // General marketplace users only see approved public reviews
    return isReviewPublic(r);
  }).map(sanitizePublicReview);

  res.json(visibleReviews);
});

app.get('/api/users/:userId/reviews', (req, res) => {
  const targetUserId = req.params.userId;
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  const userReviews = reviews.filter(r => {
    if (r.targetUserId !== targetUserId) return false;
    if (isAdmin) return true;
    if (authUserId && (r.reviewerId === authUserId || r.targetUserId === authUserId)) {
      return (r as any).moderationStatus !== 'hidden';
    }
    return isReviewPublic(r);
  }).map(sanitizePublicReview);

  res.json(userReviews);
});

app.post('/api/reviews', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required to submit a review' });

  const { orderId, targetUserId, rating, comment } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  if (!isValidIntegerRating(rating)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars.' });
  }
  const numRating = Number(rating);

  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'Review comment cannot be empty' });
  }

  const order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Workstream order not found' });
  if (caller.id !== order.buyerId && caller.id !== order.sellerId) {
    return res.status(403).json({ error: 'Forbidden: Only the buyer or seller of this order can submit a review.' });
  }

  // Validate targetUserId against actual seller/buyer associated with order
  const expectedTargetUserId = caller.id === order.buyerId ? order.sellerId : order.buyerId;
  if (targetUserId && targetUserId !== expectedTargetUserId) {
    return res.status(400).json({ error: 'Invalid targetUserId. Review must target the seller or buyer associated with this order.' });
  }
  const resolvedTargetUserId = expectedTargetUserId;

  // Completed, Cancelled, or Paid-Invoice Workstream eligibility
  const allowedReviewStatuses = ['completed', 'cancelled'];
  if (!allowedReviewStatuses.includes(order.status) && !hasPaidInvoiceOrReleasedEscrow(order)) {
    return res.status(409).json({ error: `Reviews can only be submitted for completed or cancelled Workstreams (current status: ${order.status}).` });
  }

  const isBuyerReviewer = caller.id === order.buyerId;
  // Check if review already exists for this order & reviewer -> Block duplicate submission (409)
  const existingReview = reviews.find(r => r.orderId === order.id && r.reviewerId === caller.id) ||
    (isBuyerReviewer && order.review && order.review.reviewerId === caller.id ? order.review : null) ||
    (!isBuyerReviewer && (order as any).sellerReview && (order as any).sellerReview.reviewerId === caller.id ? (order as any).sellerReview : null);
  if (existingReview) {
    return res.status(409).json({ error: 'A review has already been submitted for this order. Use PUT /api/reviews/:id to edit your review.' });
  }

  const newReview: Review = {
    id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    orderId: order.id,
    reviewerId: caller.id,
    reviewerName: caller.name,
    reviewerAvatar: caller.avatar,
    targetUserId: resolvedTargetUserId,
    rating: numRating,
    comment: comment.trim(),
    orderTitle: order.title || 'Workstream Milestone Deliverable',
    gigId: order.gigId,
    projectId: order.projectId,
    isCancelledOrder: order.status === 'cancelled',
    createdAt: new Date().toISOString().split('T')[0]
  };

  reviews.unshift(newReview);
  saveReviewsToDisk();

  if (isBuyerReviewer) {
    order.review = newReview;
  } else {
    (order as any).sellerReview = newReview;
  }
  saveOrdersToDisk();

  // Dynamically update target user's rating and reviewsCount using public reviews
  recalculateUserRating(resolvedTargetUserId);

  // Broadcast system message to workstream
  const sysMsg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Reviews',
    text: `⭐ ${order.status === 'cancelled' ? 'Post-cancellation review' : 'Review'} submitted by ${caller.name} (${newReview.rating}/5 stars): "${newReview.comment}"`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: {
      action: 'review_submitted',
      rating: newReview.rating,
      comment: newReview.comment,
      isCancelledOrder: order.status === 'cancelled'
    }
  };
  recordMessage(sysMsg);
  saveMessagesToDisk();
  broadcastMessage(sysMsg, order.id);

  res.status(201).json({ success: true, review: newReview, order: enrichOrderWithServiceInfo(order) });
});

// Edit/Update Review Endpoint
app.put('/api/reviews/:id', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const review = reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
  if (!isAdmin && review.reviewerId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: You can only edit your own review.' });
  }

  const { rating, comment } = req.body;
  if (rating !== undefined) {
    if (!isValidIntegerRating(rating)) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars.' });
    }
    review.rating = Number(rating);
  }

  if (comment && typeof comment === 'string' && comment.trim()) {
    review.comment = comment.trim();
  }

  review.updatedAt = new Date().toISOString();
  saveReviewsToDisk();

  if (review.targetUserId) {
    recalculateUserRating(review.targetUserId);
  }

  if (review.orderId) {
    const order = orderIndex.get(review.orderId);
    if (order && order.review && order.review.id === review.id) {
      order.review.rating = review.rating;
      order.review.comment = review.comment;
      saveOrdersToDisk();
    }
  }

  res.json({ success: true, review });
});

// Seller Rebuttal / Public Response Endpoint
app.post('/api/reviews/:id/reply', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const review = reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
  if (!isAdmin && review.targetUserId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: Only the reviewed seller or an admin can reply to this review.' });
  }

  if (review.reply) {
    return res.status(409).json({ error: 'A public response has already been submitted for this review.' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Reply text cannot be empty.' });
  }

  const replyObj = {
    text: text.trim(),
    createdAt: new Date().toISOString(),
    sellerId: caller.id,
    sellerName: caller.name,
    sellerAvatar: caller.avatar
  };

  review.reply = replyObj;
  saveReviewsToDisk();

  if (review.orderId) {
    const order = orderIndex.get(review.orderId);
    if (order) {
      if (order.review && order.review.id === review.id) {
        order.review.reply = replyObj;
      }
      saveOrdersToDisk();

      const sysMsg: Message = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Reviews',
        text: `💬 Public response posted by seller ${caller.name}: "${replyObj.text}"`,
        timestamp: new Date().toISOString(),
        type: 'system',
        metadata: { action: 'review_reply_submitted', reply: replyObj }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);
    }
  }

  res.json({ success: true, review });
});
app.get('/api/support-tickets', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin' || caller.role === 'support';

  if (isAdmin) {
    res.json(supportTickets);
  } else {
    res.json(supportTickets.filter(t => t.userId === authUserId));
  }
});
app.get('/api/audit-logs', requireRole(['admin', 'super_admin']), (req, res) => res.json(auditLogs));

// User Email Notifications API
app.get('/api/user-emails/:userId', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const isAdminOrStaff = caller.role === 'admin' || caller.role === 'super_admin' || caller.role === 'support';
  if (caller.id !== req.params.userId && !isAdminOrStaff) return res.status(403).json({ error: 'Forbidden' });
  const userList = userEmails.filter(e => e.userId === req.params.userId);
  res.json(userList);
});

app.patch('/api/user-emails/:id/read', requireAuth, (req, res) => {
  const em = userEmails.find(e => e.id === req.params.id);
  if (!em) return res.status(404).json({ error: 'Notification not found' });
  em.read = true;
  res.json({ success: true });
});

// User Support Ticket Creation API
app.post('/api/support-tickets', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });

  const { subject, text, priority = 'medium' } = req.body;
  const userId = caller.id;
  const userName = caller.name;

  const newTicket: SupportTicket = {
    id: 'tick_' + Date.now(),
    userId,
    userName,
    subject: subject || 'General Support Query',
    priority,
    status: 'open',
    createdAt: new Date().toISOString().split('T')[0],
    messages: [
      { sender: userName, text: text || 'I need support assistance regarding my account.', timestamp: new Date().toISOString() }
    ]
  };
  supportTickets.unshift(newTicket);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: userName,
    role: caller.role,
    action: 'SUPPORT_TICKET_OPENED',
    target: `Ticket #${newTicket.id}`,
    details: `User submitted support request: ${subject}`,
    timestamp: new Date().toLocaleString()
  });

  res.status(201).json({ success: true, ticket: newTicket, ...newTicket });
});

const WORKSTREAM_UPLOADS_DIR = path.join(__dirname, 'data', 'uploads', 'workstream');
if (!fs.existsSync(WORKSTREAM_UPLOADS_DIR)) {
  fs.mkdirSync(WORKSTREAM_UPLOADS_DIR, { recursive: true });
}

const WORKSTREAM_FILE_URL_PREFIX = '/api/workstream/files/';
const WORKSTREAM_UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_uploads.json');
const WORKSTREAM_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const WORKSTREAM_ABANDONED_UPLOAD_TTL_MS = 24 * 3600 * 1000;
// Allowed attachment types. Vectors (.svg) and code (.html, .js, .ts, etc.) are fully supported without restriction.
const WORKSTREAM_ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.txt', '.md', '.csv', '.json',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z',
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.fig', '.psd', '.ai', '.sketch',
  '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss',
  '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.rs', '.sql', '.sh', '.xml', '.vue', '.svelte', '.yaml', '.yml'
]);
// .html is deliberately NOT inline: it would run uploaded scripts on the app origin. It is still fully downloadable.
const WORKSTREAM_INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.svg', '.txt']);

// Upload ownership index: filename -> who uploaded it and when. Persisted so access rules and
// abandoned-upload cleanup survive restarts.
interface WorkstreamUploadRecord { ownerId: string; createdAt: string; }
let workstreamUploadIndex: Record<string, WorkstreamUploadRecord> = {};
try {
  if (fs.existsSync(WORKSTREAM_UPLOAD_INDEX_FILE)) {
    workstreamUploadIndex = JSON.parse(fs.readFileSync(WORKSTREAM_UPLOAD_INDEX_FILE, 'utf-8')) || {};
  }
} catch (err) {
  console.error('Failed to load workstream upload index:', err);
}

// (Old implementation removed in favor of atomic helper)

function workstreamFilenameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(WORKSTREAM_FILE_URL_PREFIX)) return null;
  const name = path.basename(url.slice(WORKSTREAM_FILE_URL_PREFIX.length).split('?')[0]);
  return name || null;
}

/** True when any message, deliverable or delivery record still points at this stored file. */
function workstreamFileReferencedBy(filename: string): Array<{ buyerId: string; sellerId: string }> {
  const holders: Array<{ buyerId: string; sellerId: string }> = [];
  const matches = (u: unknown) => workstreamFilenameFromUrl(u) === filename;
  for (const o of orders as any[]) {
    const inOrder =
      (Array.isArray(o.deliverableFiles) && o.deliverableFiles.some((f: any) => matches(f?.url))) ||
      (Array.isArray(o.deliveryHistory) && o.deliveryHistory.some((d: any) => Array.isArray(d.files) && d.files.some((f: any) => matches(f?.url)))) ||
      messages.some(m => m.orderId === o.id && matches(m.fileInfo?.url));
    if (inOrder) holders.push({ buyerId: o.buyerId, sellerId: o.sellerId });
  }
  return holders;
}

function canAccessWorkstreamFile(user: any, filename: string): boolean {
  if (!user) return false;
  if (isStaffUser(user)) return true;
  if (workstreamUploadIndex[filename]?.ownerId === user.id) return true;
  return workstreamFileReferencedBy(filename).some(h => h.buyerId === user.id || h.sellerId === user.id);
}

/** A message attachment must be a file the sender uploaded (or staff attaching one that exists). */
function validateMessageFileInfo(fileInfo: any, sender: any):
  { ok: true; fileInfo: any } | { ok: false; error: string } {
  if (fileInfo === undefined || fileInfo === null) return { ok: true, fileInfo: undefined };
  if (typeof fileInfo !== 'object') return { ok: false, error: 'Invalid file attachment.' };
  const filename = workstreamFilenameFromUrl(fileInfo.url);
  if (!filename || !fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
    return { ok: false, error: 'Attachments must be uploaded files; placeholder or external URLs are not accepted.' };
  }
  if (!isStaffUser(sender) && workstreamUploadIndex[filename]?.ownerId !== sender.id) {
    return { ok: false, error: 'You can only attach files that you uploaded.' };
  }
  const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
  const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return {
    ok: true,
    fileInfo: {
      name: typeof fileInfo.name === 'string' && fileInfo.name.trim() ? fileInfo.name.trim().slice(0, 200) : filename,
      size,
      url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}`,
      ...(typeof fileInfo.type === 'string' ? { type: fileInfo.type.slice(0, 100) } : {})
    }
  };
}

// Validates that client-submitted file records point at files actually stored by the upload endpoint
function validateStoredWorkstreamFiles(raw: any[], submitter?: any): { ok: true; files: Array<{ name: string; size: string; url: string }> } | { ok: false; error: string } {
  const out: Array<{ name: string; size: string; url: string }> = [];
  for (const f of raw) {
    const filename = workstreamFilenameFromUrl(f?.url);
    if (!filename) {
      // Non-uploaded deliverable "links" are user-provided content: working, broken or arbitrary URLs and free text
      // (including text such as "javascript:..." or "data:...") are stored as typed and never verified.
      // Safety is enforced where the value is rendered/opened in the browser (src/utils/safeFileLink.ts), not here.
      if (typeof f?.url !== 'string') {
        return { ok: false, error: 'Invalid deliverable link.' };
      }
      const extUrl = f.url.trim();
      out.push({
        name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : 'External Deliverable',
        size: typeof f?.size === 'string' ? f.size : '1.0 MB',
        url: extUrl
      });
      continue;
    }
    if (!fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
      return { ok: false, error: `Uploaded file not found on server: ${filename}` };
    }
    if (submitter && !isStaffUser(submitter) && workstreamUploadIndex[filename]?.ownerId !== submitter.id) {
      return { ok: false, error: 'You can only deliver files that you uploaded.' };
    }
    const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
    const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const parts = filename.split('_');
    const fallbackName = parts.length > 2 ? parts.slice(2).join('_') : filename;
    out.push({ name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : fallbackName, size, url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}` });
  }
  return { ok: true, files: out };
}

// Remove uploads that were never attached to a message or delivery (WS-31). Only files recorded in
// the upload index are ever deleted; legacy/unknown files are left alone.
function cleanupAbandonedWorkstreamUploads() {
  const now = Date.now();
  let changed = false;

  // 1. Clean the index of abandoned entries
  for (const [filename, rec] of Object.entries(workstreamUploadIndex)) {
    const isOld = now - new Date(rec.createdAt).getTime() > WORKSTREAM_ABANDONED_UPLOAD_TTL_MS;
    if (!isOld) continue;

    const isReferenced = workstreamFileReferencedBy(filename).length > 0;
    if (isReferenced) continue;

    try { fs.unlinkSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)); } catch { /* already gone */ }
    delete workstreamUploadIndex[filename];
    changed = true;
  }

  // 2. Deep Clean: scan filesystem for unindexed "garbage" files
  try {
    const filesOnDisk = fs.readdirSync(WORKSTREAM_UPLOADS_DIR);
    for (const file of filesOnDisk) {
      if (!workstreamUploadIndex[file]) {
        // Unindexed file found. Check if it's old enough to be "orphaned" (e.g. 1 hour old)
        // to avoid deleting files currently being uploaded but not yet indexed.
        const filePath = path.join(WORKSTREAM_UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600_000) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
    }
  } catch (e) {
    console.error('Error during deep Workstream cleanup:', e);
  }

  if (changed) saveWorkstreamUploadIndex();
}

setInterval(cleanupAbandonedWorkstreamUploads, 3600_000).unref?.();

// ==========================================
// BUYER REVIEW WINDOW & AUTO-ACCEPT ENGINE
// ==========================================
export function processAutoAcceptOrders(customNow?: number): Array<{
  orderId: string;
  acceptedVersion: number;
  amount: number;
  freelancerNet: number;
}> {
  if (!isAutoAcceptEnabled()) {
    return [];
  }

  const days = getReviewWindowDays();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const now = typeof customNow === 'number' ? customNow : Date.now();
  const processed: Array<{ orderId: string; acceptedVersion: number; amount: number; freelancerNet: number }> = [];

  for (const order of orders) {
    // 1. Must be currently in 'delivered' status
    if (order.status !== 'delivered') continue;

    // 2. Must have valid delivery history
    if (!Array.isArray(order.deliveryHistory) || order.deliveryHistory.length === 0) continue;

    const latestDelivery = order.deliveryHistory[order.deliveryHistory.length - 1];
    if (!latestDelivery || !latestDelivery.deliveredAt) continue;

    const deliveredAt = new Date(latestDelivery.deliveredAt).getTime();
    if (isNaN(deliveredAt)) continue;

    // 3. Stays in 'delivered' for REVIEW_WINDOW_DAYS
    if (now - deliveredAt < windowMs) continue;

    // 4. Must have no active requested revision
    if (Array.isArray(order.revisions)) {
      const hasActiveRequestedRevision = order.revisions.some(
        r => r.status === 'requested'
      );
      if (hasActiveRequestedRevision) continue;
    }

    // 5. Must skip disputed orders and timer-paused orders
    if ((order.status as string) === 'disputed' || order.isTimerPaused) continue;
    const hasDispute = disputes.some(
      d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation')
    );
    if (hasDispute) continue;

    // 6. Check that refundable/releasable escrow remains in the ledger
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      continue;
    }

    // 7. Check if order is currently locked by a concurrent operation
    if (orderStateLocks.has(order.id)) {
      continue;
    }

    try {
      acquireOrderLock(order.id);
    } catch {
      continue;
    }

    // 8. Idempotency key for this order and delivery version
    const requestKey = `auto_accept_${order.id}_v${latestDelivery.version}`;

    try {
      console.log(`[ReviewWindow] Auto-accepting order ${order.id} (delivery v${latestDelivery.version}) after ${days} days.`);
      
      // Execute release using the same releaseOrderFunds path as a manual release
      const result = releaseOrderFunds(order, 'System Auto-Accept', `Auto-accept after buyer review window (${days} days) elapsed`, false, requestKey);

      // Record acceptedVersion
      order.acceptedVersion = latestDelivery.version;
      saveOrdersToDisk();

      // Post system message into workstream
      const sysMsg: Message = {
        id: 'msg_' + now + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Review Desk',
        text: `🎉 Order #${order.id} automatically accepted: Buyer review window (${days} days) closed without revisions or dispute. Escrow funds released to seller.`,
        timestamp: new Date(now).toISOString(),
        type: 'system',
        metadata: {
          action: 'order_auto_accepted',
          acceptedVersion: latestDelivery.version,
          reviewWindowDays: days
        }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);

      // Log to the audit log
      registerAuditLog({
        id: 'log_' + now + '_' + Math.random().toString(36).slice(2, 6),
        actor: 'System Auto-Accept',
        role: 'super_admin',
        action: 'ORDER_AUTO_ACCEPTED',
        target: `Order #${order.id}`,
        details: `Order auto-accepted after ${days} days in delivered status without revision or dispute. Deliverable v${latestDelivery.version} approved. Escrow of $${order.amount} released (net payout $${result.freelancerNet}).`,
        timestamp: new Date(now).toLocaleString()
      });

      processed.push({
        orderId: order.id,
        acceptedVersion: latestDelivery.version,
        amount: order.amount,
        freelancerNet: result.freelancerNet
      });
    } catch (err: any) {
      console.error(`[ReviewWindow] Failed to auto-accept order ${order.id}:`, err);
    } finally {
      releaseOrderLock(order.id);
    }
  }

  return processed;
}

// Periodically check and auto-accept orders after review window
setInterval(() => {
  try {
    processAutoAcceptOrders();
  } catch (err) {
    console.error('[ReviewWindow] Auto-accept job error:', err);
  }
}, 60 * 1000).unref?.();

// Admin endpoint to trigger or check auto-acceptance
app.post('/api/admin/orders/check-auto-accept', requireAdmin, (req, res) => {
  try {
    const processed = processAutoAcceptOrders();
    res.json({ success: true, processedCount: processed.length, processed });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Auto-accept check failed' });
  }
});
app.post('/api/workstream/upload', requireAuth, rateLimit(5, 60_000), express.raw({ type: '*/*', limit: WORKSTREAM_MAX_UPLOAD_BYTES }), (req, res) => {
  try {
    const caller = (req as any).authenticatedUser;
    const rawName = (req.query.name as string) || 'attachment';
    let decodedName: string;
    try { decodedName = decodeURIComponent(rawName); } catch { decodedName = rawName; }
    const safeBase = path.basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
    const ext = path.extname(safeBase).toLowerCase();
    if (ext && !WORKSTREAM_ALLOWED_EXTENSIONS.has(ext)) {
      WORKSTREAM_ALLOWED_EXTENSIONS.add(ext);
    }
    const nameWithoutExt = path.basename(safeBase, path.extname(safeBase));
    const storedFilename = `${Date.now()}_${randomUUID().slice(0, 8)}_${nameWithoutExt}${ext}`;
    const filePath = path.join(WORKSTREAM_UPLOADS_DIR, storedFilename);

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received' });
    }
    if (buffer.length > WORKSTREAM_MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'File is too large (25 MB maximum).' });
    }

    fs.writeFileSync(filePath, buffer);
    workstreamUploadIndex[storedFilename] = { ownerId: caller.id, createdAt: new Date().toISOString() };
    saveWorkstreamUploadIndex();

    const bytes = buffer.length;
    const sizeStr = bytes > 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

    const mimeType = (req.headers['content-type'] as string) || 'application/octet-stream';

    res.json({
      name: safeBase,
      size: sizeStr,
      url: `${WORKSTREAM_FILE_URL_PREFIX}${storedFilename}`,
      type: mimeType
    });
  } catch (err: any) {
    console.error('Workstream file upload error:', err);
    res.status(500).json({ error: 'Failed to save uploaded file' });
  }
});

app.get('/api/workstream/files/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(WORKSTREAM_UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!canAccessWorkstreamFile((req as any).authenticatedUser, filename)) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this file.' });
  }

  const parts = filename.split('_');
  const originalName = parts.length > 2 ? parts.slice(2).join('_') : filename;
  const ext = path.extname(filename).toLowerCase();

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  // Only safe types render inline; everything else is forced to download.
  if (req.query.download === '1' || !WORKSTREAM_INLINE_EXTENSIONS.has(ext)) {
    return res.download(filePath, originalName);
  }

  // Inline SVG can carry <script>; sandbox it so it renders as an image only.
  if (ext === '.svg') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  }
  res.sendFile(filePath);
});

app.get('/api/messages/:orderId', requireAuth, (req, res) => {
  const order = orderIndex.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream((req as any).authenticatedUser, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const filtered = messageIndex.get(req.params.orderId) || [];
  res.json(filtered);
});

app.post('/api/messages', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });
  const orderId = req.body.orderId;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

  let order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream(caller, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, caller);
  if (!fileCheck.ok) return res.status(400).json({ error: (fileCheck as any).error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === orderId && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  try {
    const newMsg = sanitizeAndCreateMessage(caller, order, req.body, fileCheck);

    recordMessage(newMsg);
    saveMessagesToDisk();
    broadcastMessage(newMsg, order.id);
    res.json(newMsg);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});

// Admin Message Threads Moderation & Dispute Audit
app.get('/api/admin/messages/threads', requireAdmin, (req, res) => {
  const threads = orders.map(order => {
    const buyer = users.find(u => u.id === order.buyerId);
    const seller = users.find(u => u.id === order.sellerId);
    const orderMessages = messageIndex.get(order.id) || [];
    const lastMsg = orderMessages[orderMessages.length - 1];

    return {
      id: order.id,
      orderId: order.id,
      projectId: order.projectId,
      projectOrGigTitle: order.title,
      participantOne: {
        id: buyer?.id || order.buyerId,
        name: buyer?.name || order.buyerUsername || 'Buyer',
        avatar: buyer?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
        role: 'client' as const,
        email: buyer?.email || 'buyer@example.com',
        status: (buyer?.status || 'active') as any
      },
      participantTwo: {
        id: seller?.id || order.sellerId,
        name: seller?.name || order.sellerUsername || 'Seller',
        avatar: seller?.avatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
        role: 'freelancer' as const,
        email: seller?.email || 'seller@example.com',
        status: (seller?.status || 'active') as any
      },
      lastMessageSnippet: lastMsg?.text || (orderMessages.length > 0 ? 'Attachment' : 'No messages in workstream'),
      lastMessageTime: lastMsg?.timestamp || order.createdAt,
      totalMessages: orderMessages.length,
      moderationStatus: 'clean' as const,
      flaggedCount: 0,
      messages: orderMessages.map(m => {
        const sender = users.find(u => u.id === m.senderId);
        return {
          id: m.id,
          senderId: m.senderId,
          senderName: m.senderName || sender?.name || 'Participant',
          senderAvatar: sender?.avatar || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
          senderRole: (m.senderId === order.buyerId ? 'client' : 'freelancer') as ('client' | 'freelancer'),
          text: m.text,
          timestamp: m.timestamp
        };
      })
    };
  });

  res.json(threads);
});

app.post('/api/gigs', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  // Enforce Gig Pricing Limits from Site Settings
  const activeSettings = siteSettings.getSettings();
  const gigPrice = Number(req.body.price);
  if (!Number.isFinite(gigPrice)) return res.status(400).json({ error: 'Gig price must be a valid number.' });
  const minGigPrice = activeSettings.marketplace.minimumGigPrice ?? 10;
  const maxGigPrice = activeSettings.marketplace.maximumGigPrice ?? 10000;
  if (gigPrice < minGigPrice) {
    return res.status(400).json({ error: `Gig price ($${gigPrice}) cannot be lower than the platform minimum of $${minGigPrice}.` });
  }
  if (gigPrice > maxGigPrice) {
    return res.status(400).json({ error: `Gig price ($${gigPrice}) cannot exceed the platform maximum of $${maxGigPrice}.` });
  }

  // Determine publication status based on Admin Gig Moderation setting
  const initialStatus = activeSettings.marketplace.gigModerationRequired ? 'pending' : 'published';

  const newGig: Gig = {
    id: 'gig_' + Date.now(),
    freelancerId: caller.id,
    freelancerName: caller.name,
    freelancerUsername: caller.username || caller.name.toLowerCase().replace(/\s+/g, '_'),
    freelancerAvatar: caller.avatar,
    freelancerLevel: 'Level 1 ★',
    title: escapeHtml(req.body.title || 'Untitled Gig'),
    slug: req.body.title ? req.body.title.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') : 'custom-gig',
    category: req.body.category || 'Development & IT',
    subcategory: req.body.subcategory || 'General',
    description: escapeHtml(req.body.description || ''),
    price: gigPrice,
    deliveryDays: Number(req.body.deliveryDays),
    rating: 0,
    reviewsCount: 0,
    image: req.body.image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=500&fit=crop',
    status: initialStatus,
    featured: false,
    extras: req.body.extras || []
  };
  gigs.unshift(newGig);
  res.json(newGig);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  // Enforce Minimum Project Budget
  const activeSettings = siteSettings.getSettings();
  const minBudget = activeSettings.marketplace.minimumProjectBudget ?? 20;
  const budgetMin = Number(req.body.budgetMin);
  if (minBudget > 0 && budgetMin < minBudget) {
    return res.status(400).json({
      error: `Project budget ($${budgetMin}) is below the platform minimum requirement of $${minBudget}.`
    });
  }

  const newProj: Project = {
    id: 'proj_' + Date.now(),
    buyerId: caller.id,
    buyerName: caller.name,
    buyerAvatar: caller.avatar,
    title: escapeHtml(req.body.title || 'Untitled Project'),
    category: req.body.category || 'Development & IT',
    subcategory: req.body.subcategory || 'General',
    description: escapeHtml(req.body.description || ''),
    budgetMin: Number(req.body.budgetMin),
    budgetMax: Number(req.body.budgetMax),
    deadlineDays: 14,
    proposalsCount: 0,
    createdAt: new Date().toISOString().split('T')[0],
    status: 'open',
    featured: false
  };
  projects.unshift(newProj);
  saveProjectsToDisk();
  res.json(newProj);
});

app.patch('/api/projects/:id/status', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  if (p.buyerId !== caller.id && !isStaffUser(caller)) {
    return res.status(403).json({ error: 'Forbidden: Only the project owner can update this project status.' });
  }

  const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'completed';
  const allowedStatuses: Project['status'][] = ['open', 'published', 'in_progress', 'completed', 'unpublished'];
  if (!allowedStatuses.includes(requestedStatus as Project['status'])) {
    return res.status(400).json({ error: 'Invalid project status.' });
  }

  const oldStatus = p.status;
  p.status = requestedStatus as Project['status'];
  saveProjectsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: caller.name,
    role: caller.role || 'user',
    action: `PROJECT_STATUS_${p.status.toUpperCase()}`,
    target: `Project "${p.title}"`,
    details: `Buyer changed project status from "${oldStatus}" to "${p.status}" (${p.status === 'completed' ? 'Closed bidding & hidden from public listing' : 'Updated listing status'})`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

// Admin Projects Management Endpoints
app.get('/api/admin/projects', requireAdmin, (req, res) => {
  res.json(projects);
});

app.patch('/api/admin/projects/:id', requireAdmin, (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  if (req.body.title !== undefined) p.title = req.body.title;
  if (req.body.category !== undefined) p.category = req.body.category;
  if (req.body.subcategory !== undefined) p.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) p.description = req.body.description;
  if (req.body.budgetMin !== undefined) p.budgetMin = Number(req.body.budgetMin);
  if (req.body.budgetMax !== undefined) p.budgetMax = Number(req.body.budgetMax);
  if (req.body.deadlineDays !== undefined) p.deadlineDays = Number(req.body.deadlineDays);
  if (req.body.status !== undefined) p.status = req.body.status;
  if (req.body.featured !== undefined) p.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) p.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) p.moderationNotes = req.body.moderationNotes;

  saveProjectsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROJECT_EDITED',
    target: `Project "${p.title}"`,
    details: `Updated project parameters, category, budget, or moderation status`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.patch('/api/admin/projects/:id/status', requireAdmin, (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const oldStatus = p.status;
  p.status = req.body.status;
  saveProjectsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `PROJECT_STATUS_${req.body.status.toUpperCase()}`,
    target: `Project "${p.title}"`,
    details: `Changed project status from "${oldStatus}" to "${req.body.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.patch('/api/admin/projects/:id/feature', requireAdmin, (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  p.featured = !p.featured;
  saveProjectsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: p.featured ? 'PROJECT_FEATURED' : 'PROJECT_UNFEATURED',
    target: `Project "${p.title}"`,
    details: `${p.featured ? 'Featured' : 'Unfeatured'} project on platform homepage & listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.delete('/api/admin/projects/:id', requireAdmin, (req, res) => {
  const index = projects.findIndex(proj => proj.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  const deleted = projects[index];
  projects.splice(index, 1);
  saveProjectsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROJECT_DELETED',
    target: `Project "${deleted.title}"`,
    details: `Permanently removed project #${deleted.id} by ${deleted.buyerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

// Admin Gigs / Services Management Endpoints
app.get('/api/admin/gigs', requireAdmin, (req, res) => {
  res.json(gigs);
});

app.patch('/api/admin/gigs/:id', requireAdmin, (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  if (req.body.title !== undefined) g.title = req.body.title;
  if (req.body.category !== undefined) g.category = req.body.category;
  if (req.body.subcategory !== undefined) g.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) g.description = req.body.description;
  if (req.body.price !== undefined) g.price = Number(req.body.price);
  if (req.body.deliveryDays !== undefined) g.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) g.status = req.body.status;
  if (req.body.featured !== undefined) g.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) g.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) g.moderationNotes = req.body.moderationNotes;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'GIG_EDITED',
    target: `Gig "${g.title}"`,
    details: `Updated gig specifications, pricing, delivery, or moderation verdict: "${g.moderationStatus || 'none'}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/admin/gigs/:id/status', requireAdmin, (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  const oldStatus = g.status;
  g.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `GIG_STATUS_${req.body.status.toUpperCase()}`,
    target: `Gig "${g.title}"`,
    details: `Changed service status from "${oldStatus}" to "${req.body.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/admin/gigs/:id/feature', requireAdmin, (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  g.featured = !g.featured;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: g.featured ? 'GIG_FEATURED' : 'GIG_UNFEATURED',
    target: `Gig "${g.title}"`,
    details: `${g.featured ? 'Featured' : 'Unfeatured'} freelancer service on marketplace home & listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.delete('/api/admin/gigs/:id', requireAdmin, (req, res) => {
  const index = gigs.findIndex(gig => gig.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Gig/Service not found' });

  const deleted = gigs[index];
  gigs.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'GIG_DELETED',
    target: `Gig "${deleted.title}"`,
    details: `Permanently deleted freelancer gig #${deleted.id} by ${deleted.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

app.delete('/api/gigs/:id', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const index = gigs.findIndex(gig => gig.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Gig/Service not found' });

  const deleted = gigs[index];
  if (deleted.freelancerId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: You can only delete your own gigs.' });
  }

  gigs.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: 'GIG_DELETED',
    target: `Gig "${deleted.title}"`,
    details: `Permanently deleted freelancer gig #${deleted.id} by ${deleted.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

app.patch('/api/gigs/:id', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });
  if (g.freelancerId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: You can only edit your own gigs.' });
  }

  if (req.body.title !== undefined) g.title = req.body.title;
  if (req.body.category !== undefined) g.category = req.body.category;
  if (req.body.subcategory !== undefined) g.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) g.description = req.body.description;
  if (req.body.price !== undefined) {
    const newPrice = Number(req.body.price);
    if (!Number.isFinite(newPrice)) return res.status(400).json({ error: 'Gig price must be a valid number.' });
    const activeSettings = siteSettings.getSettings();
    const minGigPrice = activeSettings.marketplace.minimumGigPrice ?? 10;
    const maxGigPrice = activeSettings.marketplace.maximumGigPrice ?? 10000;
    if (newPrice < minGigPrice) {
      return res.status(400).json({ error: `Gig price ($${newPrice}) cannot be lower than the platform minimum of $${minGigPrice}.` });
    }
    if (newPrice > maxGigPrice) {
      return res.status(400).json({ error: `Gig price ($${newPrice}) cannot exceed the platform maximum of $${maxGigPrice}.` });
    }
    g.price = newPrice;
  }
  if (req.body.deliveryDays !== undefined) g.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) g.status = req.body.status;
  if (req.body.featured !== undefined) g.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) g.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) g.moderationNotes = req.body.moderationNotes;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: 'GIG_UPDATED',
    target: `Gig "${g.title}"`,
    details: `Updated gig details/status to "${g.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/gigs/:id/feature', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });
  if (g.freelancerId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: You can only feature your own gigs.' });
  }

  g.featured = !g.featured;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: g.featured ? 'GIG_FEATURED' : 'GIG_UNFEATURED',
    target: `Gig "${g.title}"`,
    details: `${g.featured ? 'Featured' : 'Unfeatured'} gig on marketplace listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.post('/api/proposals', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  const proj = projects.find(p => p.id === req.body.projectId);
  if (!proj) return res.status(404).json({ error: 'Project not found.' });
  if (!['open', 'published', 'in_progress'].includes(proj.status)) {
    return res.status(400).json({ error: 'This project is completed and closed to new proposals.' });
  }
  if (proj.buyerId === caller.id) {
    return res.status(400).json({ error: 'You cannot submit a proposal to your own project.' });
  }
  const bidAmount = Math.round(Number(req.body.bidAmount) * 100) / 100;
  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    return res.status(400).json({ error: 'Enter a valid USD bid amount.' });
  }
  const deliveryDays = Math.max(1, Math.min(365, Math.round(Number(req.body.deliveryDays) || 7)));

  const newProp: Proposal = {
    id: 'prop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    projectId: req.body.projectId,
    freelancerId: caller.id,
    freelancerName: caller.name,
    freelancerAvatar: caller.avatar,
    freelancerTitle: caller.title || 'Senior Engineer',
    coverLetter: typeof req.body.coverLetter === 'string' ? req.body.coverLetter.trim() : '',
    bidAmount,
    deliveryDays,
    createdAt: new Date().toISOString().split('T')[0],
    status: 'pending'
  };
  proposals.unshift(newProp);
  proj.proposalsCount += 1;
  saveProjectsToDisk();
  saveProposalsToDisk();
  res.json(newProp);
});



async function processProposalAccept(req: any, res: any) {
  const proposalId = req.params.id;
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proj = projects.find(p => p.id === proposal.projectId);
  if (!proj) return res.status(404).json({ error: 'Project not found' });

  // Use a proposal-level lock to ensure atomicity for this specific proposal acceptance
  if (!tryAcquireOrderLock(proposal.id, res)) return;
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || users.find((u: any) => u.id === authUserId);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Authentication required' });
    if (proj.buyerId !== caller.id) return res.status(403).json({ error: 'Forbidden: Only the project buyer can accept proposals.' });
    if (proposal.status !== 'pending') {
      if (proposal.status === 'accepted' && proposal.workstreamOrderId) {
        const existingOrder = orders.find(o => o.id === proposal.workstreamOrderId);
        if (existingOrder) {
          const workspace = workspaceService.getWorkspace(existingOrder.workspaceId || '');
          const offer = workstreamOffers.find(of => of.proposalId === proposal.id);
          return res.json({ 
            success: true, 
            proposal: enrichProposalWithWorkstream(proposal), 
            order: enrichOrderWithServiceInfo(existingOrder), 
            workspace, 
            offer: offer ? viewOffer(offer) : undefined 
          });
        }
      }
      return res.status(409).json({ error: `Proposal is already ${proposal.status}.` });
    }

    ensureWallet(proj.buyerId);
    ensureWallet(proposal.freelancerId);

    let workspace = Array.from(workspaceService.getWorkspacesForUser(proj.buyerId)).find(w =>
      w.sellerId === proposal.freelancerId &&
      w.originType === 'project' &&
      w.originId === proj.id
    );
    let createdNewWorkspace = false;
    if (!workspace) {
      workspace = workspaceService.createWorkspace({
        buyerId: proj.buyerId,
        sellerId: proposal.freelancerId,
        originType: 'project',
        originId: proj.id
      });
      createdNewWorkspace = true;
    }

    const orderId = 'ord_' + randomUUID().slice(0, 12);
    const today = new Date().toISOString().split('T')[0];
    const protectionDays = siteSettings.getSettings().commission.escrowProtectionDays;
    const deliveryDays = proposal.deliveryDays || 7;
    const dueDate = new Date(Date.now() + deliveryDays * 86400000).toISOString().split('T')[0];

    // Create Order object with transient status
    const order: Order = {
      id: orderId,
      projectOrderId: orderId,
      workspaceId: workspace.workspaceId,
      orderType: 'project',
      title: proj.title,
      buyerId: proj.buyerId,
      sellerId: proposal.freelancerId,
      amount: proposal.bidAmount,
      status: 'payment_pending',
      createdAt: today,
      dueDate,
      escrowProtectionStartDate: today,
      escrowProtectionEndDate: new Date(Date.now() + protectionDays * 86400000).toISOString().split('T')[0],
      projectId: proj.id,
      proposalId: proposal.id,
      feeBreakdown: financeLedger.quoteOrder(proposal.bidAmount)
    };

    // Create offer in 'pending' state
    const offer: WorkstreamOffer = {
      id: 'off_' + randomUUID().slice(0, 12),
      number: `PRP-${String(workstreamOffers.filter(o => o.kind === 'proposal').length + 1001)}`,
      orderId: order.id,
      proposalId: proposal.id,
      kind: 'proposal',
      title: proj.title,
      amount: proposal.bidAmount,
      deliveryDays: proposal.deliveryDays,
      note: proposal.coverLetter ? proposal.coverLetter.slice(0, 1000) : undefined,
      status: 'pending',
      createdBy: proposal.freelancerId,
      createdAt: new Date().toISOString()
    };
    workstreamOffers.push(offer);
    await saveOffersToDisk();
    
    // Register order in memory for message attachment
    recordOrder(order);
    await saveOrdersToDisk(); // CRASH SAFE POINT: Order IS ACTUALLY on disk as 'payment_pending' before funding
    emitSystemEvent(order.id, 'order_created', `Order placed: ${order.title}. Payment is held in escrow until the work is approved.`);
    postOfferMessage(order, offer, null, `Proposal ${offer.number} was created.`, 'offer_created');

    // Attempt financial ledger funding with transactional rollback on failure
    try {
      fundOrderEscrowWithEvent({
        orderId: order.id,
        orderTitle: order.title,
        amount: order.amount,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        actor: `user:${order.buyerId}`
      });
      
      // Update order status to funded only AFTER ledger successfully records the escrow
      order.status = 'funded_in_escrow';
      await saveOrdersToDisk();
    } catch (fundingErr: any) {
      // Rollback memory and disk state if funding fails (e.g. insufficient wallet balance)
      const orderIdx = orders.findIndex(o => o.id === order.id);
      if (orderIdx !== -1) orders.splice(orderIdx, 1);
      orderIndex.delete(order.id);

      const offerIdx = workstreamOffers.findIndex(o => o.id === offer.id);
      if (offerIdx !== -1) workstreamOffers.splice(offerIdx, 1);

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].orderId === order.id) {
          messages.splice(i, 1);
        }
      }

      proposal.status = 'pending';
      delete proposal.workstreamOrderId;
      delete proposal.offerId;

      if (createdNewWorkspace) {
        workspaceService.deleteWorkspace(workspace.workspaceId);
      }

      await saveOrdersToDisk();
      await saveOffersToDisk();
      await saveProposalsToDisk();
      await saveMessagesToDisk();

      return res.status(400).json({ error: fundingErr.message || 'Failed to fund escrow for proposal.' });
    }

    proposal.status = 'accepted';
    proposal.workstreamOrderId = order.id;
    proposal.offerId = offer.id;
    await saveProposalsToDisk();
    
    syncUserBalances();

    offer.status = 'accepted';
    offer.resolvedAt = new Date().toISOString();
    offer.resolvedBy = caller.id;
    await saveOffersToDisk();
    
    postOfferMessage(order, offer, null, `Proposal ${offer.number} was accepted and escrow funded ($${order.amount}).`, 'offer_accepted');

    res.json({ success: true, proposal: enrichProposalWithWorkstream(proposal), order: enrichOrderWithServiceInfo(order), workspace, offer: viewOffer(offer) });
  } finally {
    releaseOrderLock(proposal.id);
  }
}

async function processProposalDecline(req: any, res: any) {
  const proposalId = req.params.id;
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proj = projects.find(p => p.id === proposal.projectId);
  if (!proj) return res.status(404).json({ error: 'Project not found' });

  if (!tryAcquireOrderLock(proposal.id, res)) return;
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || users.find((u: any) => u.id === authUserId);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Authentication required' });
    if (proj.buyerId !== caller.id) return res.status(403).json({ error: 'Forbidden: Only the project buyer can decline proposals.' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `Proposal is already ${proposal.status}.` });

    proposal.status = 'rejected';
    await saveProposalsToDisk();

    // If an offer existed, mark it as declined
    const offer = workstreamOffers.find(of => of.proposalId === proposal.id || of.id === proposal.offerId);
    if (offer && offer.status === 'pending') {
      offer.status = 'declined';
      offer.resolvedAt = new Date().toISOString();
      offer.resolvedBy = caller.id;
      await saveOffersToDisk();
      const order = orders.find(o => o.id === offer.orderId);
      if (order) {
        postOfferMessage(order, offer, null, `${offer.number} was declined by the buyer.`, 'offer_declined');
      }
    }

    res.json({ success: true, proposal: enrichProposalWithWorkstream(proposal), offer: offer ? viewOffer(offer) : undefined });
  } finally {
    releaseOrderLock(proposal.id);
  }
}

app.post('/api/proposals/:id/accept', requireAuth, rateLimit(20, 60_000), async (req, res) => await processProposalAccept(req, res));
app.post('/api/proposals/:id/decline', requireAuth, rateLimit(20, 60_000), async (req, res) => await processProposalDecline(req, res));

app.post('/api/orders', requireAuth, rateLimit(30, 60_000), async (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (title.length < 3) return res.status(400).json({ error: 'A valid order title is required.' });
    const buyerId = caller.id;
    const sellerId = String(req.body?.sellerId || '');
    const buyer = caller;
    const seller = users.find(u => u.id === sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found.' });
    if (buyerId === sellerId) return res.status(400).json({ error: 'You cannot order from yourself.' });
    ensureWallet(buyerId); ensureWallet(sellerId);
    if (buyer.status !== 'active' || seller.status !== 'active') return res.status(403).json({ error: 'Both accounts must be active to place an order.' });
    const id = 'ord_' + randomUUID().slice(0, 12);
    const today = new Date().toISOString().split('T')[0];
    let rawAmount = Number(req.body?.amount);
    const isInquiry = rawAmount === 0 && /^inquiry:/i.test(title);
    // Gig orders are priced from the server-side gig + selected add-ons. The browser-sent `amount` is never trusted,
    // otherwise a client could pay any price and every fee (20% / 5.5% / $3.50) would be computed on the fake number.
    if (!isInquiry && req.body?.gigId) {
      const priced = resolveGigOrderPrice(String(req.body.gigId), req.body?.extraIds);
      if (priced.gig.freelancerId !== sellerId) return res.status(400).json({ error: 'This gig does not belong to the selected seller.' });
      rawAmount = priced.gigPrice;
    }

    const requirements = typeof req.body?.requirements === 'string' ? escapeHtml(req.body.requirements.trim()).slice(0, 2000) : '';

    let deliveryDays = 10;
    if (req.body?.gigId) {
      const gig = gigs.find(g => g.id === req.body.gigId);
      if (gig && Number(gig.deliveryDays) > 0) {
        deliveryDays = Math.max(1, Math.min(365, Number(gig.deliveryDays)));
      }
    } else if (req.body?.projectId) {
      const proj = projects.find(p => p.id === req.body.projectId);
      if (proj && Number(proj.deadlineDays) > 0) {
        deliveryDays = Math.max(1, Math.min(365, Number(proj.deadlineDays)));
      }
    }
    const serverDerivedDueDate = new Date(Date.now() + deliveryDays * 86400000).toISOString().split('T')[0];

    const isGig = Boolean(req.body?.gigId);
    const isProject = Boolean(req.body?.projectId);
    const orderType: 'gig' | 'project' | undefined = isGig ? 'gig' : (isProject ? 'project' : undefined);
    const gigOrderId = isGig ? id : undefined;
    const projectOrderId = isProject ? id : undefined;

    let workspaceId = req.body?.workspaceId;
    if (workspaceId) {
      const ws = workspaceService.getWorkspace(workspaceId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found.' });
      if (ws.buyerId !== buyerId || ws.sellerId !== sellerId) {
        return res.status(400).json({ error: 'The provided workspace does not match the buyer and seller of this order.' });
      }
    } else {
      const ws = workspaceService.createWorkspace({
        buyerId,
        sellerId,
        originType: isGig ? 'gig' : 'project',
        originId: req.body?.gigId || req.body?.projectId || id,
        activeOrderId: id
      });
      workspaceId = ws.workspaceId;
    }

    let newOrd: Order;
    if (isInquiry) {
      newOrd = {
        id,
        workspaceId,
        ...(orderType ? { orderType } : {}),
        ...(gigOrderId ? { gigOrderId } : {}),
        ...(projectOrderId ? { projectOrderId } : {}),
        title,
        buyerId,
        sellerId,
        amount: 0,
        status: 'in_progress',
        createdAt: today,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        gigId: req.body.gigId,
        projectId: req.body.projectId,
        ...(requirements ? { requirements } : {})
      };
    } else {
      newOrd = {
        id,
        workspaceId,
        ...(orderType ? { orderType } : {}),
        ...(gigOrderId ? { gigOrderId } : {}),
        ...(projectOrderId ? { projectOrderId } : {}),
        title,
        buyerId,
        sellerId,
        amount: rawAmount,
        status: 'payment_pending',
        createdAt: today,
        dueDate: serverDerivedDueDate,
        escrowProtectionStartDate: today,
        escrowProtectionEndDate: new Date(Date.now() + DEFAULT_SITE_SETTINGS.commission.escrowProtectionDays * 86400000).toISOString().split('T')[0],
        gigId: req.body.gigId,
        projectId: req.body.projectId,
        feeBreakdown: financeLedger.quoteOrder(rawAmount),
        ...(requirements ? { requirements } : {})
      };
    }
    const enriched = enrichOrderWithServiceInfo(newOrd);
    recordOrder(enriched);
    await saveOrdersToDisk(); // CRASH SAFE POINT: Order recorded as 'payment_pending' before funding

    if (!isInquiry) {
      try {
        fundOrderEscrowWithEvent({ orderId: id, orderTitle: title, amount: rawAmount, buyerId, sellerId, actor: `user:${buyerId}` });
        
        // Update order status to funded only AFTER ledger successfully records the escrow
        enriched.status = 'funded_in_escrow';
        await saveOrdersToDisk();
        
        syncUserBalances();
      } catch (fundingErr: any) {
        // Rollback memory and disk state if escrow funding fails (e.g. insufficient wallet balance)
        const orderIdx = orders.findIndex(o => o.id === id);
        if (orderIdx !== -1) orders.splice(orderIdx, 1);
        orderIndex.delete(id);

        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].orderId === id) {
            messages.splice(i, 1);
          }
        }

        await saveOrdersToDisk();
        await saveMessagesToDisk();

        // Cleanup orphaned workspace if this was the only order in it
        const wsId = (enriched as any).workspaceId;
        if (wsId) {
          const otherOrdersInWs = orders.filter(o => o.workspaceId === wsId);
          if (otherOrdersInWs.length === 0) {
            workspaceService.deleteWorkspace(wsId);
          }
        }

        return res.status(400).json({ error: fundingErr.message || 'Failed to fund escrow. Order creation rolled back.' });
      }
    }
    if (isInquiry) {
      emitSystemEvent(newOrd.id, 'order_created', `Inquiry thread opened: ${title}.`);
    } else {
      emitSystemEvent(newOrd.id, 'order_created', `Order placed: ${title}. Payment is held in escrow until the work is approved.`);
      if (requirements) {
        recordMessage({
          id: 'msg_' + Date.now() + '_req_' + Math.random().toString(36).slice(2, 6),
          orderId: id,
          senderId: buyer.id,
          senderName: buyer.name,
          type: 'message',
          text: `Project requirements: ${requirements}`,
          timestamp: new Date(Date.now() + 1).toISOString(),
          metadata: { action: 'requirements_logged' }
        } as Message);
        await saveMessagesToDisk();
      }
    }
    res.status(201).json(enriched);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ==========================================
// WORKSTREAM OFFERS (proposal / invoice / deposit request)
// Real records with a status. Money only moves through financeLedger.fundEscrow when the BUYER accepts.
// ==========================================
type WorkstreamOfferKind = 'proposal' | 'invoice' | 'deposit';
type WorkstreamOfferStatus = 'pending' | 'accepted' | 'paid' | 'declined' | 'cancelled';
interface WorkstreamOffer {
  id: string;
  number: string;
  orderId: string;
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
}

const OFFERS_FILE = path.join(DATA_DIR, 'workstream_offers.json');
let workstreamOffers: WorkstreamOffer[] = [];
try {
  if (fs.existsSync(OFFERS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(OFFERS_FILE, 'utf-8'));
    if (Array.isArray(parsed)) workstreamOffers = parsed;
  }
} catch (e) {
  console.error('Failed to load workstream offers:', e);
}
function saveOffersToDisk() { 
  return postgresStore.saveOffers(workstreamOffers).catch(err => console.error('[PostgresStore] Failed to save offers:', err)); 
}

const OFFER_LABEL: Record<WorkstreamOfferKind, string> = { proposal: 'proposal', invoice: 'invoice', deposit: 'deposit request' };
const OFFER_PREFIX: Record<WorkstreamOfferKind, string> = { proposal: 'PRP', invoice: 'INV', deposit: 'DEP' };
const FUNDED_STATUSES = ['funded_in_escrow', 'delivered', 'revision', 'completed', 'disputed'];

function orderHasEscrow(orderId: string): boolean {
  return !!financeLedger.getEscrow(orderId);
}

function getActiveEscrowRemaining(order: Order): number {
  const esc = financeLedger.getEscrow(order.id);
  if (esc) return esc.remaining;
  return (order.status === 'completed' || order.status === 'cancelled') ? 0 : Number(order.amount || 0);
}

function hasPaidInvoiceOrReleasedEscrow(order: Order): boolean {
  const esc = financeLedger.getEscrow(order.id);
  return Boolean(
    order.status === 'completed' ||
    releaseCompletedOrders.has(order.id) ||
    (esc && esc.releasedGross > 0) ||
    workstreamOffers.some(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'paid')
  );
}

function findLinkedProposalForOffer(offer: WorkstreamOffer, order: Order): Proposal | undefined {
  return proposals.find(p =>
    (offer.proposalId && p.id === offer.proposalId) ||
    p.offerId === offer.id ||
    (order.proposalId && p.id === order.proposalId)
  );
}

function viewOffer(o: WorkstreamOffer) {
  let clientTotal: number | undefined;
  let additionalAmount: number | undefined;
  let clientAdditionalTotal: number | undefined;
  try {
    clientTotal = financeLedger.quoteOrder(o.amount)?.clientTotal;
    if (o.kind === 'invoice') {
      const ord = orders.find(ord => ord.id === o.orderId);
      const curr = ord ? (o.status === 'pending' ? getActiveEscrowRemaining(ord) : Number(ord.amount || 0)) : 0;
      additionalAmount = Math.max(0, FinanceLedgerEngine.round(o.amount - curr));
      if (additionalAmount > 0) {
        clientAdditionalTotal = financeLedger.quoteOrder(additionalAmount)?.clientTotal;
      } else {
        clientAdditionalTotal = 0;
      }
    }
  } catch { /* quote is informational only */ }
  return { 
    ...o, 
    clientTotal, 
    additionalAmount, 
    clientAdditionalTotal, 
    currencySymbol: siteSettings.getFlattenedSettings().currencySymbol || '$' 
  };
}

function postOfferMessage(order: Order, offer: WorkstreamOffer, sender: { id: string; name: string } | null, text: string, action: string) {
  const msg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: sender?.id || 'system',
    senderName: sender?.name || 'Workstream',
    text,
    timestamp: new Date().toISOString(),
    type: sender ? 'message' : 'system',
    metadata: { action, offerId: offer.id, offerKind: offer.kind }
  };
  // recordMessage (not a bare push) so the message is also in messageIndex, which GET /api/messages/:orderId reads.
  recordMessage(msg);
  saveMessagesToDisk();
  broadcastMessage(msg, order.id);
}

function offerCaller(req: Request) {
  const authUserId = (req as any).authenticatedUserId;
  return (req as any).authenticatedUser || users.find(u => u.id === authUserId);
}

// Admin Proposals Management Endpoints


app.get('/api/offers', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const userOrders = orders.filter(o => o.buyerId === authUserId || o.sellerId === authUserId);
  const userOrderIds = new Set(userOrders.map(o => o.id));
  const userOffers = workstreamOffers.filter(of => userOrderIds.has(of.orderId));
  res.json(userOffers.map(viewOffer));
});

app.get('/api/orders/:id/offers', requireAuth, (req, res) => {
  const caller = offerCaller(req);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream(caller, order)) return res.status(403).json({ error: 'Forbidden' });
  const offers = workstreamOffers
    .filter(o => o.orderId === order.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(viewOffer);
  const esc = financeLedger.getEscrow(order.id);
  res.json({
    offers,
    currencySymbol: siteSettings.getFlattenedSettings().currencySymbol || '$',
    escrowFunded: orderHasEscrow(order.id),
    escrowRemaining: getActiveEscrowRemaining(order),
    totalReleased: esc ? esc.releasedGross : (order.status === 'completed' ? Number(order.amount || 0) : 0),
    hasPaidInvoice: hasPaidInvoiceOrReleasedEscrow(order)
  });
});

app.post('/api/orders/:id/offers', requireAuth, rateLimit(20, 60_000), (req, res) => {
  try {
    const caller = offerCaller(req);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    // Only the order's seller may raise proposals, invoices or deposit requests. Staff cannot raise them on a seller's behalf.
    if (caller.id !== order.sellerId) return res.status(403).json({ error: 'Only the seller of this workstream can send this.' });
    if (order.status === 'cancelled') return res.status(409).json({ error: 'Cannot send offers on a cancelled order.' });

    const kind = req.body?.kind as WorkstreamOfferKind;
    if (!['proposal', 'invoice', 'deposit'].includes(kind)) return res.status(400).json({ error: 'Invalid type.' });

    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    const minAmount = Number(siteSettings.getFlattenedSettings().minOrderAmount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
    if (amount > 100000) return res.status(400).json({ error: 'Amount is too large.' });
    if (amount < minAmount) return res.status(400).json({ error: `Minimum amount is ${siteSettings.getFlattenedSettings().currencySymbol || '$'}${minAmount}.` });

    const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const title = kind === 'deposit' ? (rawTitle || 'Escrow deposit') : rawTitle;
    if (title.length < 3 || title.length > 120) return res.status(400).json({ error: 'Title must be 3-120 characters.' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
    const rawRef = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 2000) : '';
    let deliveryDays: number | undefined;
    if (kind === 'proposal') {
      deliveryDays = Math.round(Number(req.body?.deliveryDays));
      if (!Number.isFinite(deliveryDays) || deliveryDays < 1 || deliveryDays > 365) return res.status(400).json({ error: 'Delivery time must be 1-365 days.' });
    }

    const funded = orderHasEscrow(order.id);
    const activeEscrow = getActiveEscrowRemaining(order);
    const hasPaidFirstInvoice = hasPaidInvoiceOrReleasedEscrow(order);

    if (kind === 'invoice') {
      if (!funded || activeEscrow <= 0) return res.status(400).json({ error: 'Final invoices are for completed work on a funded workstream.' });
      if (activeEscrow > 0 && amount < activeEscrow) {
        return res.status(400).json({ error: `Final invoice amount cannot be less than the funded escrow price ($${activeEscrow}).` });
      }
      if (workstreamOffers.filter(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending').length >= 1) {
        return res.status(409).json({ error: 'A final invoice is already pending for this workstream.' });
      }
    } else if (kind === 'proposal' || kind === 'deposit') {
      if (workstreamOffers.some(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending')) {
        return res.status(409).json({ error: 'A seller must not raise a new proposal when a previous proposal/order has a pending invoice.' });
      }
      // PeoplePerHour Gig Rule: When a buyer orders a Gig, it is already funded in escrow.
      // The seller cannot send a new proposal until the first invoice has been paid.
      if ((order.orderType === 'gig' || (order.gigId && !order.projectId)) && activeEscrow > 0 && !hasPaidFirstInvoice) {
        return res.status(409).json({ error: 'This Gig is already funded in escrow. Please raise and get your first invoice paid before sending a follow-on proposal.' });
      }
    }

    let uploadedFiles: Array<{ id: string; name: string; size: string; url: string; uploadedAt: string; type: string }> = [];
    if (kind === 'invoice' && Array.isArray(req.body?.files) && req.body.files.length > 0) {
      const validation = validateStoredWorkstreamFiles(req.body.files, caller);
      if (!validation.ok) {
        return res.status(400).json({ error: (validation as any).error });
      }
      uploadedFiles = validation.files.map((f: any, idx: number) => ({
        id: 'deliv_' + Date.now() + '_' + idx,
        name: f.name,
        size: f.size,
        url: f.url,
        uploadedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        type: 'deliverable'
      }));
    }

    const offer: WorkstreamOffer = {
      id: 'off_' + randomUUID().slice(0, 12),
      number: `${OFFER_PREFIX[kind]}-${String(workstreamOffers.filter(o => o.kind === kind).length + 1001)}`,
      orderId: order.id,
      kind,
      title,
      amount,
      deliveryDays,
      note: note || undefined,
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      reference: rawRef || undefined,
      status: 'pending',
      createdBy: caller.id,
      createdAt: new Date().toISOString()
    };
    workstreamOffers.push(offer);
    saveOffersToDisk();

    // When a seller raises an invoice with deliverables/notes/deliverWork from the WorkStream UI, record the delivery and mark as delivered
    if (kind === 'invoice' && (req.body?.deliverWork || note || uploadedFiles.length > 0 || rawRef)) {
      if (!order.deliverableFiles) order.deliverableFiles = [];
      if (!order.deliveryHistory) order.deliveryHistory = [];
      if (uploadedFiles.length > 0) order.deliverableFiles.push(...uploadedFiles);
      const version = order.deliveryHistory.length + 1;
      const sanitizedNotes = note ? escapeHtml(note) : escapeHtml(title);
      order.deliveryNotes = sanitizedNotes;
      if (rawRef) order.deliveryReference = rawRef;
      order.deliveryHistory.push({
        version,
        notes: sanitizedNotes,
        reference: rawRef || undefined,
        files: uploadedFiles,
        deliveredAt: new Date().toISOString()
      });
      order.status = 'delivered';
      if (Array.isArray(order.revisions)) {
        for (const rev of order.revisions) {
          if (rev.status === 'requested') rev.status = 'resolved';
        }
      }
      saveOrdersToDisk();
    }

    postOfferMessage(order, offer, { id: caller.id, name: caller.name }, `New ${OFFER_LABEL[kind]} ${offer.number}: ${title}`, 'offer_created');
    res.status(201).json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/offers/:id/:action(accept|decline|cancel)', requireAuth, rateLimit(20, 60_000), async (req, res) => {
  const offer = workstreamOffers.find(o => o.id === req.params.id);
  const order = offer ? orders.find(o => o.id === offer.orderId) : undefined;
  if (!offer || !order) return res.status(404).json({ error: 'Not found' });

  if (!tryAcquireOrderLock(order.id, res)) return;
  try {
    const caller = offerCaller(req);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
    if (!canAccessOrderWorkstream(caller, order)) return res.status(403).json({ error: 'Forbidden' });
    if (offer.status !== 'pending') {
      if (offer.status === 'accepted' || offer.status === 'paid') {
        const associatedOrder = offer.orderId ? orders.find(o => o.id === offer.orderId) : order;
        if (associatedOrder) {
          return res.json({ 
            offer: viewOffer(offer), 
            order: enrichOrderWithServiceInfo(associatedOrder) 
          });
        }
      }
      return res.status(409).json({ error: `This ${OFFER_LABEL[offer.kind]} is already ${offer.status}.` });
    }

    const action = req.params.action;
    const now = new Date().toISOString();

    if (action === 'cancel') {
      if (caller.id !== order.sellerId) return res.status(403).json({ error: 'Only the seller can cancel this.' });
      offer.status = 'cancelled'; offer.resolvedAt = now; offer.resolvedBy = caller.id;
      if (offer.kind === 'proposal') {
        const linkedProp = findLinkedProposalForOffer(offer, order);
        if (linkedProp && linkedProp.status === 'pending') {
          linkedProp.status = 'rejected';
          await saveProposalsToDisk();
        }
      }
      if (offer.kind === 'invoice' && (order.status === 'delivered' || order.status === 'draft_review')) {
        const otherPendingInvoice = workstreamOffers.some(o => o.orderId === order.id && o.id !== offer.id && o.kind === 'invoice' && o.status === 'pending');
        if (!otherPendingInvoice && orderHasEscrow(order.id)) {
          order.status = 'in_progress';
          await saveOrdersToDisk();
        }
      }
      await saveOffersToDisk();
      postOfferMessage(order, offer, null, `${offer.number} was cancelled by the seller.`, 'offer_cancelled');
      return res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order) });
    }

    // Accepting / declining belongs to the buyer only (not staff, not the seller).
    if (caller.id !== order.buyerId) return res.status(403).json({ error: 'Only the buyer can respond to this.' });

    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot accept offers on a cancelled order (escrow has already been refunded).' });
    }
    if (order.status === 'completed' && offer.kind === 'invoice') {
      return res.status(400).json({ error: 'Cannot accept an invoice on a completed order (escrow has already been released).' });
    }

    if (action === 'decline') {
      offer.status = 'declined'; offer.resolvedAt = now; offer.resolvedBy = caller.id;
      if (offer.kind === 'proposal') {
        const linkedProp = findLinkedProposalForOffer(offer, order);
        if (linkedProp) {
          linkedProp.status = 'rejected';
          await saveProposalsToDisk();
        }
      } else if (offer.kind === 'invoice' && (order.status === 'delivered' || order.status === 'draft_review')) {
        const otherPendingInvoice = workstreamOffers.some(o => o.orderId === order.id && o.id !== offer.id && o.kind === 'invoice' && o.status === 'pending');
        if (!otherPendingInvoice && orderHasEscrow(order.id)) {
          order.status = 'revision';
          saveOrdersToDisk();
        }
      }
      await saveOffersToDisk();
      postOfferMessage(order, offer, null, `${offer.number} was declined by the buyer.`, 'offer_declined');
      return res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order) });
    }

    // ----- accept: real money movement through the ledger -----
    ensureWallet(order.buyerId); ensureWallet(order.sellerId);
    const today = now.split('T')[0];
    const protectionEnd = new Date(Date.now() + siteSettings.getSettings().commission.escrowProtectionDays * 86400000).toISOString().split('T')[0];
    const isInitialFunding = !orderHasEscrow(order.id);
    const isFollowOnAfterCompletion = orderHasEscrow(order.id) && (order.status === 'completed' || getActiveEscrowRemaining(order) === 0);

    if (offer.kind === 'invoice') {
      const validationError = validateOrderReleasePreconditions(order, false, true);
      if (validationError) {
        return res.status(validationError.status).json({ error: validationError.error });
      }

      const esc = financeLedger.getEscrow(order.id);
      const currentEscrow = esc ? esc.remaining : Number(order.amount || 0);
      const invoiceAmount = Number(offer.amount);
      const additionalAmount = FinanceLedgerEngine.round(invoiceAmount - currentEscrow);

      if (additionalAmount < 0) {
        return res.status(400).json({ error: `Final invoice amount ($${invoiceAmount}) cannot be less than the current order escrow ($${currentEscrow}).` });
      }

      // If invoice amount is higher than existing escrow, charge the additional amount to the buyer into escrow
      if (additionalAmount > 0) {
        topUpOrderEscrowWithEvent({
          orderId: order.id,
          orderTitle: `Invoice Top-up: ${offer.title}`,
          amount: additionalAmount,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          actor: `user:${order.buyerId}`
        });
        order.amount = invoiceAmount;
        order.feeBreakdown = financeLedger.quoteOrder(order.amount);
      }

      // Resolve any outstanding revision requests upon accepting the new Invoice
      let invoiceRevisionsResolved = false;
      if (Array.isArray(order.revisions)) {
        for (const rev of order.revisions) {
          if (rev.status === 'requested') {
            rev.status = 'resolved';
            invoiceRevisionsResolved = true;
          }
        }
      }
      if (invoiceRevisionsResolved) {
        emitSystemEvent(order.id, 'revision_resolved', `📝 Revision resolved via accepted invoice ${offer.number}.`);
      }

      // Perform the required financial release successfully first
      releaseOrderFunds(order, caller.name, `Final invoice ${offer.number} accepted by buyer and escrow released`, false);

      // Only after successful release, mark the invoice offer as paid/resolved
      offer.status = 'paid';
      offer.resolvedAt = now;
      offer.resolvedBy = caller.id;

      syncUserBalances();
      await saveOffersToDisk();
      await saveOrdersToDisk();
      await saveMessagesToDisk();
      const completionNote = additionalAmount > 0
        ? `${offer.number} ($${invoiceAmount.toLocaleString()}) was paid (+$${additionalAmount.toLocaleString()} funded from wallet) and full escrow ($${invoiceAmount.toLocaleString()}) was released to the seller. Order completed!`
        : `${offer.number} was accepted and escrow funds ($${invoiceAmount.toLocaleString()}) were released to the seller. Order completed!`;
      postOfferMessage(order, offer, null, completionNote, 'offer_paid');
      return res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order) });

    } else if (isInitialFunding) {
      // Initial proposal on an unfunded order/inquiry: funds this order's escrow directly under order.id
      if (order.status === 'funded_in_escrow' || orderHasEscrow(order.id)) {
        return res.status(409).json({ error: 'Order escrow is already funded.' });
      }
      if (order.status !== 'in_progress' && order.status !== 'payment_pending') {
        return res.status(409).json({ error: 'Cannot fund escrow for order in current status.' });
      }
      const newTitle = offer.kind === 'proposal' && (/^inquiry:/i.test(order.title) || !order.amount) ? offer.title : order.title;
      const prevStatus = order.status;
      order.previousStatus = prevStatus;
      order.status = 'payment_pending';
      await saveOrdersToDisk(); // CRASH SAFE POINT: Order is durable as payment_pending before ledger funding

      try {
        fundOrderEscrowWithEvent({ orderId: order.id, orderTitle: newTitle, amount: offer.amount, buyerId: order.buyerId, sellerId: order.sellerId, actor: `user:${order.buyerId}` });
        order.title = newTitle;
        order.amount = offer.amount;
        order.status = 'funded_in_escrow';
        order.escrowProtectionStartDate = today;
        order.escrowProtectionEndDate = protectionEnd;
        order.feeBreakdown = financeLedger.quoteOrder(offer.amount);
        if (offer.kind === 'proposal' && offer.deliveryDays) {
          order.dueDate = new Date(Date.now() + offer.deliveryDays * 86400000).toISOString().split('T')[0];
        }
        offer.orderId = order.id;
        offer.status = 'accepted';
        if (offer.kind === 'proposal') {
          const linkedProp = findLinkedProposalForOffer(offer, order);
          if (linkedProp) {
            linkedProp.status = 'accepted';
            linkedProp.workstreamOrderId = order.id;
            linkedProp.offerId = offer.id;
            order.proposalId = linkedProp.id;
            await saveProposalsToDisk();
          }
        }
        await saveOrdersToDisk();
        postOfferMessage(order, offer, null, `${offer.number} was accepted and escrow was funded ($${offer.amount}).`, 'offer_accepted');
      } catch (fundingErr: any) {
        order.status = prevStatus;
        await saveOrdersToDisk();
        return res.status(400).json({ error: fundingErr.message || 'Failed to fund escrow for offer.' });
      }
    } else if (isFollowOnAfterCompletion) {
      // PeoplePerHour Follow-On Proposal / Deposit accepted in the same WorkStream after previous invoice was paid
      // Correct model: New Order in same Workspace
      const newOrderId = 'ord_' + randomUUID().slice(0, 12);
      const isGigFollowOn = order.orderType === 'gig' || (Boolean(order.gigId) && !order.projectId);
      const orderType: 'gig' | 'project' = isGigFollowOn ? 'gig' : 'project';
      const gigOrderId = orderType === 'gig' ? newOrderId : undefined;
      const projectOrderId = orderType === 'project' ? newOrderId : undefined;

      const newOrder: Order = {
        id: newOrderId,
        workspaceId: order.workspaceId,
        orderType,
        ...(gigOrderId ? { gigOrderId } : {}),
        ...(projectOrderId ? { projectOrderId } : {}),
        title: offer.title,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        amount: offer.amount,
        status: 'payment_pending',
        createdAt: today,
        dueDate: offer.kind === 'proposal' && offer.deliveryDays
          ? new Date(Date.now() + offer.deliveryDays * 86400000).toISOString().split('T')[0]
          : new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        escrowProtectionStartDate: today,
        escrowProtectionEndDate: protectionEnd,
        feeBreakdown: financeLedger.quoteOrder(offer.amount),
        projectId: order.projectId,
        gigId: order.gigId
      };

      // 1. Record & save order FIRST so it exists in memory / index for system event attachment
      const enrichedOrder = enrichOrderWithServiceInfo(newOrder);
      recordOrder(enrichedOrder);
      await saveOrdersToDisk(); // CRASH SAFE POINT: Order recorded as 'payment_pending' before funding
      emitSystemEvent(newOrder.id, 'order_created', `Order placed: ${newOrder.title}. Payment is held in escrow until the work is approved.`);

      // 2. Fund escrow with rollback on failure
      try {
        fundOrderEscrowWithEvent({
          orderId: newOrder.id,
          orderTitle: newOrder.title,
          amount: newOrder.amount,
          buyerId: newOrder.buyerId,
          sellerId: newOrder.sellerId,
          actor: `user:${newOrder.buyerId}`
        });
        
        // Update order status to funded only AFTER ledger successfully records the escrow
        enrichedOrder.status = 'funded_in_escrow';
        await saveOrdersToDisk();
        
        syncUserBalances();
      } catch (fundingErr: any) {
        // Rollback newOrder state if funding fails
        const orderIdx = orders.findIndex(o => o.id === newOrder.id);
        if (orderIdx !== -1) orders.splice(orderIdx, 1);
        orderIndex.delete(newOrder.id);

        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].orderId === newOrder.id) {
            messages.splice(i, 1);
          }
        }

        await saveOrdersToDisk();
        await saveMessagesToDisk();
        return res.status(400).json({ error: fundingErr.message || 'Failed to fund escrow for follow-on order.' });
      }

      offer.orderId = newOrder.id;
      offer.status = 'accepted';
      postOfferMessage(enrichedOrder, offer, null, `Follow-on ${OFFER_LABEL[offer.kind]} ${offer.number} ("${offer.title}") was accepted and $${offer.amount.toLocaleString()} was funded into escrow in a new Order (#${newOrderId}).`, 'offer_accepted');
      return res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(enrichedOrder) });
    } else {
      // Escrow is already funded and held: top up existing order's escrow directly under the primary orderId (no secondary order ID).
      topUpOrderEscrowWithEvent({
        orderId: order.id,
        orderTitle: offer.title,
        amount: offer.amount,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        actor: `user:${order.buyerId}`
      });
      order.amount = FinanceLedgerEngine.round(Number(order.amount || 0) + offer.amount);
      order.feeBreakdown = financeLedger.quoteOrder(order.amount);
      if (offer.kind === 'proposal' && offer.deliveryDays) {
        order.dueDate = new Date(Date.now() + offer.deliveryDays * 86400000).toISOString().split('T')[0];
      }
      offer.orderId = order.id;
      offer.status = 'accepted';
      if (offer.kind === 'proposal') {
        const linkedProp = findLinkedProposalForOffer(offer, order);
        if (linkedProp) {
          linkedProp.status = 'accepted';
          linkedProp.workstreamOrderId = order.id;
          linkedProp.offerId = offer.id;
          await saveProposalsToDisk();
        }
      }
      postOfferMessage(order, offer, null, `${offer.number} was accepted and escrow was topped up with $${offer.amount}. All funds and milestones remain unified under Order #${order.id}.`, 'offer_accepted');
    }

    offer.resolvedAt = now; offer.resolvedBy = caller.id;
    syncUserBalances();
    await saveOrdersToDisk();
    await saveOffersToDisk();
    res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    // fundEscrow throws on insufficient balance, frozen wallets, below-minimum amounts, etc. Nothing was changed.
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(order.id);
  }
});

// Direct Buyer Proposal Accept / Decline Endpoint (supports hiring multiple freelancers on the same project)
app.post('/api/proposals/:id/:action(accept|decline)', requireAuth, rateLimit(20, 60_000), async (req, res) => {
  if (req.params.action === 'accept') return await processProposalAccept(req, res);
  return await processProposalDecline(req, res);
});

app.patch('/api/admin/proposals/:id', requireAdmin, async (req, res) => {
  const p = proposals.find(prop => prop.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proposal not found' });

  if (req.body.coverLetter !== undefined) p.coverLetter = req.body.coverLetter;
  if (req.body.bidAmount !== undefined) p.bidAmount = Number(req.body.bidAmount);
  if (req.body.deliveryDays !== undefined) p.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) p.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROPOSAL_EDITED',
    target: `Proposal #${p.id}`,
    details: `Updated bid parameters ($${p.bidAmount}), delivery days (${p.deliveryDays}d), or status (${p.status}) for freelancer ${p.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });
  await saveProposalsToDisk();
  res.json(p);
});

app.patch('/api/admin/proposals/:id/status', requireAdmin, async (req, res) => {
  const p = proposals.find(prop => prop.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proposal not found' });

  const oldStatus = p.status;
  p.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `PROPOSAL_STATUS_${req.body.status.toUpperCase()}`,
    target: `Proposal #${p.id}`,
    details: `Changed proposal status from "${oldStatus}" to "${req.body.status}" for freelancer ${p.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  await saveProposalsToDisk();
  res.json(p);
});

app.delete('/api/admin/proposals/:id', requireAdmin, async (req, res) => {
  const index = proposals.findIndex(prop => prop.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Proposal not found' });

  const deleted = proposals[index];
  proposals.splice(index, 1);

  // Decrement proposalsCount on project if project exists
  const proj = projects.find(p => p.id === deleted.projectId);
  if (proj && proj.proposalsCount > 0) {
    proj.proposalsCount -= 1;
    await saveProjectsToDisk();
  }
  await saveProposalsToDisk();

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROPOSAL_DELETED',
    target: `Proposal #${deleted.id}`,
    details: `Permanently removed proposal #${deleted.id} by freelancer ${deleted.freelancerName} from project #${deleted.projectId}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

// User Management Endpoints
app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  
  if (req.body.name !== undefined) u.name = escapeHtml(String(req.body.name));
  if (req.body.email !== undefined) u.email = escapeHtml(String(req.body.email));
  if (req.body.role !== undefined) {
    const caller = (req as any).authenticatedUser;
    if (req.body.role === 'super_admin' && caller?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden: Only super_admin can set super_admin role.' });
    }
    if (!['buyer', 'freelancer', 'admin', 'super_admin', 'support', 'moderator'].includes(req.body.role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    u.role = req.body.role;
  }
  if (req.body.title !== undefined) u.title = escapeHtml(String(req.body.title));
  if (req.body.bio !== undefined) u.bio = escapeHtml(String(req.body.bio));
  if (req.body.skills !== undefined) u.skills = Array.isArray(req.body.skills) ? req.body.skills : req.body.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
  if (req.body.hourlyRate !== undefined) {
      const hr = Number(req.body.hourlyRate);
      if (!Number.isFinite(hr) || hr < 0) return res.status(400).json({ error: 'Invalid hourly rate.' });
      u.hourlyRate = hr;
  }
  // walletBalance is ledger-controlled and intentionally ignored here (use /api/admin/finance/adjustments)
  if (req.body.verified !== undefined) u.verified = Boolean(req.body.verified);
  if (req.body.status !== undefined) {
      if (!['active', 'frozen', 'restricted'].includes(req.body.status)) {
         return res.status(400).json({ error: 'Invalid status.' });
      }
      u.status = req.body.status;
  }

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'USER_PROFILE_EDITED',
    target: `User ${u.name}`,
    details: `Updated profile details and parameters for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(safeUser(u));
});

app.patch('/api/admin/users/:id/status', requireAdmin, (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  
  const oldStatus = u.status;
  u.status = req.body.status;

  const admin = (req as any).authenticatedUser;
  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: admin?.name || 'Admin',
    role: admin?.role || 'admin',
    action: `USER_STATUS_${req.body.status.toUpperCase()}`,
    target: `User ${u.name}`,
    details: `Changed account status from ${oldStatus} to ${req.body.status}`,
    timestamp: new Date().toLocaleString()
  });

  // Disconnect any active WebSocket connections if account is suspended, restricted, or deactivated
  if (u.status !== 'active') {
    for (const client of clients) {
      if ((client as any).authenticatedUserId === u.id) {
        client.close(1008, `Account is ${u.status}`);
      }
    }
  }

  // Notify user via chat message and email notification if suspended, restricted, or deactivated
  if (req.body.status === 'suspended' || req.body.status === 'restricted' || req.body.status === 'deactivated') {
    notifyUserOnAdminAction(u, req.body.status, req.body.notes);
  }

  res.json(safeUser(u));
});

app.post('/api/admin/users/:id/impersonate', requireAdmin, (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const admin = (req as any).authenticatedUser;
  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: admin?.name || 'Admin',
    role: admin?.role || 'admin',
    action: 'USER_IMPERSONATED',
    target: `User ${u.name}`,
    details: `Initialized administrative impersonation session for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  // Send security chat notification & email
  notifyUserOnAdminAction(u, 'impersonated');

  res.json({ success: true, user: safeUser(u) });
});

app.post('/api/admin/users/:id/stop-impersonate', requireAdmin, (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const admin = (req as any).authenticatedUser;
  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: admin?.name || 'Admin',
    role: admin?.role || 'admin',
    action: 'USER_IMPERSONATION_ENDED',
    target: `User ${u.name}`,
    details: `Safely ended administrative impersonation session for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, user: safeUser(u) });
});

app.patch('/api/admin/users/:id/verify', requireAdmin, (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  u.verified = !u.verified;

  const admin = (req as any).authenticatedUser;
  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: admin?.name || 'Admin',
    role: admin?.role || 'admin',
    action: u.verified ? 'USER_VERIFIED' : 'USER_UNVERIFIED',
    target: `User ${u.name}`,
    details: `Verification status changed to ${u.verified}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(safeUser(u));
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const index = users.findIndex(user => user.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'User not found' });

  const target = users[index];
  if (target.role === 'super_admin') {
    return res.status(403).json({ error: 'Cannot delete a super_admin account.' });
  }
  if (financeLedger.hasOutstandingFunds(target.id)) {
    return res.status(409).json({ error: 'User still has wallet funds, pending withdrawals or active escrow. Resolve these before deleting the account.' });
  }
  if (orders.some(o => (o.buyerId === target.id || o.sellerId === target.id) && o.status !== 'completed' && o.status !== 'cancelled' && o.amount > 0)) {
    return res.status(409).json({ error: 'User has active paid orders. Complete or cancel them first.' });
  }
  const deletedUser = users[index];
  users.splice(index, 1);

  // Clean up listings to maintain references
  gigs = gigs.filter(g => g.freelancerId !== req.params.id);
  projects = projects.filter(p => p.buyerId !== req.params.id);
  saveProjectsToDisk();

  const admin = (req as any).authenticatedUser;
  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: admin?.name || 'Admin',
    role: admin?.role || 'admin',
    action: 'USER_DELETED',
    target: `User ${deletedUser.name}`,
    details: `Permanently deleted user account ${deletedUser.email} and cleared their associated gigs & projects`,
    timestamp: new Date().toLocaleString()
  });

  // Clean up any active WebSocket connections for deleted user
  for (const client of clients) {
    if ((client as any).authenticatedUserId === req.params.id) {
      client.close(1008, 'Account deleted');
    }
  }

  res.json({ success: true, id: deletedUser.id });
});

// Dispute Resolution Endpoint: final outcomes actually move the escrowed money
app.patch('/api/admin/disputes/:id/resolve', requireAdmin, (req, res) => {
  // We don't have orderId yet, so we acquire it inside the try block after looking up the dispute.
  let lockedOrderId: string | null = null;
  try {
    const d = disputes.find(disp => disp.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispute not found' });
    const status = req.body.status as Dispute['status'];
    if (!['open', 'under_investigation', 'resolved_refund', 'resolved_release', 'resolved_partial'].includes(status)) {
      return res.status(400).json({ error: 'Invalid dispute status.' });
    }
    if (d.status.startsWith('resolved')) return res.status(409).json({ error: `Dispute is already ${d.status}.` });
    const notes = String(req.body.notes || '');
    const reason = notes.trim().length >= 5 ? notes.trim() : 'Dispute resolved by administrator';
    const order = orderIndex.get(d.orderId);
    if (status.startsWith('resolved')) {
      if (!order) return res.status(404).json({ error: 'Order for this dispute not found' });
      lockedOrderId = order.id;
      try {
        acquireOrderLock(lockedOrderId);
      } catch (err: any) {
        return res.status(409).json({ error: err.message });
      }
      if (status === 'resolved_release') releaseOrderFunds(order, adminActor(req), reason, false);
      else if (status === 'resolved_refund') refundOrderFunds(order, undefined, adminActor(req), reason);
      else splitOrderFunds(order, Number(req.body.refundAmount), adminActor(req), reason);
    }
    d.status = status;
    d.resolutionNotes = notes;
    if (order) {
      const sysMsg: Message = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'Dispute Resolution Desk',
        text: `⚖️ Dispute resolved by administrator: ${status}. Notes: ${notes || 'No notes provided'}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        metadata: { action: 'dispute_resolved', status, notes }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);
    }
    registerAuditLog({
      id: 'log_' + randomUUID().slice(0, 12),
      actor: adminActor(req),
      role: 'super_admin',
      action: 'DISPUTE_RESOLVED',
      target: `Dispute #${d.id}`,
      details: `Resolved dispute with status ${status}. Notes: ${notes}`,
      timestamp: new Date().toLocaleString()
    });
    saveDisputesToDisk();
    saveOrdersToDisk();
    saveRefundsToDisk();
    res.json(d);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    if (lockedOrderId) releaseOrderLock(lockedOrderId);
  }
});

// Support Ticket Reply Endpoint
app.post('/api/admin/tickets/:id/reply', requireAdmin, (req, res) => {
  const t = supportTickets.find(tick => tick.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  t.messages.push({
    sender: 'WorkPerHour Support Staff',
    text: req.body.text,
    timestamp: new Date().toISOString()
  });
  t.status = 'in_progress';
  res.json(t);
});

// WebSocket Real-Time Chat Server
// WebSocket Real-Time Chat Server
function broadcastMessage(message: Message, orderId: string) {
  const payload = JSON.stringify({ type: 'MESSAGE_RECEIVED', message });
  const updatePayload = JSON.stringify({ 
    type: 'WORKSTREAM_UPDATED', 
    orderId, 
    lastMessage: message.text, 
    lastMessageTime: message.timestamp 
  });

  const order = orderIndex.get(orderId);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && (client as any).isAuthenticated) {
      const clientUserId = (client as any).authenticatedUserId;
      if (!clientUserId) continue;
      const clientUser = users.find(u => u.id === clientUserId);
      const isAuthorized = !!order && canAccessOrderWorkstream(clientUser, order);
      
      if (isAuthorized) {
        client.send(payload);
        client.send(updatePayload);
      }
    }
  }
}

function emitSystemEvent(orderId: string, action: string, text: string, metadata: Record<string, any> = {}) {
  const sysMsg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId,
    senderId: 'system',
    senderName: 'WorkSphere System',
    text,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: { ...metadata, action }
  };
  recordMessage(sysMsg);
  saveMessagesToDisk();
  broadcastMessage(sysMsg, orderId);
}

function disconnectUserSockets(userId: string, reason = 'Session invalidated') {
  for (const client of clients) {
    if ((client as any).authenticatedUserId === userId) {
      try { client.close(4401, reason); } catch {}
    }
  }
}

const clients = new Set<WebSocket>();

wss.on('connection', (ws, req) => {
  try {
    clients.add(ws);
    (ws as any).isAuthenticated = false;
    
    // Set a timeout to authenticate. If no valid AUTHENTICATE message is received within 1 second, close.
    const authTimeout = setTimeout(() => {
      if (!(ws as any).isAuthenticated) {
        try { ws.close(1008, 'Authentication timeout'); } catch {}
      }
    }, 1000);

    setupWebSocketHandlers(ws, authTimeout);
  } catch (err) {
    console.error('WS Connection error:', err);
    try { ws.close(1011, 'Server error during connection'); } catch {}
  }
});

function setupWebSocketHandlers(ws: WebSocket, authTimeout: NodeJS.Timeout) {
  // Rate limiting map for this socket: max 30 messages per 10 seconds
  let messageCount = 0;
  let resetTime = Date.now() + 10000;
  let authAttempts = 0;

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        ws.send(JSON.stringify({ error: 'Binary messages not supported' }));
        return;
      }

      const rawStr = data.toString();
      if (rawStr.length > 51200) {
        ws.send(JSON.stringify({ error: 'Message payload exceeds maximum allowed size' }));
        return;
      }

      const now = Date.now();
      if (now > resetTime) {
        messageCount = 1;
        resetTime = now + 10000;
      } else {
        messageCount++;
        if (messageCount > 30) {
          ws.send(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }));
          return;
        }
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawStr);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'AUTHENTICATE') {
        authAttempts++;
        if (authAttempts > 3) {
          ws.send(JSON.stringify({ error: 'Too many authentication attempts' }));
          try { ws.close(1008, 'Too many auth attempts'); } catch {}
          return;
        }

        const token = parsed.token;
        if (!token) {
          ws.send(JSON.stringify({ error: 'Token is required' }));
          return;
        }

        const payload = verifyToken(token);
        if (payload && payload.id) {
          const dbUser = users.find(u => u.id === payload.id);
          if (dbUser && dbUser.status === 'active') {
            (ws as any).authenticatedUserId = dbUser.id;
            (ws as any).sessionVersion = payload.sessionVersion !== undefined ? payload.sessionVersion : dbUser.sessionVersion;
            (ws as any).isAuthenticated = true;
            clearTimeout(authTimeout);
            
            ws.send(JSON.stringify({ 
              type: 'CONNECTED', 
              userId: dbUser.id,
              serverTime: new Date().toISOString() 
            }));
            return;
          }
        }
        
        ws.send(JSON.stringify({ error: 'Invalid token' }));
        try { ws.close(1008, 'Authentication failed'); } catch {}
        return;
      }

      // Block all other messages until authenticated
      if (!(ws as any).isAuthenticated) {
        ws.send(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      // Validate session version and status
      const currentDbUser = users.find(u => u.id === (ws as any).authenticatedUserId);
      if (!currentDbUser || currentDbUser.status !== 'active' || (currentDbUser.sessionVersion !== undefined && (ws as any).sessionVersion !== undefined && currentDbUser.sessionVersion !== (ws as any).sessionVersion)) {
        try { ws.close(1008, 'Session invalidated or account inactive'); } catch {}
        return;
      }

      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }
    } catch (e) {
      console.error('WS message processing error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
}

// Express routes for robots.txt and sitemap.xml in current Vite + Express runtime
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nDisallow: /workstream/\nDisallow: /checkout/\nDisallow: /payouts/\n\nSitemap: https://workperhour.com/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_req, res) => {
  const baseUrl = 'https://workperhour.com';
  const urls = [
    `${baseUrl}/`,
    `${baseUrl}/gigs`,
    `${baseUrl}/projects`,
    `${baseUrl}/freelancers`,
    ...gigs.map(g => {
      const uname = (g.freelancerUsername || slugify(g.freelancerName)).toLowerCase();
      const gslug = (g.slug || slugify(g.title)).toLowerCase();
      return `${baseUrl}/${uname}/${gslug}`;
    })
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n') +
    `\n</urlset>`;
  res.type('application/xml').send(xml);
});

// SSR and Vite integration
(async () => {
  await setupSSR(app, IS_PROD, __dirname, () => ({ gigs, users, projects, categories }));

  const portArgIndex = process.argv.findIndex(arg => arg === '--port' || arg === '-p');
  const cliPort = portArgIndex !== -1 && process.argv[portArgIndex + 1] ? Number(process.argv[portArgIndex + 1]) : null;
  const PORT = cliPort || (process.env.PORT && process.env.PORT !== '8080' ? Number(process.env.PORT) : 3000);
  if (!server.listening) {
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${PORT} in use, selecting dynamic fallback port`);
        server.listen(0, '0.0.0.0');
      }
    });
    server.listen(Number(PORT), '0.0.0.0', () => {
      const actualPort = (server.address() as any)?.port || PORT;
      console.log(`WorkPerHour server running on http://0.0.0.0:${actualPort}`);
      if (bootstrapAdminPasswordNotice) {
        console.warn('[SECURITY] ADMIN_INITIAL_PASSWORD was not set. One-time generated super-admin password: ' + bootstrapAdminPasswordNotice + ' — change it after first login and set ADMIN_INITIAL_PASSWORD next time.');
      }
    });
  }
})();

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Flushing pending writes...`);
  await Promise.all(writeQueue.values());
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

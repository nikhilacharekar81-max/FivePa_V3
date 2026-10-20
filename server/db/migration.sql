-- PostgreSQL Schema Migration for WorkPerHour Store & Ledger
-- Run via migration runner or psql

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(128),
  email VARCHAR(255) UNIQUE NOT NULL,
  mobile VARCHAR(64),
  role VARCHAR(64) NOT NULL,
  avatar TEXT,
  title VARCHAR(255),
  rating NUMERIC(3,2) DEFAULT 5.0,
  reviews_count INT DEFAULT 0,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  earned NUMERIC(12,2) DEFAULT 0,
  completed_jobs INT DEFAULT 0,
  bio TEXT,
  skills TEXT[],
  status VARCHAR(32) DEFAULT 'active',
  verified BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  mobile_verified BOOLEAN DEFAULT FALSE,
  wallet_balance NUMERIC(12,2) DEFAULT 0,
  created_at VARCHAR(32),
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  password TEXT,
  session_version INT DEFAULT 1,
  known_devices TEXT[],
  is_available_now BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS gigs (
  id VARCHAR(64) PRIMARY KEY,
  freelancer_id VARCHAR(64) NOT NULL,
  freelancer_name VARCHAR(255) NOT NULL,
  freelancer_username VARCHAR(128),
  freelancer_avatar TEXT,
  freelancer_level VARCHAR(64),
  title TEXT NOT NULL,
  slug VARCHAR(255),
  category VARCHAR(128) NOT NULL,
  subcategory VARCHAR(128),
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  delivery_days INT NOT NULL,
  rating NUMERIC(3,2) DEFAULT 5.0,
  reviews_count INT DEFAULT 0,
  image TEXT,
  status VARCHAR(32) DEFAULT 'published',
  featured BOOLEAN DEFAULT FALSE,
  extras JSONB,
  moderation_status VARCHAR(32) DEFAULT 'approved',
  moderation_notes TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  buyer_id VARCHAR(64) NOT NULL,
  buyer_name VARCHAR(255) NOT NULL,
  buyer_avatar TEXT,
  title TEXT NOT NULL,
  slug VARCHAR(255),
  category VARCHAR(128) NOT NULL,
  subcategory VARCHAR(128),
  description TEXT,
  budget_min NUMERIC(12,2) DEFAULT 0,
  budget_max NUMERIC(12,2) DEFAULT 0,
  deadline_days INT NOT NULL,
  proposals_count INT DEFAULT 0,
  created_at VARCHAR(32) NOT NULL,
  status VARCHAR(32) DEFAULT 'open',
  featured BOOLEAN DEFAULT FALSE,
  moderation_status VARCHAR(32) DEFAULT 'approved',
  moderation_notes TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  freelancer_id VARCHAR(64) NOT NULL,
  freelancer_name VARCHAR(255) NOT NULL,
  freelancer_avatar TEXT,
  freelancer_title VARCHAR(255),
  cover_letter TEXT,
  bid_amount NUMERIC(12,2) NOT NULL,
  delivery_days INT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  status VARCHAR(32) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  buyer_id VARCHAR(64) NOT NULL,
  seller_id VARCHAR(64) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  due_date VARCHAR(32) NOT NULL,
  completed_at VARCHAR(32),
  requirements TEXT,
  deliverables TEXT,
  deliverable_files JSONB,
  revisions JSONB,
  admin_notes TEXT,
  is_muted BOOLEAN DEFAULT FALSE,
  escrow_protection_start_date VARCHAR(32),
  escrow_protection_end_date VARCHAR(32),
  gig_id VARCHAR(64),
  project_id VARCHAR(64),
  service_url TEXT,
  gig_slug VARCHAR(128),
  seller_username VARCHAR(128),
  buyer_username VARCHAR(128),
  service_title TEXT,
  service_thumbnail TEXT,
  is_timer_paused BOOLEAN DEFAULT FALSE,
  fee_breakdown JSONB,
  delivery_history JSONB,
  delivery_notes TEXT,
  delivery_reference TEXT,
  accepted_version INT,
  review_window_days INT,
  review_window_expires_at VARCHAR(32),
  review JSONB
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  type VARCHAR(32) DEFAULT 'message',
  file_info JSONB,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64),
  reviewer_id VARCHAR(64),
  reviewer_name VARCHAR(255),
  reviewer_avatar TEXT,
  target_user_id VARCHAR(64),
  rating INT NOT NULL,
  comment TEXT,
  order_title TEXT,
  gig_id VARCHAR(64),
  project_id VARCHAR(64),
  created_at VARCHAR(32),
  updated_at VARCHAR(32),
  is_cancelled_order BOOLEAN DEFAULT FALSE,
  reply JSONB
);

CREATE TABLE IF NOT EXISTS uploads (
  filename VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255),
  mime VARCHAR(128),
  size BIGINT,
  created_at VARCHAR(32) NOT NULL,
  sha256 VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id VARCHAR(64) PRIMARY KEY,
  buyer_id VARCHAR(64) NOT NULL,
  seller_id VARCHAR(64) NOT NULL,
  order_ids JSONB DEFAULT '[]'::jsonb,
  title TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  last_activity_at VARCHAR(32),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS workstream_offers (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64),
  kind VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  delivery_days INT,
  status VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  resolved_at VARCHAR(32),
  resolved_by VARCHAR(64),
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS custom_invoices (
  id VARCHAR(64) PRIMARY KEY,
  invoice_number VARCHAR(64) NOT NULL,
  buyer_id VARCHAR(64) NOT NULL,
  seller_id VARCHAR(64) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(32) NOT NULL,
  description TEXT,
  created_at VARCHAR(32) NOT NULL,
  paid_at VARCHAR(32),
  related_order_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS disputes (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  buyer_id VARCHAR(64),
  seller_id VARCHAR(64),
  raised_by VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT,
  status VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  resolution_notes TEXT,
  resolution_type VARCHAR(64),
  notes TEXT,
  assigned_to VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS refunds (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  buyer_id VARCHAR(64) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  status VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id VARCHAR(64) PRIMARY KEY,
  freelancer_id VARCHAR(64) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  method VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  account_details TEXT
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  priority VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  messages JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor VARCHAR(255) NOT NULL,
  role VARCHAR(64) NOT NULL,
  action VARCHAR(255) NOT NULL,
  target VARCHAR(255) NOT NULL,
  details TEXT,
  timestamp VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_emails (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT,
  body TEXT NOT NULL,
  type VARCHAR(64),
  sent_at VARCHAR(64),
  date VARCHAR(64),
  read BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_gateways (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_ledger_state (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_order_id ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_user_id ON reviews(target_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_offers_order_id ON workstream_offers(order_id);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at VARCHAR(64) NOT NULL,
  dedup_key VARCHAR(255) UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_review JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS previous_status VARCHAR(64);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(32);


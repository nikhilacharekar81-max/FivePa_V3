# WorkPerHour: Commercial Full-Stack Architecture Guide
## Current Runtime: React + Vite on Node.js/Express Backend (with Pre-Rendered HTML5 SEO & Next.js Migration Templates)

Welcome to the architectural documentation for **WorkPerHour**. This document is designed as an open-book textbook for both **beginner learners** and **senior code reviewers**.

> **Runtime Clarification:** The active production runtime is **React SPA on Vite paired with an Express / Node.js backend**. The backend serves pre-rendered semantic HTML5, Schema.org JSON-LD, OpenGraph tags, `/robots.txt`, and `/sitemap.xml` directly. The Next.js App Router templates in `/app` are prepared architecture templates for future migration.

---

## 1. High-Level Architectural Mental Model

```
                    +------------------------------------------+
                    |             USER / CRAWLER               |
                    | (Googlebot, Bing, Slack, WhatsApp, User) |
                    +------------------------------------------+
                                         |
                                         | HTTP / HTTPS
                                         v
+-----------------------------------------------------------------------------------+
| FRONTEND & SEO LAYER (Vite + React SPA with Server-Pre-rendered HTML5)             |
|                                                                                   |
|  * index.html           -> Pre-rendered Semantic HTML5, OpenGraph, JSON-LD       |
|  * src/App.tsx          -> High-performance client routing & interaction         |
|  * /robots.txt          -> Served directly by Express with sitemap directive      |
|  * /sitemap.xml         -> Dynamic XML Sitemap served directly by Express         |
|  * /app (Templates)     -> Next.js App Router migration templates (/app/layout)   |
+-----------------------------------------------------------------------------------+
                                         |
                                         | API Calls (/api/*) & WebSockets (ws://)
                                         v
+-----------------------------------------------------------------------------------+
| TIER 2: NODE.JS & EXPRESS CORE ENGINE (Financial Ledger & Transaction Authority)  |
|                                                                                   |
|  * server.ts            -> Master Server, Port Bindings & Lifecycle Management    |
|  * src/server/middleware-> Session Cryptography, Device Verification, RBAC Guards|
|  * src/server/routes    -> API Routing Endpoints (/api/auth, /api/orders, etc.)   |
|  * src/server/finance   -> Double-Entry Accounting Ledger & Fee Calculators       |
|  * WebSockets (ws)      -> Real-Time Bi-Directional Workstream Messaging Engine   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why This Architecture Wins Senior Developer Approval

Senior developers and technical architects look for **Separation of Concerns**:

| Area | Why Next.js? | Why Express / Node.js? |
| :--- | :--- | :--- |
| **Search Engine Crawlability** | Pre-renders static HTML and embeds Schema.org JSON-LD before JavaScript boots. | Not optimized for frontend DOM rendering. |
| **Social Media Sharing** | Twitter, LinkedIn, WhatsApp, and Slack bots cannot run client JS. Next.js serves raw `<meta property="og:*">` tags. | Simply returns JSON payloads for API endpoints. |
| **Escrow & Financial Safety** | Client code must **never** touch payment credentials or execute ledger entries directly. | Acts as the authoritative source of truth for fee calculations and escrow releases. |
| **Real-time WebSockets** | Serverless / Edge Next.js routes cannot easily sustain stateful persistent WebSocket connections. | Long-running Node.js process hosts `ws.Server` for continuous bi-directional chat. |

---

## 3. SEO Implementation Deep-Dive

### A. Dynamic Metadata Generation (`app/gigs/[slug]/page.tsx`)
When a crawler or user visits `/gigs/i-will-design-figma-system`:
1. Next.js calls `generateMetadata({ params })`.
2. The server extracts the gig's title, price, delivery timeline, and cover image.
3. It emits a tailored `og:image`, `og:title`, and canonical link in the HTTP header response.

### B. Rich Schema.org Structured Data (JSON-LD)
We emit two primary Schema schemas:
- **`WebApplication` / `Organization`** in `app/layout.tsx`: Explains to Google the application's category, name, and aggregate pricing.
- **`Product` with `Offer`** in `app/gigs/[slug]/page.tsx`: Signals price, availability (`InStock`), and aggregate seller star ratings so Google displays rich review stars in search results.

### C. Automated Crawl Directives
- **`app/robots.ts`**: Allows search engine spiders to index `/`, `/gigs`, `/projects`, and `/freelancers`, while explicitly barring private routes (`/admin/`, `/workstream/`, `/api/`).
- **`app/sitemap.ts`**: Generates a live XML sitemap containing all seeded gigs and open projects with priority weighting and change frequencies.

---

## 4. Financial & Escrow Invariants (Verified by 30 Automated Tests)

Every commercial marketplace requires strict transactional boundaries. The backend enforces:
1. **Buyer 3-Day Review Window**: Delivered orders auto-accept after a configurable review window (default 3 days) unless a revision is requested or an active dispute is open.
2. **Release Before Delivery Prohibition**: Buyers cannot release escrow funds until a seller has uploaded and submitted at least one deliverable file or URL.
3. **Idempotent Escrow Releases**: Duplicate concurrent clicks on "Release Funds" cannot cause duplicate wallet deposits.
4. **Isolated Workstream Access**: Only the order's buyer, its seller, or authenticated staff (`admin`, `super_admin`, `support`) can download attached files or read workstream messages.

---

## 5. Directory Structure Quick Reference

```text
/
├── app/                           # Next.js App Router (SSR & SEO Tier)
│   ├── layout.tsx                 # Root SEO metadata, OpenGraph & JSON-LD
│   ├── page.tsx                   # SSR Pre-rendered Landing Page
│   ├── robots.ts                  # Dynamic robots.txt
│   ├── sitemap.ts                 # Dynamic XML Sitemap
│   └── gigs/
│       └── [slug]/
│           └── page.tsx           # Dynamic Gig page with generateMetadata()
├── src/
│   ├── components/                # Modular UI Components
│   │   ├── admin_modules/         # Isolated Admin modules
│   │   ├── workstream/            # Live chat, revisions, deliverable tabs
│   │   └── ui/                    # Reusable atomic UI elements
│   ├── hooks/                     # Custom React Hooks (Pagination, Filtering)
│   └── server/                    # Modular Express Backend (Core Engine Tier)
│       ├── controllers/           # Isolated request handlers
│       ├── middleware/            # Auth, Admin guards, Device verification
│       └── routes/                # Endpoint routing definitions
├── tests/                         # 30+ Automated Integration & Security Tests
├── next.config.mjs                # Next.js Proxy & Image Configuration
├── server.ts                      # Express Backend Server & WebSocket Host
└── package.json                   # Dependencies & Scripts
```

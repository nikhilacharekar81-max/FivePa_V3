# WORKPERHOUR: COMMERCIAL PLATFORM CODEBASE
## Comprehensive Architectural Index & Table of Contents

> **Edition:** Commercial Release 1.0  
> **Audience:** Senior Code Reviewers, Technical Architects, and Beginner Software Engineers  
> **Architecture Pattern:** React + Vite on Node.js/Express Backend (with Pre-Rendered HTML5 SEO & Next.js Migration Templates)

---

## Table of Contents

```
+========================================================================================+
|                                    PAGE 2: CONTENTS                                    |
+========================================================================================+
|  1. FRONT MATTER: ARCHITECTURAL OVERVIEW & MENTAL MODEL                                |
|  2. FRONTEND & SEO SUITE (Pre-rendered HTML5, Robots, Sitemaps & Next.js Templates)    |
|  3. CORE BACKEND ENGINE & TRANSACTION AUTHORITY (/server.ts)                           |
|  4. TIER 3: DOMAIN COMPONENT ARCHITECTURE (/src/components)                            |
|       * Chapter 3.1: Marketplace & Discovery                                           |
|       * Chapter 3.2: Gigs & Service Catalogs                                           |
|       * Chapter 3.3: WorkStream, Escrow Workspace & Deliverables                       |
|       * Chapter 3.4: User & Freelancer Dashboards                                      |
|       * Chapter 3.5: User Profiles & Identity Verification                             |
|       * Chapter 3.6: Platform Governance & Admin Operations (20 Modules)               |
|       * Chapter 3.7: Interactive Modals & Transaction Dialogs                          |
|       * Chapter 3.8: Atomic UI Primitives                                              |
|  5. TIER 4: APPLICATION LAYOUT & NAVIGATION (/src/layout)                              |
|  6. TIER 5: REACT HOOKS & BUSINESS LOGIC ENGINES (/src/hooks)                          |
|  7. TIER 6: SHARED UTILITIES, CRYPTOGRAPHY & FORMATTERS (/src/utils)                   |
|  8. TIER 7: TYPINGS, SCHEMAS & SEED REPOSITORIES (/src/types.ts, /src/data)            |
|  9. TIER 8: AUTOMATED REGRESSION & ESCROW TEST SUITES (/tests)                         |
| 10. TIER 9: OPERATIONAL SCRIPTS & BUILD TOOLING (/scripts)                             |
+========================================================================================+
```

---

## Detailed Directory & File Catalog

### 1. Front Matter: Architectural Overview & Mental Model
* **`docs/COMMERCIAL_ARCHITECTURE.md`**: The master technical specification detailing the separation between Next.js (client DOM & search engine crawlability) and Node.js/Express (financial transactions, escrow invariants, double-entry ledger, and WebSockets).
* **`metadata.json`**: Platform configuration and capability declarations.
* **`next.config.mjs`**: Next.js proxy rules, asset domain white-listing, and API rewrite bridges.
* **`package.json`**: Dependency graph, scripts (`dev`, `build`, `lint`, `test`, `start`).
* **`tsconfig.json`**: TypeScript strict configuration with module aliasing (`@/* -> src/*`).

---

### 2. Frontend & SEO Suite (`index.html`, `/robots.txt`, `/sitemap.xml`, and `/app` templates)
* **`index.html`**: Root entry point containing pre-rendered semantic HTML5 tags (`<header>`, `<main>`, `<h1>`, `<section>`, `<article>`), canonical URL, OpenGraph, Twitter cards, and Schema.org `WebApplication` / `Organization` JSON-LD.
* **`server.ts` (`/robots.txt` & `/sitemap.xml`)**: Serves production plain-text robots directives and dynamic XML sitemap directly via Express in the active runtime.
* **`public/robots.txt` & `public/sitemap.xml`**: Static crawler files for Vite build distribution.
* **`app/` (Next.js Templates)**: Prepared App Router templates (`app/layout.tsx`, `app/page.tsx`, `app/gigs/[slug]/page.tsx`) ready for potential future migration.

---

### 3. Tier 2: Express / Node.js Core Backend Engine (`/server.ts`, `/src/server`, `/server`)
* **`server.ts`**: Master server process hosting HTTP endpoints, cryptographic session adapters, upload handlers, and WebSocket connection broker.
* **`src/server/financeLedger.ts`**: Immutable double-entry financial ledger managing wallet balances, platform commissions, escrow reserves, and payout holds.
* **`src/server/paymentGateways.ts`**: Gateway configuration manager for Stripe, PayPal, Razorpay, Escrow.com, and local bank wires.
* **`src/server/siteSettings.ts`**: Global platform policies (buyer review window duration, commission tier percentages, maintenance flags).
* **`src/server/middleware/auth.ts`**: Isolated authentication middleware enforcing cryptographic token verification, admin role guards, and device fingerprint verification.
* **`src/server/routes/`**: Modular API router directory separating feature endpoints.
* **`src/server/controllers/`**: Business logic controllers cleanly decoupling HTTP handling from business computation.
* **`server/access.ts` & `server/store.ts`**: Secondary access-control layer and JSON state storage engine.
* **`server/db/postgresStore.ts` & `migration.sql`**: Relational PostgreSQL migration and persistent storage schema.

---

### 4. Tier 3: Domain Component Architecture (`/src/components`)

#### 4.1 Marketplace & Discovery (`src/components/marketplace/`)
* **`FreelancerSearchView.tsx`**: Filterable talent directory with hourly rate sliders, skill tags, and location search.
* **`ProjectSearchView.tsx`**: Open project catalog allowing freelancers to search jobs by budget, category, and urgency.
* **`ProjectDetailView.tsx`**: Full project specification with proposal submission form and client verified badges.
* **`index.ts`**: Unified export catalog for marketplace views.

#### 4.2 Gigs & Service Catalogs (`src/components/gigs/` & `src/components/gig_reviews/`)
* **`GigDetailView.tsx`**: Full gig specification with package tiers, add-on extras, delivery times, and buyer FAQ.
* **`CreateGigView.tsx`**: Multi-step gig builder with pricing, delivery schedules, requirements, and media uploads.
* **`EditGigModal.tsx` & `DeleteGigModal.tsx`**: Seller management dialogs for modifying live service listings.
* **`ViewingGigModal.tsx`**: Fast modal quick-view for browsing gigs without leaving catalog context.
* **`RelatedGigsSection.tsx`**: Category recommendation engine displaying related freelancer offerings.
* **`gig_reviews/Reviews.tsx`**: Star-rating breakdown, verified purchase reviews, and seller responses.

#### 4.3 WorkStream & Escrow Workspace (`src/components/workstream/`)
* **`WorkstreamWorkspace.tsx`**: The flagship order fulfillment interface uniting buyer, seller, and platform arbitrator.
* **`WorkstreamHeader.tsx`**: Order status indicator, countdown timer, and quick action bar.
* **`WorkstreamSidebar.tsx`**: Project overview, escrow deposit card, milestone list, and participant contacts.
* **`WorkstreamChatTab.tsx`**: Real-time messaging feed supporting file attachments, system alerts, and revision requests.
* **`WorkstreamFilesTab.tsx`**: Version-controlled deliverable repository with safe authenticated download links.
* **`WorkstreamPaymentTab.tsx`**: Itemized invoice history, escrow status, and release authorization triggers.
* **`WorkstreamDisputeTab.tsx`**: Formal dispute resolution room for requesting administrative arbitration.
* **`WorkstreamOffersModal.tsx`**: Interactive proposal and deposit negotiation card builder.
* **`WorkstreamDeliveryModal.tsx`**: Seller final deliverable submission modal requiring file verification.
* **`WorkstreamRevisionModal.tsx`**: Buyer revision feedback interface pausing the auto-accept countdown clock.
* **`WorkstreamAcceptModal.tsx` & `WorkstreamReviewModal.tsx`**: Escrow release confirmation and 5-star feedback submission.

#### 4.4 User & Freelancer Dashboards (`src/components/user_dashboard/`)
* **`UserDashboardView.tsx`**: Command center aggregating active orders, incoming proposals, wallet balance, and notifications.
* **`UserStatsOverview.tsx`**: Key performance indicators: completion rate, earnings, on-time delivery percentage.
* **`UserFreelanceOrdersList.tsx` & `UserFreelanceProjectsList.tsx`**: Tabular order tracking by status.
* **`UserFreelanceOffersList.tsx`**: Active quotes and proposals awaiting buyer acceptance.

#### 4.5 User Profiles & Verification (`src/components/profile/`)
* **`FreelancerProfileView.tsx`**: Public portfolio page showcasing completed jobs, client testimonials, skills, and languages.
* **`EditProfilePage.tsx`**: Comprehensive profile settings for adjusting rates, bio, certifications, and portfolio media.
* **`EditUserProfileModal.tsx`**: Fast profile editing modal.
* **`InspectUserModal.tsx`**: Deep-dive inspector allowing administrators to audit user activity logs.

#### 4.6 Platform Governance & Administration (`src/components/admin_modules/` & `src/pages/`)
* **`AdminOverviewModule.tsx`**: High-level platform telemetry: Gross Merchandise Value (GMV), net commission, active disputes.
* **`AdminUsersModule.tsx`**: User management with status toggles (`active`, `suspended`, `restricted`), impersonation, and CSV exports.
* **`AdminEscrowModule.tsx`**: Real-time escrow holdings tracker monitoring locked funds.
* **`AdminDisputesModule.tsx`**: Arbitration workbench to resolve buyer/seller disputes, grant refunds, or release escrow.
* **`AdminOrdersManager.tsx`**: Global order lifecycle inspector tracking delivery deadlines and milestone states.
* **`AdminPaymentGatewaysModule.tsx`**: Gateway API keys, toggle switches, and sandbox/production status monitors.
* **`AdminPayoutsModule.tsx` & `AdminRefundsModule.tsx`**: Withdrawal approval queue and refund audit trail.
* **`SiteFeeSettingsModule.tsx`**: Dynamic commission slider (e.g., 20% down to 5%) and buyer processing fee configuration.
* **`UserWalletsLedgerModule.tsx`**: Master financial ledger auditor inspecting individual account balances.
* **`AdminGigsModule.tsx` & `AdminProjectsModule.tsx`**: Catalog moderation queue for reviewing and approving listings.
* **`AdminPage.tsx` (`src/pages/AdminPage.tsx`)**: The full-screen administrative workstation hosting all 20 governance modules.

#### 4.7 Interactive Modals (`src/components/modals/`)
* **`LoginModal.tsx` & `SignupModal.tsx`**: Multi-factor authentication dialogs with SMS/email OTP verification.
* **`ForgotPasswordModal.tsx`**: Rate-limited password recovery modal.
* **`PostProjectModal.tsx`**: Multi-step project creation wizard with budget estimation.
* **`ProposalSubmissionModal.tsx`**: Freelancer quotation and delivery milestone proposal builder.
* **`DepositFundsModal.tsx`**: Wallet top-up interface supporting credit card, PayPal, and simulated dev deposits.
* **`ContactFreelancerModal.tsx`**: Direct pre-hire inquiry message modal.

#### 4.8 Atomic UI Primitives (`src/components/ui/`)
* **`index.ts`**: Reusable design system atoms (badge indicators, status chips, loading skeletons).

---

### 5. Tier 4: Layout & Navigation (`/src/layout`)
* **`Header.tsx`**: Main application navbar featuring user wallet balances, notifications bell, search, and navigation links.
* **`HeaderCategoriesNav.tsx`**: Multi-tiered taxonomy bar featuring flyout menus for AI Services, Web Development, Design, etc.
* **`Footer.tsx`**: SEO footer links, copyright notices, trust badges, and currency/language selectors.
* **`ImpersonationBanner.tsx`**: Sticky alert ribbon warning administrators when browsing under an impersonated session.
* **`index.ts`**: Clean layout export hub.

---

### 6. Tier 5: React Hooks & Business Logic Engines (`/src/hooks`)
* **`useAppData.ts`**: Core client store hook managing synchronized users, gigs, projects, orders, and authentication tokens.
* **`admin/usePagination.ts`**: Slice-based pagination controller with boundary checking and current page navigation.
* **`admin/useLocalStorageFilter.ts`**: Persistent client filter synchronizing deleted/hidden record IDs with browser `localStorage`.
* **`workstream/useWorkstream.ts`**: Master controller binding chat, WebSocket subscriptions, delivery state, and escrow actions.
* **`workstream/useWorkstreamEscrow.ts`**: Escrow release dispatchers and invoice resolution handlers.
* **`workstream/useWorkstreamDelivery.ts`**: Multi-version deliverable file uploader and verification checker.
* **`workstream/useWorkstreamMessages.ts`**: Deduplicated message transmission with retry buffers and metadata validation.
* **`workstream/useWorkstreamRealtime.ts`**: Resilient WebSocket client with automatic reconnection and heartbeat ping/pong.

---

### 7. Tier 6: Shared Utilities, Cryptography & Formatters (`/src/utils`)
* **`authToken.ts`**: Client session storage handlers (`setAuthToken`, `getAuthToken`, `removeAuthToken`).
* **`deviceId.ts`**: Persistent client device fingerprint generator for new-device verification challenges.
* **`formatters.tsx`**: Currency formatters, badge style resolvers, and star-rating icon generators.
* **`messageTime.ts`**: Relative timestamp and message header date partitioners.
* **`safeFileLink.ts`**: Secure file URL validator preventing XSS, malicious schemes, and unauthorized executable downloads.
* **`slugify.ts`**: URL slug generator transforming titles into SEO-friendly permalinks.
* **`workstreamUpload.ts`**: Deliverable multipart upload helper with progress feedback.

---

### 8. Tier 7: Typings & Datasets (`/src/types.ts`, `/src/data`)
* **`src/types.ts`**: Master TypeScript interface registry (`UserAccount`, `Gig`, `Project`, `Proposal`, `Order`, `Review`, `Message`, `FinancialLedgerEntry`).
* **`src/shared/fees.ts`**: Isomorphic fee calculation engine calculating small order fees, platform commission, and seller net.
* **`src/data/completeSeedDataset.ts`**: Comprehensive production seed data consisting of 10 users, 10 gigs, active orders, and reviews.

---

### 9. Tier 8: Automated Regression & Escrow Test Suites (`/tests`)
* **`tests/fees.test.ts` & `fee-wiring.test.ts`**: Mathematical verification of tiered fee percentages and rounding rules.
* **`tests/workstream.test.ts`**: End-to-end order lifecycle simulation (Proposal -> Escrow Funding -> Delivery -> Release).
* **`tests/workstream-security.test.ts`**: Access-control test ensuring non-participants cannot read messages or intercept files.
* **`tests/auto-accept.test.ts`**: Simulation of the 3-day review window, testing auto-release timers, revision freezes, and dispute holds.
* **`tests/safe-file-link.test.ts`**: Security verification preventing arbitrary script execution through file links.
* **`tests/patch-verification.test.ts`**: Comprehensive 8-rule escrow idempotency, invoice validation, and concurrent release stress test.

---

### 10. Tier 9: Operational Scripts & Build Tooling (`/scripts`)
* **`scripts/generate_fresh_dataset.js`**: Data generator for creating fresh demo marketplaces.
* **`scripts/verify-build.mjs` & `stamp-build.mjs`**: Pre-deployment verification and build manifest stamping.

---

*End of Table of Contents — WorkPerHour Commercial Codebase.*

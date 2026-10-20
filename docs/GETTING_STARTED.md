# Beginner's Guide: Getting Started with WorkPerHour
> A step-by-step textbook tutorial for junior developers, students, and new team members.

---

## 1. The Big Picture: How This App Works

WorkPerHour is built like a modern two-story building:

1. **The Ground Floor (Frontend)**:
   * **React & Vite**: Renders the dynamic frontend, handles user actions, forms, animations, and client-side interactions.
   * **Pre-rendered HTML5 & SEO**: The server pre-renders full semantic HTML5 tags and Schema.org JSON-LD in `index.html` so search bots see complete content immediately.
   * **Tailwind CSS**: Styles everything with clean utility classes (colors, spacing, responsive grids).

2. **The Engine Room (Backend)**:
   * **Node.js & Express**: Runs the core logic that buyers and sellers must trust — locking escrow money, taking orders, calculating 20% platform commissions, serving `/robots.txt` and `/sitemap.xml`, and verifying passwords.
   * **WebSockets**: A persistent radio link that delivers chat messages and delivery alerts in milliseconds without refreshing the browser.

```
[ Browser / User / Bot ] 
       |
       v (HTTP request)
[ Express Server ] ---> Serves full pre-rendered HTML5, robots.txt & sitemap.xml
       |
       v (API Fetch /api/*)
       |
       +---> [ Double-Entry Financial Ledger ] (Calculates fees & escrow)
       +---> [ WebSocket Broker ] (Pushes live chat & alerts)
       +---> [ JSON/Postgres Storage ] (Saves users, gigs, messages)
```

---

## 2. Quickstart in 3 Commands

### Step 1: Install Dependencies
```bash
npm install
```
Installs all required packages listed in `package.json`.

### Step 2: Start the Development Server
```bash
npm run dev
```
Starts the full-stack server on `http://localhost:3000`. You can now open your browser and explore the marketplace!

### Step 3: Run the Automated Tests
```bash
npm test
```
Runs our **30 automated tests** checking that money cannot be stolen, escrow cannot be released without delivery, and passwords cannot be leaked.

---

## 3. Demo Accounts to Test With

You don't need to create accounts from scratch to test features. These accounts are pre-seeded in the database:

| Name | Role | Email | Password | What to Test |
| :--- | :--- | :--- | :--- | :--- |
| **Alex Rivera** | Buyer / Client | `alex@workperhour.com` | `Password123!` | Post projects, fund escrow, review work, release payments |
| **Elena Rostova** | Top Freelancer | `elena@design.io` | `Password123!` | Create gigs, submit proposals, upload deliverables |
| **Super Admin** | Platform Admin | `admin@workperhour.com` | (Set in `.env`) | Access `/admin` dashboard to resolve disputes, adjust site fees |

---

## 4. How to Add Your First Feature (Beginner Exercise)

Let's say you want to add a new category badge or change the color of a button:

1. **Find the Component**: Check `TABLE_OF_CONTENTS.md` to see which folder contains the component.
   * For the header navbar, look in `src/layout/Header.tsx`.
   * For gig cards, look in `src/components/gigs/GigDetailView.tsx`.
   * For the order chat, look in `src/components/workstream/WorkstreamChatTab.tsx`.

2. **Make the Change**:
   Open the file and modify the React JSX. All components use standard TypeScript and Tailwind CSS classes.

3. **Verify Your Work**:
   Run the linter and tests to make sure nothing broke:
   ```bash
   npm run lint
   npm test
   ```
   If both commands return exit code `0`, your code is clean and ready for pull request!

---

## 5. Golden Rules for Writing Code Here

* **Rule 1: Never Put Secret Keys in the Frontend**: Any API key (like Gemini or payment credentials) must stay on the server side (`server.ts` or `src/server/`).
* **Rule 2: Don't Use `any` in TypeScript**: Give your variables clear types. If you're working with an order, type it as `Order`; if a user, type it as `UserAccount` from `src/types.ts`.
* **Rule 3: Keep Components Small**: If a component exceeds 250 lines, split it into smaller sub-components inside that domain folder.

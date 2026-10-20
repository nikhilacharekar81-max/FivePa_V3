# WorkPerHour: Complete REST & WebSocket API Reference
> Textbook reference guide detailing request payloads, response structures, authentication headers, and error codes for both senior reviewers and beginners.

---

## 1. Authentication & Security Headers

All authenticated API requests require an HTTP `Authorization` header containing the user's JWT bearer token:

```http
Authorization: Bearer <jwt_session_token>
```

When multi-device verification is enabled, requests may include the device fingerprint:
```http
X-Device-Id: <client_generated_uuid>
```

---

## 2. API Endpoints Catalog

### A. Authentication & User Sessions
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate with email and password | None |
| `POST` | `/api/auth/register` | Create a new buyer/seller account | None |
| `GET` | `/api/auth/me` | Fetch currently authenticated user profile | Bearer Token |
| `POST` | `/api/auth/logout` | Invalidate current session and tokens | Bearer Token |
| `POST` | `/api/auth/send-code` | Request email/SMS 6-digit verification code | None |
| `POST` | `/api/auth/verify-code` | Verify 6-digit code for 2FA or registration | None |

#### Example: `POST /api/auth/login`
**Request Payload:**
```json
{
  "email": "alex@workperhour.com",
  "password": "Password123!"
}
```
**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_1",
    "name": "Alex Rivera",
    "email": "alex@workperhour.com",
    "role": "user",
    "walletBalance": 3500,
    "verified": true
  }
}
```

---

### B. Marketplace, Gigs & Projects
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/gigs` | List all active gigs with category filters | None |
| `GET` | `/api/gigs/:id` | Get detailed gig specification & extras | None |
| `POST` | `/api/gigs` | Create a new gig offering | Freelancer |
| `GET` | `/api/projects` | List open buyer project listings | None |
| `POST` | `/api/projects` | Post a new job with budget & milestones | Buyer |
| `POST` | `/api/proposals` | Submit a custom bid/proposal on a project | Freelancer |

---

### C. Escrow, WorkStream & Order Fulfillment
| Method | Endpoint | Description | Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | Instantiate new order and lock escrow deposit | Buyer only |
| `GET` | `/api/orders/:id` | Fetch order status, milestones, and fee split | Participant or Admin |
| `POST` | `/api/orders/:id/deliver` | Seller delivers files and notes | Must upload real file |
| `POST` | `/api/orders/:id/revision` | Buyer requests revision | Pauses auto-accept timer |
| `POST` | `/api/orders/:id/release` | Buyer releases escrow to seller wallet | Idempotent; requires delivery |
| `POST` | `/api/orders/:id/dispute` | Escalate order to admin arbitration | Freezes escrow release |

#### Example: `POST /api/orders/:id/deliver`
**Request Payload:**
```json
{
  "files": [
    {
      "id": "upl_92a71bf",
      "filename": "Design_System_v1.zip",
      "size": 1420580,
      "url": "/api/workstream/uploads/upl_92a71bf"
    }
  ],
  "notes": "Here is the final deliverable. All source vectors and tokens are included."
}
```

---

### D. Financial Ledger & Wallet Operations
| Method | Endpoint | Description | Rules |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/wallet/balance` | Fetch user's cleared & pending balance | Authenticated User |
| `GET` | `/api/wallet/transactions` | Full double-entry ledger statement | Read-only |
| `POST` | `/api/wallet/withdraw` | Request payout to verified bank/PayPal | Requires cleared balance |

---

### E. Real-Time WebSocket Channel (`ws://`)
* **Endpoint**: `ws://<host>:<port>`
* **Authentication**: Handshake message `{ "type": "AUTH", "token": "<jwt>" }`
* **Events Emitted**:
  - `MESSAGE_RECEIVED`: New live chat message
  - `DELIVERY_SUBMITTED`: Seller uploaded work
  - `ESCROW_RELEASED`: Funds credited to seller wallet
  - `REVISION_REQUESTED`: Buyer requested changes

---

## 3. Standard Error Envelope

All API errors return consistent JSON responses with appropriate HTTP status codes:

```json
{
  "error": "Cannot release escrow before seller has submitted a delivery.",
  "code": "PREMATURE_ESCROW_RELEASE",
  "status": 400
}
```

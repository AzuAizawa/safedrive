# Xendit Integration Plan — SafeDrive

> **Status:** ✅ Implemented  
> **Last Updated:** January 2025  
> **Provider:** Xendit (Philippines)

---

## 1. Payment Architecture

SafeDrive uses Xendit to handle all rental payments in the Philippines. The flow follows a three-stage architecture:

### Stage 1: Collection (Pay-In)
- **When:** Renter's booking is accepted by the owner
- **How:** System creates a Xendit Invoice via `POST /v2/invoices`
- **Methods:** GCash, GrabPay, Maya, Credit Card, BPI, BDO, UnionBank
- **Duration:** Invoice valid for 24 hours
- **Result:** Payment credited to SafeDrive's Xendit Balance (escrow-style)

### Stage 2: Split Logic (Automatic Calculation)
When a booking is created, the system automatically calculates:

| Component | Formula | Example (₱4,200) |
|-----------|---------|-------------------|
| **Total Amount (A)** | daily_rate × days | ₱4,200 |
| **Platform Commission (B)** | A × 10% | ₱420 |
| **Owner Share (C)** | A - B | ₱3,780 |

### Stage 3: Payout (Lazy Transfer)
- **When:** After rental `end_date` passes and payment is confirmed
- **How:** Edge Function creates a Xendit Payout Link via `POST /payout_links`
- **Owner receives:** Email/SMS with a claim link
- **Owner provides:** Their preferred bank/e-wallet details when claiming
- **Zero data liability:** Platform never stores owner bank credentials

---

## 2. Booking Flow (from `new_setup_plan.md`)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Renter searches & selects vehicle                     │
│ 2. Renter picks dates (min: today + 2 days)             │
│ 3. Renter clicks "Request to book"                      │
│    → Status: PENDING                                     │
│    → Notification sent to owner                          │
├─────────────────────────────────────────────────────────┤
│ 4. Owner has 24h to Accept or Decline                   │
│    → If no action in 24h: auto-EXPIRED                  │
│    → If accepted: Status → CONFIRMED                     │
│    → payment_deadline set (24h from acceptance)          │
├─────────────────────────────────────────────────────────┤
│ 5. Renter has 24h to pay via Xendit Invoice             │
│    → Click "Pay Now" → Xendit checkout page              │
│    → Payment methods: GCash, Maya, Card, Bank            │
│    → If not paid in 24h: auto-EXPIRED                   │
│    → If paid: payment_status → "paid"                   │
├─────────────────────────────────────────────────────────┤
│ 6. Rental period occurs                                  │
│    → Xendit holds funds (escrow-style)                  │
├─────────────────────────────────────────────────────────┤
│ 7. After end_date passes:                               │
│    → Edge Function triggers Payout Link creation        │
│    → Owner receives claim link via email                │
│    → Owner claims 90%, platform keeps 10%               │
│    → Status → COMPLETED                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Technical Implementation

### 3.1. Client Library: `src/lib/xendit.js`

| Function | Purpose |
|----------|---------|
| `createBookingInvoice()` | Creates Xendit Invoice for renter payment |
| `checkInvoiceStatus()` | Verifies payment status with Xendit |
| `calculateSplit()` | Computes 90/10 commission split |
| `getMinBookingStartDate()` | Returns today + 2 days |
| `getDeadline()` | Returns ISO timestamp N hours from now |
| `isDeadlinePassed()` | Checks if a deadline has expired |
| `getTimeRemaining()` | Human-readable countdown ("23h 45m") |
| `formatPHP()` | Formats amount as ₱X,XXX |

### 3.2. Supabase Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `xendit-auto-expire` | Hourly cron / manual | Expires pending bookings (24h no owner response) and unpaid confirmed bookings |
| `xendit-process-payout` | Hourly cron / manual | Creates Payout Links for completed rentals |
| `xendit-webhook` | Xendit callback | Handles invoice paid/expired and payout succeeded/failed events |

### 3.3. Webhook URL
Configure in Xendit Dashboard → Settings → Webhooks:
```
https://hfduyehriemnfgkecmtj.supabase.co/functions/v1/xendit-webhook
```

### 3.4. Environment Variables

| Variable | Location | Description |
|----------|----------|-------------|
| `VITE_XENDIT_SECRET_KEY` | `.env` (frontend) | Xendit API key for Invoice creation |
| `XENDIT_SECRET_KEY` | Supabase Edge Function secrets | Xendit API key for Payout Link creation |

---

## 4. Security

### Idempotency
- Every Invoice uses `external_id: SAFEDRIVE-BOOKING-{booking_id}`
- Every Payout uses `external_id: SAFEDRIVE-PAYOUT-{booking_id}`
- Prevents duplicate charges/payouts

### API Key Best Practice
- **Frontend:** Uses `VITE_XENDIT_SECRET_KEY` for Invoice creation only
  - ⚠️ Consider moving Invoice creation to a Supabase Edge Function for production
- **Edge Functions:** Uses `XENDIT_SECRET_KEY` (server-side only, never exposed)

### Deadline Enforcement
- Owner approval window: 24 hours (enforced by `xendit-auto-expire`)
- Renter payment window: 24 hours (enforced by `xendit-auto-expire`)
- Payout link expiration: Set by Xendit (configurable)

### Webhook Verification
- Webhook endpoint is JWT-free (Xendit doesn't send JWTs)
- Consider adding `x-callback-token` verification for production
- All webhook events are idempotent (safe to replay)

---

## 5. Benefits of This Approach

### Lazy Payout (No Bank Details Upfront)
- ✅ Zero data liability — platform never stores bank/e-wallet info
- ✅ Owner chooses destination at claim time
- ✅ No KYC friction during onboarding
- ✅ Supports GCash, Maya, bank transfer, etc.

### Escrow-Style Holding
- ✅ Money held until rental completes
- ✅ Protects both renter and owner
- ✅ Platform commission deducted automatically

### Automated Expiry
- ✅ No orphaned bookings
- ✅ Dates freed automatically on expiry
- ✅ Both parties notified

---

## 6. Database Schema (Relevant Columns)

### `bookings` table
```sql
-- Xendit payment columns
xendit_invoice_id      TEXT     -- Xendit Invoice ID
xendit_external_id     TEXT     -- SAFEDRIVE-BOOKING-{id}
xendit_payment_url     TEXT     -- Xendit checkout URL
xendit_payout_id       TEXT     -- Xendit Payout Link ID
payment_status         TEXT     -- unpaid | pending | paid | failed | refunded
payout_status          TEXT     -- pending | processing | completed | failed
commission_amount      NUMERIC  -- Platform commission (10%)
owner_payout_amount    NUMERIC  -- Owner share (90%)
booking_accepted_at    TIMESTAMPTZ  -- When owner accepted
payment_deadline       TIMESTAMPTZ  -- 24h after acceptance
```

### Status Flow
```
Booking Status:  pending → confirmed → completed
                        ↘ expired (if not paid)
               pending → expired (if owner doesn't respond)
               pending → cancelled (by either party)

Payment Status:  unpaid → pending → paid
                                   → failed → pending (retry)

Payout Status:   pending → processing → completed
                                       → failed
```
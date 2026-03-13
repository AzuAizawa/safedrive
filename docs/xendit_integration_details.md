# Xendit Integration Details — SafeDrive

> **Status:** ✅ Implemented  
> **Last Updated:** January 2025  

---

## 1. Platform Overview

SafeDrive uses **Xendit** as its payment provider for the Philippines market. The integration handles:

1. **Pay-In (Collection):** Renter pays via Xendit Invoice (GCash, Maya, Card, Bank)
2. **Escrow:** Funds held in SafeDrive's Xendit Balance until rental completes
3. **Pay-Out (Distribution):** Owner receives 90% via Xendit Payout Link after rental ends

---

## 2. Key Features

### Escrow-Style Payment Holding
- Renter payment is collected into SafeDrive's Xendit Balance
- Money is **not** immediately transferred to the owner
- Held until the rental `end_date` passes, ensuring completion

### Automated Commission Split
- **Platform Commission:** 10% of total booking amount
- **Owner Payout:** 90% of total booking amount
- Split is calculated at booking creation and stored in `commission_amount` and `owner_payout_amount` columns

### Lazy Payout (No Upfront Bank Details)
- Owners do **not** need to provide bank/e-wallet details during registration
- After rental completes, system creates a **Xendit Payout Link**
- Owner receives an email/SMS with a claim URL
- Owner chooses their preferred payout method (GCash, Maya, bank) when claiming
- **Zero data liability** — SafeDrive never stores owner financial credentials

### Automated Expiry & Cleanup
- **Pending bookings:** Auto-expire after 24h if owner doesn't respond
- **Confirmed bookings:** Auto-expire after 24h if renter doesn't pay
- **Blocked dates:** Automatically freed when bookings expire
- **Notifications:** Both parties notified on expiry

---

## 3. Detailed Flow

### 3.1. Booking Creation (Renter)
```
Renter picks dates → Clicks "Request to book"
→ bookings.insert({
    status: 'pending',
    payment_status: 'unpaid',
    payout_status: 'pending',
    commission_amount: total * 0.10,
    owner_payout_amount: total * 0.90
  })
→ Notification sent to owner
```

### 3.2. Owner Acceptance
```
Owner clicks "Accept"
→ bookings.update({
    status: 'confirmed',
    booking_accepted_at: now(),
    payment_deadline: now() + 24h
  })
→ Vehicle dates blocked in vehicle_availability
→ Notification sent to renter: "Pay within 24 hours"
```

### 3.3. Renter Payment
```
Renter clicks "Pay Now"
→ createBookingInvoice() → POST /v2/invoices (Xendit API)
→ bookings.update({
    xendit_invoice_id: invoice.id,
    xendit_external_id: 'SAFEDRIVE-BOOKING-{id}',
    xendit_payment_url: invoice.invoice_url,
    payment_status: 'pending'
  })
→ Renter redirected to Xendit checkout (GCash/Maya/Card/Bank)
→ On success: redirect to /payment/success?booking_id={id}
→ On failure: redirect to /payment/failed?booking_id={id}
```

### 3.4. Payment Confirmation
```
PaymentSuccess page:
→ checkInvoiceStatus(xendit_invoice_id)
→ If PAID/SETTLED:
    bookings.update({ payment_status: 'paid' })
    Notify owner: "Payment received!"

Xendit Webhook (backup):
→ POST /functions/v1/xendit-webhook
→ Same logic as above (idempotent)
```

### 3.5. Post-Rental Payout
```
xendit-process-payout Edge Function (runs hourly):
→ Find bookings WHERE:
    status = 'confirmed'
    payment_status = 'paid'
    payout_status = 'pending'
    end_date <= today
→ For each booking:
    POST /payout_links (Xendit API)
    bookings.update({
      payout_status: 'processing',
      xendit_payout_id: payout.id,
      status: 'completed'
    })
    Notify owner: "Payout ready! Check your email."
```

### 3.6. Payout Completion
```
Xendit Webhook:
→ payout_link status = SUCCEEDED/CLAIMED
→ bookings.update({ payout_status: 'completed' })

→ payout_link status = FAILED
→ bookings.update({ payout_status: 'failed' })
```

---

## 4. Database Changes

### New Columns Added to `bookings`

| Column | Type | Purpose |
|--------|------|---------|
| `booking_accepted_at` | `timestamptz` | When owner clicked Accept |
| `payment_deadline` | `timestamptz` | 24h after acceptance (auto-expire if unpaid) |
| `xendit_payout_id` | `text` | Xendit Payout Link ID |

### Existing Columns Used

| Column | Type | Purpose |
|--------|------|---------|
| `xendit_invoice_id` | `text` | Xendit Invoice ID |
| `xendit_external_id` | `text` | Idempotency key (`SAFEDRIVE-BOOKING-{id}`) |
| `xendit_payment_url` | `text` | Checkout URL for renter |
| `payment_status` | `text` | `unpaid` → `pending` → `paid` / `failed` |
| `payout_status` | `text` | `pending` → `processing` → `completed` / `failed` |
| `commission_amount` | `numeric` | Platform fee (10%) |
| `owner_payout_amount` | `numeric` | Owner share (90%) |

### Status Constraints Updated
```sql
-- Booking status now includes 'expired'
CHECK (status IN ('pending','confirmed','active','completed','cancelled','disputed','expired'))

-- Payment status includes full lifecycle
CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','not_applicable'))
```

---

## 5. Supabase Edge Functions

### `xendit-auto-expire`
- **Purpose:** Automatically expire stale bookings
- **JWT:** Disabled (service role key used internally)
- **Logic:**
  1. Find `pending` bookings older than 24h → set to `expired`
  2. Find `confirmed` bookings past `payment_deadline` with `unpaid`/`pending` payment → set to `expired`
  3. Free blocked dates in `vehicle_availability`
  4. Notify affected users

### `xendit-process-payout`
- **Purpose:** Create Payout Links for completed rentals
- **JWT:** Disabled (service role key used internally)
- **Requires:** `XENDIT_SECRET_KEY` environment variable
- **Logic:**
  1. Find `confirmed` + `paid` bookings past `end_date` with `pending` payout
  2. Create Xendit Payout Link for owner's share
  3. Update booking to `completed` + `processing` payout
  4. Notify owner with claim instructions

### `xendit-webhook`
- **Purpose:** Handle Xendit callback events
- **JWT:** Disabled (Xendit sends raw POST requests)
- **Handles:**
  - Invoice `PAID`/`SETTLED` → Update `payment_status` to `paid`
  - Invoice `EXPIRED` → Update `payment_status` to `failed`
  - Payout `SUCCEEDED`/`CLAIMED` → Update `payout_status` to `completed`
  - Payout `FAILED` → Update `payout_status` to `failed`

---

## 6. Frontend Components Updated

### `src/lib/xendit.js` (New)
- Client library for Xendit API calls
- Contains all payment-related utility functions
- Exports commission rates, deadline helpers, formatters

### `src/pages/VehicleDetail.jsx` (Updated)
- Min start date enforced (today + 2 days)
- Flexible-only pricing (daily rate × days)
- Commission split displayed in booking summary
- Booking flow info tooltips

### `src/pages/Bookings.jsx` (Updated)
- Owner: Accept/Decline with 24h countdown
- Renter: Pay Now button (creates Xendit Invoice)
- Renter: "I already paid" verification button
- Payment status badges (Unpaid, Pending, Paid, Failed)
- Payout status badges (Pending, Processing, Paid Out, Failed)
- Deadline countdown timers (auto-refresh every minute)
- Booking detail modal with commission breakdown

### `src/pages/PaymentSuccess.jsx` (Updated)
- Verifies payment with Xendit on page load
- Updates booking payment_status to 'paid'
- Notifies owner of payment receipt
- Shows booking summary

### `src/pages/PaymentFailed.jsx` (Updated)
- Xendit-specific error messaging
- 24h payment deadline reminder
- Retry link to bookings page

### `src/App.jsx` (Updated)
- Added `/payment/success` route
- Added `/payment/failed` route

### `src/lib/ui.js` (Updated)
- Added `expired` and `active` booking status styling

---

## 7. Setup Checklist

### Platform Admin (One-Time)
- [ ] Set `VITE_XENDIT_SECRET_KEY` in `.env`
- [ ] Set `XENDIT_SECRET_KEY` as Supabase Edge Function secret
- [ ] Configure webhook URL in Xendit Dashboard
- [ ] Set up cron jobs for Edge Functions (recommended: hourly)
- [ ] Test with Xendit test mode keys first

### Xendit Dashboard Configuration
1. Go to **Settings → Webhooks**
2. Add webhook URL: `https://hfduyehriemnfgkecmtj.supabase.co/functions/v1/xendit-webhook`
3. Enable events: `invoices`, `payout_links`

### Car Owners
- ✅ No upfront setup required
- ✅ Payout details provided when claiming via Payout Link
- ✅ Supports GCash, Maya, bank transfer

---

## 8. Testing

### Test Payment Flow
1. Create a booking with test dates
2. Accept as owner → Verify `payment_deadline` is set
3. Click "Pay Now" as renter → Use Xendit test card/GCash
4. Verify redirect to `/payment/success`
5. Check `payment_status` is `paid` in database

### Test Auto-Expiry
1. Create a booking, don't accept for 24h
2. Call `xendit-auto-expire` manually
3. Verify booking is `expired` and dates are freed

### Test Payout
1. Complete a booking flow end-to-end
2. Set `end_date` to a past date (for testing)
3. Call `xendit-process-payout` manually
4. Verify Payout Link is created in Xendit Dashboard

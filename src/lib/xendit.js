/**
 * Xendit Payment Service — SafeDrive Booking Payments
 * ====================================================
 * SafeDrive uses Xendit to handle rental payments:
 *
 * HOW THE MONEY FLOW WORKS:
 * 1. Renter requests to book a car → Owner has 24h to accept
 * 2. Owner accepts → System generates Xendit Invoice
 * 3. Renter has 24h to pay via GCash/Maya/Card/Bank Transfer
 * 4. Once paid → Xendit holds the money (escrow-style)
 * 5. After rental end date → Funds are distributed:
 *    - 90% to Car Owner
 *    - 10% to SafeDrive Platform (commission)
 *
 * COMMISSION SPLIT:
 * - Platform commission: 10% (placeholder, adjustable)
 * - Owner receives: 90%
 *
 * ENV SETUP:
 *   VITE_XENDIT_SECRET_KEY=xnd_development_xxxx (or xnd_production_xxx)
 */

const XENDIT_API = 'https://api.xendit.co';
const SECRET_KEY = import.meta.env.VITE_XENDIT_SECRET_KEY;

export const PLATFORM_COMMISSION_RATE = 0.10; // 10% platform cut
export const OWNER_SHARE_RATE = 1 - PLATFORM_COMMISSION_RATE; // 90% to owner
export const MIN_BOOKING_LEAD_DAYS = 2; // 2 days minimum lead time (24h approve + 24h pay)
export const OWNER_APPROVAL_HOURS = 24;
export const RENTER_PAYMENT_HOURS = 24;

/**
 * Get base64-encoded auth header for Xendit API
 */
const getAuthHeader = () => {
    if (!SECRET_KEY) {
        console.warn('⚠️ Xendit secret key not set. Add VITE_XENDIT_SECRET_KEY to .env');
        return null;
    }
    return `Basic ${btoa(SECRET_KEY + ':')}`;
};

/**
 * Create a Xendit Invoice for a booking payment.
 * The renter will be redirected to this invoice to pay.
 *
 * @param {object} params
 * @param {string} params.bookingId - The booking UUID
 * @param {number} params.amount - Total amount in PHP
 * @param {string} params.description - Description for the invoice
 * @param {string} params.payerEmail - Renter's email
 * @param {string} params.successRedirectUrl - URL to redirect on success
 * @param {string} params.failureRedirectUrl - URL to redirect on failure
 * @returns {{ invoiceId: string, invoiceUrl: string, externalId: string }}
 */
export async function createBookingInvoice({
    bookingId,
    amount,
    description,
    payerEmail,
    successRedirectUrl,
    failureRedirectUrl,
}) {
    const authHeader = getAuthHeader();
    if (!authHeader) {
        throw new Error('Payment gateway not configured. Please contact support.');
    }

    const externalId = `SAFEDRIVE-BOOKING-${bookingId}`;

    const response = await fetch(`${XENDIT_API}/v2/invoices`, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            external_id: externalId,
            amount: amount,
            currency: 'PHP',
            description: description,
            payer_email: payerEmail,
            success_redirect_url: successRedirectUrl,
            failure_redirect_url: failureRedirectUrl,
            payment_methods: ['GCASH', 'GRABPAY', 'PAYMAYA', 'CREDIT_CARD', 'BPI', 'BDO', 'UNIONBANK'],
            invoice_duration: RENTER_PAYMENT_HOURS * 3600, // 24 hours in seconds
            metadata: {
                booking_id: bookingId,
                platform: 'SafeDrive',
            },
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        const errMsg = data?.message || data?.error_code || 'Failed to create payment invoice';
        throw new Error(errMsg);
    }

    return {
        invoiceId: data.id,
        invoiceUrl: data.invoice_url,
        externalId: externalId,
    };
}

/**
 * Check the status of a Xendit Invoice
 *
 * @param {string} invoiceId - The Xendit Invoice ID
 * @returns {{ status: string, amount: number, paidAt: string|null }}
 */
export async function checkInvoiceStatus(invoiceId) {
    const authHeader = getAuthHeader();
    if (!authHeader) throw new Error('Payment gateway not configured.');

    const response = await fetch(`${XENDIT_API}/v2/invoices/${invoiceId}`, {
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error('Could not verify payment status.');
    }

    return {
        status: data.status, // PENDING, PAID, SETTLED, EXPIRED
        amount: data.amount,
        paidAt: data.paid_at || null,
    };
}

/**
 * Calculate the commission split for a booking
 *
 * @param {number} totalAmount - The total booking amount
 * @returns {{ commission: number, ownerPayout: number }}
 */
export function calculateSplit(totalAmount) {
    const commission = Math.round(totalAmount * PLATFORM_COMMISSION_RATE);
    const ownerPayout = totalAmount - commission;
    return { commission, ownerPayout };
}

/**
 * Get the minimum allowed start date for new bookings
 * (today + MIN_BOOKING_LEAD_DAYS to allow for approval + payment windows)
 *
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
export function getMinBookingStartDate() {
    const date = new Date();
    date.setDate(date.getDate() + MIN_BOOKING_LEAD_DAYS);
    return date.toISOString().split('T')[0];
}

/**
 * Calculate the deadline timestamp (24 hours from now)
 *
 * @param {number} hours - Number of hours from now
 * @returns {string} ISO timestamp
 */
export function getDeadline(hours = 24) {
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + hours);
    return deadline.toISOString();
}

/**
 * Check if a deadline has passed
 *
 * @param {string} deadline - ISO timestamp
 * @returns {boolean}
 */
export function isDeadlinePassed(deadline) {
    if (!deadline) return false;
    return new Date() > new Date(deadline);
}

/**
 * Get remaining time until a deadline in a human-readable format
 *
 * @param {string} deadline - ISO timestamp
 * @returns {string} e.g. "23h 45m" or "Expired"
 */
export function getTimeRemaining(deadline) {
    if (!deadline) return '';
    const now = new Date();
    const end = new Date(deadline);
    const diffMs = end - now;

    if (diffMs <= 0) return 'Expired';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Format Philippine Peso amount for display
 * @param {number} amount
 * @returns {string} e.g. "₱4,200"
 */
export function formatPHP(amount) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount || 0);
}

/**
 * PayMongo Payment Service
 * ========================
 * PayMongo is a Philippine payment processor.
 *
 * 💸 COST: FREE TO START
 * - No monthly fee, no setup fee
 * - Only charged per transaction:
 *   • Credit/Debit card: 3.5% per transaction
 *   • GCash (e-wallet): 2.5% per transaction
 *   • Maya (PayMaya): 2.5% per transaction
 *   • Bank transfers: ₱25 flat fee
 * - Sign up free at: https://dashboard.paymongo.com/signup
 *
 * SETUP STEPS:
 * 1. Go to https://dashboard.paymongo.com/signup
 * 2. Register your business (can use student/personal for testing)
 * 3. Get your TEST API keys from Dashboard → Developers → API Keys
 * 4. Add to .env:
 *    VITE_PAYMONGO_PUBLIC_KEY=pk_test_xxxxxxxxxxxx
 *    VITE_PAYMONGO_SECRET_KEY=sk_test_xxxxxxxxxxxx  (add to Supabase Edge Function, NOT frontend)
 * 5. For production, get LIVE keys after KYC verification
 *
 * ARCHITECTURE:
 * - Frontend calls createPaymentLink() to get a checkout URL
 * - User is redirected to PayMongo's hosted checkout page (GCash/card/Maya)
 * - On success, PayMongo redirects to /payment/success?booking_id=xxx
 * - On failure, redirects to /payment/failed
 * - Webhook (via Supabase Edge Function) updates booking payment_status
 */

const PAYMONGO_API = 'https://api.paymongo.com/v1';
const PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY;

// Encode credentials for Basic Auth
const getAuthHeader = () => {
    if (!PUBLIC_KEY) {
        console.warn('⚠️ PayMongo public key not set. Add VITE_PAYMONGO_PUBLIC_KEY to .env');
        return null;
    }
    return `Basic ${btoa(PUBLIC_KEY + ':')}`;
};

/**
 * Create a PayMongo payment link for a booking.
 * Returns { url, linkId } on success, throws on error.
 *
 * @param {object} booking - The booking object from the database
 * @param {object} vehicle - The vehicle object (for description)
 * @returns {{ url: string, linkId: string }}
 */
export async function createPaymentLink(booking, vehicle) {
    const authHeader = getAuthHeader();
    if (!authHeader) {
        throw new Error('Payment gateway not configured. Please contact support.');
    }

    // Amount in centavos (PayMongo requires integer centavos)
    const amountCentavos = Math.round((booking.total_amount || 0) * 100);
    if (amountCentavos < 10000) { // Min ₱100
        throw new Error('Payment amount too low. Minimum is ₱100.');
    }

    const description = `SafeDrive Rental: ${vehicle?.make || ''} ${vehicle?.model || ''} (${booking.total_days} day${booking.total_days !== 1 ? 's' : ''})`;
    const successUrl = `${window.location.origin}/payment/success?booking_id=${booking.id}`;
    const failedUrl = `${window.location.origin}/payment/failed?booking_id=${booking.id}`;

    const response = await fetch(`${PAYMONGO_API}/links`, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    amount: amountCentavos,
                    description,
                    currency: 'PHP',
                    redirect: {
                        success: successUrl,
                        failed: failedUrl,
                    },
                    payment_method_types: ['gcash', 'paymaya', 'card', 'dob', 'brankas_bdo', 'brankas_metrobank'],
                    metadata: {
                        booking_id: booking.id,
                        renter_id: booking.renter_id,
                        vehicle_id: booking.vehicle_id,
                    },
                },
            },
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        const errMsg = data?.errors?.[0]?.detail || 'Failed to create payment link';
        throw new Error(errMsg);
    }

    return {
        url: data?.data?.attributes?.checkout_url,
        linkId: data?.data?.id,
    };
}

/**
 * Verify a payment intent status (for post-redirect verification)
 * @param {string} paymentIntentId
 * @returns {string} - payment status: 'paid' | 'awaiting_payment_method' | 'processing'
 */
export async function getPaymentStatus(paymentIntentId) {
    const authHeader = getAuthHeader();
    if (!authHeader) return 'unknown';

    try {
        const response = await fetch(`${PAYMONGO_API}/payment_intents/${paymentIntentId}`, {
            headers: { 'Authorization': authHeader },
        });
        const data = await response.json();
        return data?.data?.attributes?.status || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Format Philippine Peso amount for display
 * @param {number} amount
 * @returns {string} e.g. "₱1,500.00"
 */
export function formatPHP(amount) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
    }).format(amount || 0);
}

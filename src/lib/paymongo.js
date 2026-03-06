/**
 * PayMongo Payment Service — SafeDrive Subscription
 * ==================================================
 * SafeDrive's business model: Subscription-based (₱399/month)
 *
 * HOW YOUR MONEY FLOW WORKS:
 * 1. User clicks Subscribe on SafeDrive website
 * 2. PayMongo creates a GCash/InstaPay checkout link for ₱399
 * 3. User is redirected to GCash — taps "Pay" — money deducted instantly
 * 4. PayMongo notifies SafeDrive of success → subscriptionexpiry set to +30 days
 * 5. PayMongo sweeps collected funds to YOUR linked GCash/bank account
 *
 * TO LINK YOUR PERSONAL GCASH TO RECEIVE PAYMENTS:
 * 1. Sign up at https://dashboard.paymongo.com/signup
 * 2. Go to Dashboard → Settings → Payouts → Add GCash number
 * 3. Verify your GCash number (they'll send a code)
 * 4. All subscription payments will be auto-swept to your GCash (next business day)
 *
 * SUBSCRIPTION RULES:
 * - Free users: max 1 active vehicle listing at a time
 * - Subscribed users: unlimited active listings
 * - When subscription expires: all listings except the earliest-created are deactivated
 * - User can manually toggle listings on/off (must stay within their slot limit)
 *
 * COST TO USE PAYMONGO:
 * - No monthly fee, no setup fee
 * - GCash transactions: 2.5% per successful payment
 * - So per ₱399 subscription: PayMongo takes ₱9.98, you receive ₱389.02
 *
 * ENV SETUP (add to .env and Vercel environment variables):
 *   VITE_PAYMONGO_SECRET_KEY=sk_test_xxxxxxxxxxxx  (or sk_live_xxx for production)
 */

const PAYMONGO_API = 'https://api.paymongo.com/v1';
const SECRET_KEY = import.meta.env.VITE_PAYMONGO_SECRET_KEY;

const getAuthHeader = () => {
    if (!SECRET_KEY) {
        console.warn('⚠️ PayMongo secret key not set. Add VITE_PAYMONGO_SECRET_KEY to .env');
        return null;
    }
    return `Basic ${btoa(SECRET_KEY + ':')}`;
};

export const SUBSCRIPTION_PRICE = 399; // ₱399/month
export const FREE_LISTING_LIMIT = 1;   // max active listings for free users

/**
 * Create a GCash subscription payment link for ₱399.
 * Redirects user to GCash/InstaPay hosted checkout.
 *
 * @param {string} userId - The Supabase user ID (stored in payment metadata)
 * @param {string} userEmail - User email for PayMongo receipt
 * @returns {{ url: string, linkId: string }}
 */
export async function createSubscriptionPaymentLink(userId, userEmail) {
    const authHeader = getAuthHeader();
    if (!authHeader) {
        throw new Error('Payment gateway not configured. Please contact support or try again later.');
    }

    const amountCentavos = SUBSCRIPTION_PRICE * 100; // ₱399 → 39900 centavos

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
                    description: 'SafeDrive Premium — 1 Month Unlimited Listings. After payment, return to the SafeDrive tab to activate your subscription.',
                    currency: 'PHP',
                    remarks: 'SafeDrive Premium Subscription 1 Month',
                    metadata: {
                        user_id: userId,
                        user_email: userEmail,
                        plan: 'monthly',
                        amount_php: SUBSCRIPTION_PRICE,
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
        referenceNumber: data?.data?.attributes?.reference_number,
    };
}


/**
 * Check if a user's subscription is currently active
 * @param {object} profile - User profile from DB
 * @returns {boolean}
 */
export function isSubscriptionActive(profile) {
    if (!profile?.subscription_end_date) return false;
    return new Date(profile.subscription_end_date) > new Date();
}

/**
 * Get the number of days remaining in the subscription
 * @param {object} profile - User profile from DB
 * @returns {number} days remaining (0 if expired)
 */
export function getSubscriptionDaysLeft(profile) {
    if (!isSubscriptionActive(profile)) return 0;
    const end = new Date(profile.subscription_end_date);
    const now = new Date();
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

/**
 * Format Philippine Peso amount for display
 * @param {number} amount
 * @returns {string} e.g. "₱399.00"
 */
export function formatPHP(amount) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount || 0);
}

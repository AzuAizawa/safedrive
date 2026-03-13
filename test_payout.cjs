
const { createClient } = require('@supabase/supabase-js');

// Config
const SUPABASE_URL = 'https://hfduyehriemnfgkecmtj.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZHV5ZWhyaWVtbmZna2VjbXRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMxMjAzOSwiZXhwIjoyMDg2ODg4MDM5fQ.hzngzUC251P8QWcwxtYz1k0q-Us919462DRik_Wj4IM';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testPayout() {
    console.log('--- Xendit Payout Test Script ---');

    // 1. Pick the recent booking
    const bookingId = 'b2d89375-83e9-4fae-8c31-042e5cd833b1';
    console.log(`Setting up booking ${bookingId} for payout test...`);

    // 2. Mock it as paid and completed
    const { error: updateError } = await supabase
        .from('bookings')
        .update({
            payment_status: 'paid',
            status: 'completed',
            payout_status: 'pending',
            total_amount: 5000,
            owner_payout_amount: 4500,
            commission_amount: 500
        })
        .eq('id', bookingId);

    if (updateError) {
        console.error('Error updating booking:', updateError);
        return;
    }
    console.log('✅ Booking updated to PAID + COMPLETED');

    // 3. Trigger the Edge Function
    console.log('Triggering xendit-process-payout Edge Function...');
    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/xendit-process-payout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        console.log('--- Edge Function Output ---');
        console.log(JSON.stringify(result, null, 2));

        if (result.processed > 0) {
            console.log('🚀 SUCCESS: Payout link should be created in Xendit!');
        } else {
            console.log('❌ FAILED: No payout processed. Check errors in output above.');
        }
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testPayout();

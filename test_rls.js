import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function checkPolicies() {
    // Let's just try to update a test user using the standard anon key to see if RLS blocks it
    const supabaseClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

    // First need to sign in a test user to get a session
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
        email: 'admin@safedrive.com', // Assuming this admin exists based on the seed
        password: 'password123'
    });

    if (authError) {
        console.error("Auth Error:", authError);
        return;
    }

    console.log("Logged in as:", authData.user.id);

    // Try to update exactly like SubscriptionSuccess.jsx does
    const { data, error } = await supabaseClient.from('profiles')
        .update({
            subscription_status: 'active',
            subscription_end_date: new Date().toISOString(),
        })
        .eq('id', authData.user.id)
        .select();

    if (error) {
        console.error("Update Blocked! Error:", error);
    } else {
        console.log("Update Succeeded:", data);
    }
}

checkPolicies().catch(console.error);

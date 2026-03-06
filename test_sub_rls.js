import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkProfiles() {
    console.log("Using key:", supabaseKey ? "ADMIN_SERVICE_ROLE" : "MISSING");
    
    // 1. Get ALL profiles
    const { data: profiles, error: getErr } = await supabase.from('profiles').select('*');
    if (getErr) {
        console.error("Failed to read profiles:", getErr);
        return;
    }
    console.table(profiles);

    // 2. See if there's any active subscription
    const activeSubs = profiles.filter(p => p.subscription_status === 'active');
    console.log("Active Subscriptions:", activeSubs);
}

checkProfiles();

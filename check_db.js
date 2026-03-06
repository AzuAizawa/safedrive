import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
    console.log("Using key:", process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON');
    const { data: users, error: error1 } = await supabaseAdmin.from('profiles').select('id, full_name, email, role, subscription_status, subscription_end_date');
    if (error1) {
        console.error("Profiles error:", error1);
    } else {
        console.log("Profiles:");
        console.table(users);
    }
}

check();

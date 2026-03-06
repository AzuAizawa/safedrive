import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Use anon key, simulating insert
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

async function checkStorage() {
    console.log("Checking storage connection...");
    try {
        const { data, error } = await supabase.storage.getBucket('vehicle-images');
        if (error) {
            console.error("Storage Error:", error.message);
        } else {
            console.log("Bucket access OK:", data.name);
        }
        
        console.log("Checking agreement bucket...");
        const { data: agData, error: agErr } = await supabase.storage.getBucket('vehicle-agreements');
        if (agErr) {
            console.error("Agreement storage Error:", agErr.message);
        } else {
             console.log("Agreement Bucket access OK:", agData.name);
        }
        
    } catch (e) {
        console.error("Crash:", e);
    }
}

checkStorage();

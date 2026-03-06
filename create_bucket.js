import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// We need the service key to run raw administrative queries, assuming the user gave it in env
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createBucket() {
    console.log("Creating vehicle-agreements bucket...");
    try {
        const { data, error } = await supabase.storage.createBucket('vehicle-agreements', {
            public: true,
            allowedMimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            fileSizeLimit: 10485760 // 10MB
        });
        
        if (error) {
            console.error("Failed to create bucket:", error.message);
        } else {
            console.log("Success! Bucket created:", data);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}

createBucket();

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function simulateUpload() {
    console.log("Simulating vehicle upload...");

    // 1. Authenticate as a test user or grab the first available user
    const { data: { users }, error: authErr } = await supabase.auth.admin?.listUsers() || { data: { users: [] } };
    
    // We will just try a raw insert and see if it hangs or throws
    // We don't have a valid owner_id right now if using anon, so it should fail gracefully, NOT hang.
    console.log("Attempting insert...");
    
    try {
        const { data, error } = await supabase.from('vehicles').insert({
            owner_id: '3ac0ea42-b3ec-4aa7-b3b9-10d513cb06bb', // Reusing the UUID from the user's screenshot URL earlier
            make: "Toyota",
            model: "Vios",
            year: 2022,
            color: "White",
            plate_number: "ABC1234",
            body_type: "Sedan",
            transmission: "Automatic",
            fuel_type: "Gasoline",
            seating_capacity: 5,
            pricing_type: "fixed",
            daily_rate: 1000,
            available_durations: [],
            security_deposit: 0,
            fixed_price: 3000,
            fixed_rental_days: 3,
            contact_info: "09123456789",
            pickup_location: "Test Location",
            pickup_city: "Test City",
            pickup_province: "Test Province",
            description: "A test vehicle",
            features: [],
            images: [],
            status: 'pending'
        }).select();

        console.log("Insert result:", error ? "ERROR" : "SUCCESS", error || data);
    } catch (e) {
        console.error("FATAL CRASH during insert:", e);
    }
}

simulateUpload();

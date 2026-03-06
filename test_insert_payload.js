import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Use service key to bypass RLS completely and see if schema rejects the payload
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testInsert() {
    console.log("Simulating vehicle upload bypassing RLS...");

    try {
        const payload = {
            owner_id: '3ac0ea42-b3ec-4aa7-b3b9-10d513cb06bb',
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
            images: ['http://example.com/image1.jpg'],
            thumbnail_url: 'http://example.com/image1.jpg',
            status: 'pending'
        };

        const { data, error } = await supabase.from('vehicles').insert(payload).select();

        if (error) {
            console.error("DB REJECTED PAYLOAD:", error);
        } else {
            console.log("DB ACCEPTED PAYLOAD:", data ? data[0].id : data);
            
            // Clean up the dummy row to avoid polluting the DB
            await supabase.from('vehicles').delete().eq('id', data[0].id);
        }
    } catch (e) {
        console.error("FATAL EXCEPTION in js client:", e);
    }
}

testInsert();

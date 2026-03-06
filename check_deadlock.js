import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function checkDeadlock() {
    console.log("Testing a simple vehicle insert using Auth client...");
    const timeout = setTimeout(() => {
        console.error("The insert query hung for more than 5 seconds! There might be a database lock.");
        process.exit(1);
    }, 5000);

    const email = `test_owner_${Date.now()}@example.com`;
    const password = 'password123';

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: 'Test Owner', role: 'verified' } }
    });

    if (signUpError) {
        console.log("SignUp Error", signUpError);
        return;
    }

    try {
        const { data, error } = await supabase.from('vehicles').insert({
            owner_id: signUpData.user.id,
            make: 'Test',
            model: 'Test',
            year: 2025,
            status: 'pending',
            plate_number: 'TEST',
            color: 'Red',
            body_type: 'Sedan',
            transmission: 'Automatic',
            fuel_type: 'Gasoline',
            seating_capacity: 5,
            pricing_type: 'flexible',
            daily_rate: 1000,
            pickup_location: 'Test',
            pickup_city: 'Test',
            pickup_province: 'Test',
            contact_info: 'Test',
        }).select();

        clearTimeout(timeout);
        console.log("Response received!");
        console.log("Result:", data, error);
    } catch (err) {
        clearTimeout(timeout);
        console.error("Exception thrown:", err);
    }
}

checkDeadlock();

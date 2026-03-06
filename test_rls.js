import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function applyFixes() {
    const sql = `
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
  CREATE POLICY "Users can insert their own vehicles"
    ON vehicles
    FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

  DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
  CREATE POLICY "Users can update their own vehicles"
    ON vehicles
    FOR UPDATE
    USING (auth.uid() = owner_id);
END $$;
    `;
    console.log("If service key is not available, RLS SQL scripts must be run manually via Supabase Dashboard");
}
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: 'Test Owner' }
        }
    });

    if (signUpError) {
        console.error("Sign up error:", signUpError);
        return;
    }

    const userId = signUpData.user.id;
    console.log("Logged in user ID:", userId);

    await new Promise(r => setTimeout(r, 1000));

    console.log("Attempting to insert a vehicle...");
    const { data: insertData, error: insertError } = await supabase.from('vehicles')
        .insert({
            owner_id: userId,
            make: 'Toyota',
            model: 'Vios',
            year: 2020,
            status: 'pending',
            pricing_type: 'flexible',
            daily_rate: 1500,
        })
        .select();

    if (insertError) {
        console.error("❌ Insert threw an error:", insertError.message);
    } else if (!insertData || insertData.length === 0) {
        console.log("❌ Insert did not throw an error, but 0 rows were updated. THIS MEANS RLS BLOCKED IT!");
    } else {
        console.log("✅ Insert succeeded! Affected rows:", insertData.length);
        console.log(insertData[0]);
    }
}

testRLS().catch(console.error);

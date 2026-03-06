import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// We'll use ANON key and just query recent vehicles since policies usually allow select
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkVehicles() {
    const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, make, model, thumbnail_url, images')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error fetching vehicles:", error);
    } else {
        vehicles.forEach(v => {
            console.log(`Vehicle ${v.make} ${v.model} (ID: ${v.id})`);
            console.log(`- Thumbnail: ${v.thumbnail_url}`);
            console.log(`- Images type: ${typeof v.images}`);
            console.log(`- Images isArray: ${Array.isArray(v.images)}`);
            console.log(`- Images value:`, v.images);
            console.log('-------------------------');
        });
    }
}

checkVehicles();

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function testUploadHang() {
    console.log("Mocking a file upload to a non-existent bucket...");
    
    // Create a dummy Blob to simulate a File
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    
    // Use an explicitly missing bucket
    const bucketName = 'missing-bucket-123xyz';
    
    console.log(`Starting upload to ${bucketName}...`);
    let isPending = true;
    
    // Set a timeout to check if it's hanging
    setTimeout(() => {
        if (isPending) {
            console.log("HANG DETECTED: The promise did not resolve or reject within 5 seconds.");
            process.exit(1);
        }
    }, 5000);

    try {
        const { data, error } = await supabase.storage.from(bucketName).upload('test.txt', blob);
        isPending = false;
        console.log("Resolved instantly:", { data, error });
    } catch (e) {
        isPending = false;
        console.log("Caught exception instantly:", e.message);
    }
}

testUploadHang();

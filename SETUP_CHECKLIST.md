# ✅ SafeDrive Setup Checklist

To get the application running fully with the new security architecture, follow these steps:

## 1. Database Setup (Crucial)
You must execute the SQL schemas in your Supabase project dashboard.

1.  **Go to Supabase SQL Editor:** [https://supabase.com/dashboard/project/_/sql](https://supabase.com/dashboard/project/_/sql)
2.  **Run Main Schema:**
    *   Open `supabase-schema.sql` from your project folder.
    *   Copy all content.
    *   Paste into SQL Editor and click **Run**.
3.  **Run Security Schema:**
    *   Open `supabase-security-schema.sql` from your project folder.
    *   Copy all content.
    *   Paste into SQL Editor and click **Run**.

## 2. Storage Buckets
Create the following public buckets in Supabase Storage:
*   `avatars`
*   `vehicle-images`
*   `documents` (Private bucket recommended, but Public for MVP)
*   `selfies`
*   `agreements`

## 3. Environment Variables
Ensure your `.env` file has the correct values:
```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## 4. Verify Application
1.  Restart the dev server: `npm run dev`
2.  Open `http://localhost:5173`
3.  Try to **Register** a new account (this tests Auth + Security logging).
4.  Check your Supabase `security_audit_logs` table to see the event logged.

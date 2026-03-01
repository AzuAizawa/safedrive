import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
}

// Determine if we are currently in the admin portal by checking the URL
const isAdminRoute = typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));

const storageKey = isAdminRoute ? 'safedrive-admin-auth' : 'safedrive-auth';

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    storageKey: storageKey,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

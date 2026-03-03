import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

// ── Standard User Client ────────────────────────────────────────────────────
// Uses sessionStorage so session dies when the tab closes (no auto-login on reopen)
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    storageKey: 'safedrive-auth',
    autoRefreshToken: true,
    detectSessionInUrl: false, // Prevent URL token leaking into the wrong client
    storage: window.sessionStorage,
  },
});

// ── Admin Client ────────────────────────────────────────────────────────────
// Completely isolated storage key — admin tokens NEVER mix with user tokens
export const supabaseAdmin = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    storageKey: 'safedrive-admin-auth',
    autoRefreshToken: true,
    detectSessionInUrl: false, // Admin never comes from OAuth callback URLs
    storage: window.sessionStorage,
  },
});

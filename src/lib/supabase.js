import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
}

// Custom storage adapter guarantees the right token is pulled even if the 
// JS bundle executes before React Router fully hydrates the pathname on Vercel
const dynamicStorage = {
  getItem: (key) => {
    const isAdmin = typeof window !== 'undefined' && (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));
    const actualKey = isAdmin ? key.replace('safedrive-auth', 'safedrive-admin-auth') : key;
    return window.sessionStorage.getItem(actualKey);
  },
  setItem: (key, value) => {
    const isAdmin = typeof window !== 'undefined' && (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));
    const actualKey = isAdmin ? key.replace('safedrive-auth', 'safedrive-admin-auth') : key;
    window.sessionStorage.setItem(actualKey, value);
  },
  removeItem: (key) => {
    const isAdmin = typeof window !== 'undefined' && (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/admin-login'));
    const actualKey = isAdmin ? key.replace('safedrive-auth', 'safedrive-admin-auth') : key;
    window.sessionStorage.removeItem(actualKey);
  }
};

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    storageKey: 'safedrive-auth', // Base key to be mutated by dynamicStorage
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: dynamicStorage,
  },
});

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The one Supabase client in the app, or null when no project is configured.
 *
 * Null is the normal case, not an error: the app is offline-first and fully usable with no account
 * (that is a product decision, see docs/STORAGE_DB_MIGRATION_PLAN.md §0). Every caller therefore has
 * to handle null, which also means a developer without credentials gets the app, not a crash.
 *
 * The anon key is public by design - it identifies the project, it does not grant access. What grants
 * access is row-level security (supabase/schema.sql). The service_role key must never appear in this
 * file, or anywhere else the browser can see.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export function isSupabaseConfigured(): boolean {
  return !!url && !!anonKey;
}

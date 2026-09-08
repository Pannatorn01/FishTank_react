import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The one Supabase client in the app, or null when no project is configured.
 *
 * Null is the normal case, not an error: the app is offline-first and fully usable with no account
 * (that is a product decision, see docs/STORAGE_DB_MIGRATION_PLAN.md §0). Every caller therefore has
 * to handle null, which also means a developer without credentials gets the app, not a crash.
 *
 * The key is public by design - it identifies the project, it does not grant access. What grants
 * access is row-level security (supabase/schema.sql). The secret key (service_role, in the old naming)
 * must never appear in this file, or anywhere else the browser can see.
 *
 * Two names are accepted because Supabase renamed this key: newer projects issue a publishable key
 * (sb_publishable_...) and the dashboard hands it over as VITE_SUPABASE_PUBLISHABLE_KEY, while older
 * ones have an anon JWT under VITE_SUPABASE_ANON_KEY. They play the same role, so either is fine and
 * a project set up before the rename does not have to be re-keyed.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

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

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Creates an administrative Supabase client using the Service Role key
 * (to allow server-side ingestion on behalf of any userId when RLS is enabled),
 * falling back to the anonymous key if service role key is not configured.
 */
export function getAdminSupabaseClient() {
  const key = supabaseServiceRoleKey || supabaseAnonKey;
  if (!supabaseUrl || !key) {
    throw new Error(
      'Missing Supabase credentials: ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are set in environment variables.'
    );
  }

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

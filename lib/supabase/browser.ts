import { createClient } from "@supabase/supabase-js";

// Browser client: anon key only. RLS allows read-only access to public tables.
export function createBrowserSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

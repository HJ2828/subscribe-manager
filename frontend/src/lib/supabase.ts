import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicConfig } from "./config";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!publicConfig.isSupabaseConfigured) {
    return null;
  }

  if (!client) {
    client = createClient(
      publicConfig.supabaseUrl as string,
      publicConfig.supabasePublishableKey as string,
    );
  }

  return client;
}

export type PublicConfig = {
  apiBaseUrl: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  isSupabaseConfigured: boolean;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const publicConfig: PublicConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000",
  supabaseUrl,
  supabasePublishableKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabasePublishableKey),
};

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://efblhmyjulforrhjpanp.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Se exportan para que otras partes puedan hablarle a Supabase sin rearmar la URL a mano:
// el login en dos pasos llama a una Edge Function antes de que exista sesion.
export const SUPABASE_URL = url;
export const SUPABASE_ANON = anon;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

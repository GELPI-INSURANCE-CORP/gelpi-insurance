import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function initials(user: User | null | undefined): string {
  if (!user) return "?";
  const name = (user.user_metadata?.full_name as string | undefined) || user.email || "";
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function displayName(user: User | null | undefined): string {
  if (!user) return "";
  return (user.user_metadata?.full_name as string | undefined) || user.email || "";
}

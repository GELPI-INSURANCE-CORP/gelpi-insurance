import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Reglas de contraseña del proyecto Supabase (Authentication -> Policies):
// mínimo 12 caracteres, con minúscula, mayúscula y número. Las validamos acá
// también para dar un mensaje claro antes de ir al servidor.
export const REGLAS_CLAVE = [
  { texto: "Al menos 12 caracteres", ok: (v: string) => v.length >= 12 },
  { texto: "Una minúscula", ok: (v: string) => /[a-z]/.test(v) },
  { texto: "Una mayúscula", ok: (v: string) => /[A-Z]/.test(v) },
  { texto: "Un número", ok: (v: string) => /[0-9]/.test(v) },
];

export function clavesInvalidas(clave: string): string[] {
  return REGLAS_CLAVE.filter((r) => !r.ok(clave)).map((r) => r.texto);
}

// Cambia la contraseña del usuario con sesión abierta. Pedimos la actual y la
// verificamos con un signIn: Supabase no la exige, pero sin eso cualquiera que
// agarre la sesión abierta en una máquina prestada podría cambiarla.
export async function changePassword(claveActual: string, claveNueva: string) {
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error("No hay una sesión activa.");

  const { error: credError } = await supabase.auth.signInWithPassword({
    email,
    password: claveActual,
  });
  if (credError) throw new Error("La contraseña actual no es correcta.");

  const { error } = await supabase.auth.updateUser({ password: claveNueva });
  if (error) throw error;
}

// Envía el correo de recuperación. El enlace vuelve a /restablecer/, que es
// donde el usuario elige la contraseña nueva.
export async function requestPasswordReset(email: string) {
  const base = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${base}/restablecer/`,
  });
  if (error) throw error;
}

// Fija la contraseña nueva cuando ya hay sesión de recuperación (enlace del correo).
export async function setNewPassword(claveNueva: string) {
  const { error } = await supabase.auth.updateUser({ password: claveNueva });
  if (error) throw error;
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

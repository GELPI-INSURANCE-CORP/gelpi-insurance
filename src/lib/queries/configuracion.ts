import { supabase } from "@/lib/supabase";

export interface AliasAgencia {
  id: string;
  texto: string;
  aseguradora_id: string | null;
  activo: boolean;
  created_at: string;
}

export async function listAlias() {
  const { data, error } = await supabase.from("alias_agencia").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AliasAgencia[];
}

export async function agregarAlias(texto: string, aseguradoraId: string | null) {
  const { error } = await supabase.from("alias_agencia").insert({ texto, aseguradora_id: aseguradoraId });
  if (error) throw error;
}

export async function toggleAlias(id: string, activo: boolean) {
  const { error } = await supabase.from("alias_agencia").update({ activo }).eq("id", id);
  if (error) throw error;
}

export async function borrarAlias(id: string) {
  const { error } = await supabase.from("alias_agencia").delete().eq("id", id);
  if (error) throw error;
}

export interface ConfigValores {
  umbral_auto: number;
  umbral_mismatch: number;
  dias_atrasada: number;
  ventana_dias_vigencia: number;
  acceso_agentes_individuales: boolean;
}

export async function getConfiguracion(): Promise<ConfigValores> {
  const { data, error } = await supabase.from("configuracion").select("clave, valor");
  if (error) throw error;
  const map = new Map((data ?? []).map((r) => [r.clave, r.valor]));
  return {
    umbral_auto: Number(map.get("umbral_auto") ?? 90),
    umbral_mismatch: Number(map.get("umbral_mismatch") ?? 60),
    dias_atrasada: Number(map.get("dias_atrasada") ?? 10),
    ventana_dias_vigencia: Number(map.get("ventana_dias_vigencia") ?? 5),
    acceso_agentes_individuales: Boolean(map.get("acceso_agentes_individuales") ?? false),
  };
}

export async function setConfiguracion(clave: string, valor: number | boolean) {
  const { error } = await supabase
    .from("configuracion")
    .update({ valor, updated_at: new Date().toISOString() })
    .eq("clave", clave);
  if (error) throw error;
}

export interface AseguradoraRow {
  id: string;
  nombre: string;
  codigo: string | null;
  formato_esperado: string | null;
  plantilla_mapeo: Record<string, unknown> | null;
  nivel_atribucion: string | null;
  activa: boolean;
  created_at: string;
}

export async function listAseguradoras() {
  const { data, error } = await supabase.from("aseguradoras").select("*").order("nombre");
  if (error) throw error;
  return (data ?? []) as AseguradoraRow[];
}

export async function actualizarPlantillaMapeo(id: string, plantilla: Record<string, unknown> | null) {
  const { error } = await supabase.from("aseguradoras").update({ plantilla_mapeo: plantilla }).eq("id", id);
  if (error) throw error;
}

export async function crearAseguradora(nombre: string, codigo: string) {
  const { error } = await supabase.from("aseguradoras").insert({ nombre, codigo });
  if (error) throw error;
}

export async function listOficinasConGerente() {
  const { data, error } = await supabase
    .from("oficinas")
    .select("id, nombre, codigo, pct_override, gerente:agentes!oficinas_gerente_fk(nombre)")
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function actualizarPctOverride(id: string, pct: number) {
  const { error } = await supabase.from("oficinas").update({ pct_override: pct }).eq("id", id);
  if (error) throw error;
}

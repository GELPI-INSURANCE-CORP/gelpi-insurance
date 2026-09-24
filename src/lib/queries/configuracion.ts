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
  const { error } = await supabase.from("aseguradoras").insert({ nombre, codigo: codigo || null });
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

/* ========================= Ficha del administrador ========================= */

export interface AgenteCasa {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  codigo: string | null;
}

export interface OficinaCasa {
  id: string;
  nombre: string;
  direccion: string | null;
}

export async function getAgenteCasa(): Promise<AgenteCasa | null> {
  const { data, error } = await supabase
    .from("agentes")
    .select("id, nombre, email, telefono, codigo")
    .eq("es_casa", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function crearAgenteCasa(nombre: string): Promise<AgenteCasa> {
  const { data, error } = await supabase
    .from("agentes")
    .insert({ nombre, es_casa: true, activo: true })
    .select("id, nombre, email, telefono, codigo")
    .single();
  if (error) throw error;
  return data;
}

export async function actualizarAgenteCasa(id: string, cambios: Partial<Omit<AgenteCasa, "id">>) {
  const { error } = await supabase.from("agentes").update(cambios).eq("id", id);
  if (error) throw error;
}

export async function getOficinaCasa(): Promise<OficinaCasa | null> {
  const { data, error } = await supabase
    .from("oficinas")
    .select("id, nombre, direccion")
    .eq("codigo", "CASA")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function actualizarOficinaCasa(id: string, cambios: Partial<Omit<OficinaCasa, "id">>) {
  const { error } = await supabase.from("oficinas").update(cambios).eq("id", id);
  if (error) throw error;
}

/* ========================= Conexión de IA ========================= */

export interface ConfigIA {
  apiKeyMasked: string | null;
  model: string;
}

export async function getConfigIA(): Promise<ConfigIA> {
  const { data, error } = await supabase.from("configuracion").select("clave, valor").in("clave", ["openai_api_key", "openai_model"]);
  if (error) throw error;
  const map = new Map((data ?? []).map((r) => [r.clave, r.valor]));
  const key = map.get("openai_api_key");
  const keyStr = typeof key === "string" ? key : null;
  return {
    apiKeyMasked: keyStr && keyStr.length >= 4 ? `sk-…${keyStr.slice(-4)}` : null,
    model: (map.get("openai_model") as string) ?? "gpt-4o-mini",
  };
}

async function upsertConfig(clave: string, valor: unknown) {
  const { error } = await supabase.from("configuracion").upsert({ clave, valor: valor as never, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function guardarConfigIA(apiKey: string | null, model: string) {
  if (apiKey) {
    await upsertConfig("openai_api_key", apiKey);
  }
  await upsertConfig("openai_model", model);
}

export interface TestIAResult {
  ok: boolean;
  model?: string;
  latency_ms?: number;
  error?: string;
}

export async function probarConexionIA(apiKey: string | null, model: string): Promise<TestIAResult> {
  const body: Record<string, unknown> = { test_ai: true, model };
  if (apiKey) body.api_key = apiKey;
  const { data, error } = await supabase.functions.invoke("extraer-reporte", { body });
  if (error) return { ok: false, error: error.message };
  return data as TestIAResult;
}

// ---------------------------------------------------------------------------
// Nombres alternativos de aseguradora y fusión de duplicadas
// ---------------------------------------------------------------------------
// Una misma compañía llega escrita distinto según la fuente: el Book de QQ dice "Response Ins Co",
// el statement dice "Responsive". Sin alias se crean dos aseguradoras, las pólizas quedan bajo una
// y el statement busca contra la otra — no concilia nada y no hay pista de por qué.

export interface AliasAseguradora {
  id: string;
  aseguradora_id: string;
  texto: string;
  created_at: string;
}

export async function listAliasAseguradora(): Promise<AliasAseguradora[]> {
  const { data, error } = await supabase.from("aseguradora_alias").select("*").order("texto");
  if (error) throw error;
  return (data ?? []) as AliasAseguradora[];
}

export async function crearAliasAseguradora(aseguradoraId: string, texto: string): Promise<void> {
  const { error } = await supabase.from("aseguradora_alias").insert({ aseguradora_id: aseguradoraId, texto: texto.trim() });
  if (error) {
    // El texto normalizado es unique en toda la tabla: un alias no puede apuntar a dos compañías,
    // porque entonces no habría forma de decidir a cuál va un archivo que lo use.
    if (error.code === "23505") throw new Error("Ese nombre ya está asignado a otra aseguradora.");
    throw error;
  }
}

export async function borrarAliasAseguradora(id: string): Promise<void> {
  const { error } = await supabase.from("aseguradora_alias").delete().eq("id", id);
  if (error) throw error;
}

export interface ResultadoFusion {
  ok: boolean;
  nombre_origen: string;
  polizas_movidas: number;
  polizas_fusionadas: number;
  reportes_movidos: number;
}

// Mueve todo lo que colgaba de `origenId` a `destinoId`, deja el nombre de la primera como alias
// de la segunda y borra la primera. Es irreversible: la pantalla tiene que confirmarlo.
export async function fusionarAseguradoras(origenId: string, destinoId: string): Promise<ResultadoFusion> {
  const { data, error } = await supabase.rpc("fusionar_aseguradoras", { p_origen: origenId, p_destino: destinoId });
  if (error) throw error;
  return data as ResultadoFusion;
}

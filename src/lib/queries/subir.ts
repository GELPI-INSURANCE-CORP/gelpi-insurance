import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// =========================================================
// Tipos
// =========================================================

export type TipoReporte =
  | "comision_aseguradora"
  | "venta_interna"
  | "bono_contingencia"
  | "actualizacion_abb"
  | "produccion"
  | "cancelaciones"
  | "renovaciones"
  | "chargebacks"
  | "resumen_anual"
  | "otro";

export type EstadoReporte =
  | "subido"
  | "extrayendo"
  | "extraido"
  | "matcheado"
  | "cerrado"
  | "error"
  | "bloqueado";

export interface Reporte {
  id: string;
  tipo: TipoReporte;
  aseguradora_id: string | null;
  nombre_archivo: string;
  storage_path: string;
  mime: string | null;
  hash_archivo: string;
  subido_por: string | null;
  periodo: string | null;
  estado: EstadoReporte;
  total_lineas: number;
  total_ok: number;
  total_excepciones: number;
  confianza_promedio: number | null;
  mapeo_columnas: Record<string, string> | null;
  columnas_detectadas: string[] | null;
  resumen_ia: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  aseguradora?: { nombre: string } | null;
}

export interface LineaComision {
  id: string;
  reporte_id: string;
  fila: number | null;
  numero_poliza_crudo: string | null;
  numero_normalizado: string | null;
  nombre_asegurado_crudo: string | null;
  productor_crudo: string | null;
  tipo_transaccion: string;
  ramo: string | null;
  prima: number | null;
  tasa: number | null;
  monto: number;
  fecha_vigencia: string | null;
  fecha_statement: string | null;
  campos_extra: Record<string, unknown> | null;
  confianza: number | null;
  estado: string;
  score: number | null;
  candidatos: unknown;
  poliza_id: string | null;
  agente_id: string | null;
  oficina_id: string | null;
  // columnas extra de v_lineas_comision
  aseguradora?: string | null;
  agente?: string | null;
  oficina?: string | null;
  poliza_abb?: string | null;
  cliente?: string | null;
}

export interface LineaVenta {
  id: string;
  reporte_id: string;
  fila: number | null;
  agente_nombre_crudo: string | null;
  agente_id: string | null;
  oficina_nombre_crudo: string | null;
  oficina_id: string | null;
  cliente_nombre_crudo: string | null;
  telefono: string | null;
  email: string | null;
  numero_poliza: string | null;
  numero_normalizado: string | null;
  aseguradora_nombre_crudo: string | null;
  aseguradora_id: string | null;
  ramo: string | null;
  fecha_venta: string | null;
  fecha_vigencia: string | null;
  prima: number | null;
  campos_extra: Record<string, unknown> | null;
  confianza: number | null;
  estado_en_abb: "pendiente" | "nuevo" | "coincide" | "conflicto";
  poliza_id: string | null;
}

export interface Aseguradora {
  id: string;
  nombre: string;
}

// =========================================================
// Hash de archivo
// =========================================================

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkHashExists(hash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reportes")
    .select("id")
    .eq("hash_archivo", hash)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// =========================================================
// Subida
// =========================================================

export class DuplicadoError extends Error {
  constructor() {
    super("Archivo idéntico ya subido (mismo hash).");
    this.name = "DuplicadoError";
  }
}

export interface UploadReporteParams {
  file: File;
  tipo: TipoReporte;
  aseguradoraId?: string | null;
  periodo?: string | null;
}

export async function uploadReporte({
  file,
  tipo,
  aseguradoraId = null,
  periodo = null,
}: UploadReporteParams): Promise<{ reporteId: string }> {
  const hash = await sha256Hex(file);

  const yaExiste = await checkHashExists(hash);
  if (yaExiste) {
    throw new DuplicadoError();
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const nombreLimpio = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `${tipo}/${yyyy}/${mm}/${hash}-${nombreLimpio}`;

  const { error: uploadError } = await supabase.storage.from("reportes").upload(storagePath, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error: insertError } = await supabase
    .from("reportes")
    .insert({
      tipo,
      aseguradora_id: aseguradoraId,
      nombre_archivo: file.name,
      storage_path: storagePath,
      mime: file.type || null,
      hash_archivo: hash,
      subido_por: user?.id ?? null,
      periodo,
      estado: "subido",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const reporteId = data.id as string;

  try {
    await supabase.functions.invoke("extraer-reporte", { body: { reporte_id: reporteId } });
  } catch {
    // No dejamos que un fallo de invocación tumbe la subida — el archivo queda
    // en estado 'subido' y su fila lo muestra como pendiente de extracción.
    await supabase
      .from("reportes")
      .update({ estado: "error", error: "No se pudo invocar la extracción automática." })
      .eq("id", reporteId);
  }

  return { reporteId };
}

export async function reintentarExtraccion(reporteId: string): Promise<void> {
  await supabase.from("reportes").update({ estado: "subido", error: null }).eq("id", reporteId);
  await supabase.functions.invoke("extraer-reporte", { body: { reporte_id: reporteId } });
}

// =========================================================
// Listados
// =========================================================

export interface FiltrosReportes {
  tipo?: string;
  aseguradoraId?: string;
  estado?: string;
}

export async function listReportes(filtros: FiltrosReportes = {}): Promise<Reporte[]> {
  let q = supabase
    .from("reportes")
    .select(
      "id, tipo, aseguradora_id, nombre_archivo, storage_path, mime, hash_archivo, subido_por, periodo, estado, total_lineas, total_ok, total_excepciones, confianza_promedio, mapeo_columnas, columnas_detectadas, resumen_ia, error, created_at, updated_at, aseguradora:aseguradoras(nombre)"
    )
    .order("created_at", { ascending: false });

  if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.estado) q = q.eq("estado", filtros.estado);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Reporte[];
}

export async function getReporteLineas(
  reporteId: string,
  tipo: TipoReporte
): Promise<{ comision: LineaComision[]; venta: LineaVenta[] }> {
  if (tipo === "venta_interna") {
    const { data, error } = await supabase
      .from("lineas_venta")
      .select("*")
      .eq("reporte_id", reporteId)
      .order("fila", { ascending: true });
    if (error) throw error;
    return { comision: [], venta: (data ?? []) as unknown as LineaVenta[] };
  }

  const { data, error } = await supabase
    .from("v_lineas_comision")
    .select("*")
    .eq("reporte_id", reporteId)
    .order("fila", { ascending: true });
  if (error) throw error;
  return { comision: (data ?? []) as unknown as LineaComision[], venta: [] };
}

export async function listAseguradoras(): Promise<Aseguradora[]> {
  const { data, error } = await supabase
    .from("aseguradoras")
    .select("id, nombre")
    .eq("activa", true)
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

// =========================================================
// Realtime
// =========================================================

export function subscribeReporteUpdates(
  reporteId: string,
  cb: (reporte: Reporte) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`reporte-${reporteId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "reportes", filter: `id=eq.${reporteId}` },
      (payload) => cb(payload.new as unknown as Reporte)
    )
    .subscribe();
  return channel;
}

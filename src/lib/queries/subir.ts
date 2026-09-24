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

export interface BonoRepartoRow {
  id: string;
  agente_id: string;
  agente: string | null;
  monto: number;
  motivo: string | null;
  pagado: boolean;
}

export interface BonoResumen {
  id: string;
  tipo: string;
  nombre: string | null;
  monto_total: number;
  estado: string;
  periodo: string | null;
  reparto: BonoRepartoRow[];
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

export interface ReporteExistente {
  id: string;
  estado: EstadoReporte;
  created_at: string;
  updated_at: string;
}

export async function buscarReportePorHash(hash: string): Promise<ReporteExistente | null> {
  const { data, error } = await supabase
    .from("reportes")
    .select("id, estado, created_at, updated_at")
    .eq("hash_archivo", hash)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Mismo criterio en toda la app para decidir si un reporte "atascado" (crash o límite de
// wall-clock de la función de extracción, que muere sin escribir 'error') puede reintentarse:
// o quedó en 'error' explícito, o lleva más de este tiempo en 'extrayendo' sin novedad.
const MINUTOS_ATASCADO = 5;
export function esReporteReintentable(r: Pick<ReporteExistente, "estado" | "updated_at" | "created_at">): boolean {
  if (r.estado === "error") return true;
  if (r.estado !== "extrayendo") return false;
  const desde = new Date(r.updated_at ?? r.created_at).getTime();
  if (Number.isNaN(desde)) return false;
  return Date.now() - desde > MINUTOS_ATASCADO * 60 * 1000;
}

// =========================================================
// Subida
// =========================================================

export class DuplicadoError extends Error {
  reporte: ReporteExistente | null;
  constructor(reporte: ReporteExistente | null = null) {
    super("Archivo idéntico ya subido (mismo hash).");
    this.name = "DuplicadoError";
    this.reporte = reporte;
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

  const existente = await buscarReportePorHash(hash);
  if (existente) {
    throw new DuplicadoError(existente);
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

export async function actualizarPeriodoReporte(id: string, periodo: string | null): Promise<void> {
  const { error } = await supabase
    .from("reportes")
    .update({ periodo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// A diferencia de reintentarExtraccion (pensado para un reporte que nunca llegó a insertar
// nada — estado 'error' o trabado en 'extrayendo'), esto es para un reporte que SÍ terminó
// de procesar pero con datos incompletos o incorrectos (ej. la IA extrajo solo una fracción
// de las filas reales). Reintentar sin más duplicaría las líneas ya insertadas — por eso acá
// primero se borran las líneas y excepciones de este reporte antes de re-extraer desde cero.
// Solo sirve para tipos que insertan en lineas_comision/lineas_venta; actualizacion_abb y
// bono_contingencia tocan otras tablas (polizas, bonos) y necesitarían su propia limpieza.
export async function reprocesarReporte(reporteId: string): Promise<void> {
  // Guarda contra dos reprocesos simultáneos. Pasó de verdad: cada corrida borra las líneas al
  // empezar y las inserta al terminar, así que si la segunda arranca mientras la primera sigue
  // extrayendo (tarda minutos), la segunda borra cuando todavía no hay nada y al final las dos
  // insertan — el statement queda cargado dos veces y la mitad se marca como duplicado.
  const { data: actual, error: errActual } = await supabase
    .from("reportes")
    .select("estado, updated_at")
    .eq("id", reporteId)
    .single();
  if (errActual) throw errActual;
  if (actual && (actual.estado === "extrayendo" || actual.estado === "subido")) {
    const desde = new Date(actual.updated_at).getTime();
    const minutos = (Date.now() - desde) / 60000;
    if (minutos < 10) {
      throw new Error(
        `Este reporte ya se está procesando (empezó hace ${Math.max(1, Math.round(minutos))} min). Esperá a que termine antes de reprocesarlo de nuevo.`
      );
    }
  }

  const [{ data: lineasComision }, { data: lineasVenta }] = await Promise.all([
    supabase.from("lineas_comision").select("id").eq("reporte_id", reporteId),
    supabase.from("lineas_venta").select("id").eq("reporte_id", reporteId),
  ]);
  const idsComision = (lineasComision ?? []).map((l) => l.id);
  const idsVenta = (lineasVenta ?? []).map((l) => l.id);
  if (idsComision.length > 0) {
    const { error } = await supabase.from("excepciones").delete().in("linea_comision_id", idsComision);
    if (error) throw error;
  }
  if (idsVenta.length > 0) {
    const { error } = await supabase.from("excepciones").delete().in("linea_venta_id", idsVenta);
    if (error) throw error;
  }
  await supabase.from("lineas_comision").delete().eq("reporte_id", reporteId);
  await supabase.from("lineas_venta").delete().eq("reporte_id", reporteId);
  const { error: updErr } = await supabase
    .from("reportes")
    .update({ estado: "subido", error: null, total_lineas: 0, total_ok: 0, total_excepciones: 0 })
    .eq("id", reporteId);
  if (updErr) throw updErr;
  const { error: fnErr } = await supabase.functions.invoke("extraer-reporte", { body: { reporte_id: reporteId } });
  if (fnErr) throw fnErr;
}

// =========================================================
// Listados
// =========================================================

export interface FiltrosReportes {
  tipo?: string;
  aseguradoraId?: string;
  estado?: string;
}

function construirQueryReportes(filtros: FiltrosReportes) {
  let q = supabase
    .from("reportes")
    .select(
      "id, tipo, aseguradora_id, nombre_archivo, storage_path, mime, hash_archivo, subido_por, periodo, estado, total_lineas, total_ok, total_excepciones, confianza_promedio, mapeo_columnas, columnas_detectadas, resumen_ia, error, created_at, updated_at, aseguradora:aseguradoras(nombre)"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.estado) q = q.eq("estado", filtros.estado);

  return q;
}

// PostgREST limita cada respuesta a max_rows (1000, ver supabase/config.toml). Con statements mensuales
// recurrentes la tabla `reportes` crece sin límite: recorremos todas las páginas para no ocultar en
// silencio los reportes más antiguos (hoy, con el volumen real, esto es una sola vuelta).
const PAGE_SIZE_REPORTES = 1000;

export async function listReportes(filtros: FiltrosReportes = {}): Promise<Reporte[]> {
  let rows: Reporte[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await construirQueryReportes(filtros).range(offset, offset + PAGE_SIZE_REPORTES - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Reporte[];
    rows = rows.concat(page);
    if (page.length < PAGE_SIZE_REPORTES) break;
    offset += PAGE_SIZE_REPORTES;
  }
  return rows;
}

export async function getReporteLineas(
  reporteId: string,
  tipo: TipoReporte
): Promise<{ comision: LineaComision[]; venta: LineaVenta[]; bono: BonoResumen | null }> {
  if (tipo === "venta_interna") {
    const { data, error } = await supabase
      .from("lineas_venta")
      .select("*")
      .eq("reporte_id", reporteId)
      .order("fila", { ascending: true });
    if (error) throw error;
    return { comision: [], venta: (data ?? []) as unknown as LineaVenta[], bono: null };
  }

  if (tipo === "bono_contingencia") {
    // procesarBono (Edge Function) no inserta en lineas_comision: el resultado real vive en bonos/bono_reparto,
    // enlazado por bonos.reporte_id (bono_reparto no tiene reporte_id propio).
    const { data: bonoRow, error: bErr } = await supabase
      .from("bonos")
      .select("id, tipo, nombre, monto_total, estado, periodo")
      .eq("reporte_id", reporteId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bonoRow) return { comision: [], venta: [], bono: null };
    const { data: repartoData, error: rErr } = await supabase
      .from("bono_reparto")
      .select("id, agente_id, monto, motivo, pagado, agentes(nombre)")
      .eq("bono_id", bonoRow.id);
    if (rErr) throw rErr;
    const reparto = ((repartoData ?? []) as unknown as Array<{
      id: string;
      agente_id: string;
      monto: number;
      motivo: string | null;
      pagado: boolean;
      agentes: { nombre: string } | null;
    }>).map((r) => ({
      id: r.id,
      agente_id: r.agente_id,
      agente: r.agentes?.nombre ?? null,
      monto: r.monto,
      motivo: r.motivo,
      pagado: r.pagado,
    }));
    return { comision: [], venta: [], bono: { ...(bonoRow as Omit<BonoResumen, "reparto">), reparto } };
  }

  // 'actualizacion_abb' tampoco inserta en lineas_comision (procesarAbb escribe directo en clientes/polizas),
  // y a diferencia de bono_contingencia no hay FK confiable reporte->pólizas (solo un archivo_path de texto en
  // abb_versiones, sin reporte_id): devolvemos vacío y el resumen agregado se muestra vía reportes.resumen_ia.
  if (tipo === "actualizacion_abb") {
    return { comision: [], venta: [], bono: null };
  }

  const { data, error } = await supabase
    .from("v_lineas_comision")
    .select("*")
    .eq("reporte_id", reporteId)
    .order("fila", { ascending: true });
  if (error) throw error;
  return { comision: (data ?? []) as unknown as LineaComision[], venta: [], bono: null };
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

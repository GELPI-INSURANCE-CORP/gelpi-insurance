import { supabase } from "@/lib/supabase";

// =========================================================
// Tipos
// =========================================================

export type TipoExcepcion = "mismatch" | "sin_identificar" | "duplicado" | "conflicto_venta";
export type EstadoExcepcion = "pendiente" | "resuelta" | "en_espera";

export interface CandidatoPoliza {
  poliza_id?: string;
  agente_id?: string | null;
  oficina_id?: string | null;
  score?: number;
  numero_poliza?: string;
  cliente?: string;
}

export interface CandidatosConflictoVenta {
  poliza_id?: string;
  agente_actual?: string | null;
  agente_reclamado?: string | null;
}

export interface ExcepcionRow {
  id: string;
  tipo: TipoExcepcion;
  linea_comision_id: string | null;
  linea_venta_id: string | null;
  linea_relacionada_id: string | null;
  candidatos: unknown;
  explicacion: string | null;
  estado: EstadoExcepcion;
  accion: string | null;
  nota: string | null;
  resuelta_por: string | null;
  resuelta_en: string | null;
  created_at: string;
  reporte_id: string | null;
  numero_poliza_crudo: string | null;
  nombre_asegurado_crudo: string | null;
  productor_crudo: string | null;
  monto: number | null;
  fecha_statement: string | null;
  score: number | null;
  regla_match: string | null;
  estado_linea: string | null;
  agente_sugerido_id: string | null;
  agente_sugerido: string | null;
  oficina_sugerida_id: string | null;
  oficina_sugerida: string | null;
  aseguradora: string | null;
  aseguradora_id: string | null;
  antiguedad_dias: number | null;
  atrasada: boolean | null;
  venta_cliente: string | null;
  venta_agente: string | null;
  venta_poliza: string | null;
  // no viene en la vista, pero lo unimos client-side cuando hace falta
  ramo?: string | null;
}

const EXCEPCION_COLUMNS = "*";

// =========================================================
// Helpers para leer candidatos (jsonb) sin `any`
// =========================================================

export function candidatosComoArray(candidatos: unknown): CandidatoPoliza[] {
  if (Array.isArray(candidatos)) return candidatos as CandidatoPoliza[];
  if (candidatos && typeof candidatos === "object") {
    // a veces viene un solo objeto (sin_identificar / mismatch de 1 candidato) en vez de array
    const obj = candidatos as Record<string, unknown>;
    if ("poliza_id" in obj) return [obj as CandidatoPoliza];
  }
  return [];
}

export function candidatosComoConflicto(candidatos: unknown): CandidatosConflictoVenta {
  if (candidatos && typeof candidatos === "object" && !Array.isArray(candidatos)) {
    return candidatos as CandidatosConflictoVenta;
  }
  return {};
}

// =========================================================
// Listado + filtros
// =========================================================

export interface FiltrosExcepciones {
  tipo?: TipoExcepcion;
  aseguradoraId?: string;
  oficinaId?: string;
  agenteId?: string;
  ramo?: string;
  desde?: string;
  hasta?: string;
  montoMin?: number;
  soloAtrasadas?: boolean;
  buscar?: string;
}

export async function listExcepciones(filtros: FiltrosExcepciones = {}): Promise<ExcepcionRow[]> {
  let q = supabase.from("v_excepciones").select(EXCEPCION_COLUMNS).eq("estado", "pendiente");

  if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.oficinaId) q = q.eq("oficina_sugerida_id", filtros.oficinaId);
  if (filtros.agenteId) q = q.eq("agente_sugerido_id", filtros.agenteId);
  if (filtros.desde) q = q.gte("fecha_statement", filtros.desde);
  if (filtros.hasta) q = q.lte("fecha_statement", filtros.hasta);
  if (typeof filtros.montoMin === "number" && filtros.montoMin > 0) q = q.gte("monto", filtros.montoMin);
  if (filtros.soloAtrasadas) q = q.eq("atrasada", true);
  if (filtros.buscar) {
    const term = filtros.buscar.replace(/[%,]/g, "");
    q = q.or(
      `numero_poliza_crudo.ilike.%${term}%,nombre_asegurado_crudo.ilike.%${term}%,productor_crudo.ilike.%${term}%`
    );
  }

  q = q.order("atrasada", { ascending: false }).order("antiguedad_dias", { ascending: false });

  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as ExcepcionRow[];

  if (filtros.ramo) {
    const ramoIds = new Set(await polizaIdsConRamo(filtros.ramo, rows));
    rows = rows.filter((r) => {
      const cand = candidatosComoArray(r.candidatos)[0];
      return cand?.poliza_id ? ramoIds.has(cand.poliza_id) : false;
    });
  }

  return rows;
}

// El ramo no vive en v_excepciones (vive en polizas/lineas_comision); resolvemos vía poliza candidata.
async function polizaIdsConRamo(ramo: string, rows: ExcepcionRow[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    const cand = candidatosComoArray(r.candidatos)[0];
    if (cand?.poliza_id) ids.add(cand.poliza_id);
  }
  if (ids.size === 0) return [];
  const { data, error } = await supabase.from("v_polizas").select("id, ramo").eq("ramo", ramo).in("id", Array.from(ids));
  if (error) throw error;
  return (data ?? []).map((p) => p.id as string);
}

export interface ConteosPorTipo {
  todas: number;
  mismatch: number;
  sin_identificar: number;
  duplicado: number;
  conflicto_venta: number;
}

export async function countsByTipo(): Promise<ConteosPorTipo> {
  const tipos: TipoExcepcion[] = ["mismatch", "sin_identificar", "duplicado", "conflicto_venta"];
  const results = await Promise.all(
    tipos.map((tipo) =>
      supabase.from("v_excepciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente").eq("tipo", tipo)
    )
  );
  results.forEach((r) => {
    if (r.error) throw r.error;
  });
  const [mismatch, sin_identificar, duplicado, conflicto_venta] = results.map((r) => r.count ?? 0);
  return {
    todas: mismatch + sin_identificar + duplicado + conflicto_venta,
    mismatch,
    sin_identificar,
    duplicado,
    conflicto_venta,
  };
}

export interface ResumenKpis {
  sin_identificar: { monto: number; n: number };
  mismatch: { monto: number; n: number };
  duplicado: { monto: number; n: number };
  total: { monto: number; n: number };
}

export async function resumenKpisExcepciones(): Promise<ResumenKpis> {
  const { data, error } = await supabase.from("v_excepciones").select("tipo, monto").eq("estado", "pendiente");
  if (error) throw error;
  const rows = data ?? [];
  const acc: ResumenKpis = {
    sin_identificar: { monto: 0, n: 0 },
    mismatch: { monto: 0, n: 0 },
    duplicado: { monto: 0, n: 0 },
    total: { monto: 0, n: 0 },
  };
  for (const r of rows) {
    const monto = Number(r.monto ?? 0);
    acc.total.monto += monto;
    acc.total.n += 1;
    if (r.tipo === "sin_identificar") {
      acc.sin_identificar.monto += monto;
      acc.sin_identificar.n += 1;
    } else if (r.tipo === "mismatch") {
      acc.mismatch.monto += monto;
      acc.mismatch.n += 1;
    } else if (r.tipo === "duplicado") {
      acc.duplicado.monto += monto;
      acc.duplicado.n += 1;
    }
  }
  return acc;
}

// =========================================================
// Catálogos para filtros / reasignación
// =========================================================

export interface AgenteSimple {
  id: string;
  nombre: string;
  oficina_id: string | null;
}
export interface OficinaSimple {
  id: string;
  nombre: string;
}
export interface AseguradoraSimple {
  id: string;
  nombre: string;
}

export async function listAgentes(): Promise<AgenteSimple[]> {
  const { data, error } = await supabase.from("agentes").select("id, nombre, oficina_id").eq("activo", true).order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function listOficinas(): Promise<OficinaSimple[]> {
  const { data, error } = await supabase.from("oficinas").select("id, nombre").eq("activa", true).order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function listAseguradoras(): Promise<AseguradoraSimple[]> {
  const { data, error } = await supabase.from("aseguradoras").select("id, nombre").eq("activa", true).order("nombre");
  if (error) throw error;
  return data ?? [];
}

// =========================================================
// Detalle de una excepción (para el panel lateral)
// =========================================================

export interface LineaComisionCruda {
  id: string;
  numero_poliza_crudo: string | null;
  nombre_asegurado_crudo: string | null;
  productor_crudo: string | null;
  prima: number | null;
  tasa: number | null;
  monto: number | null;
  fecha_vigencia: string | null;
  fecha_statement: string | null;
  tipo_transaccion: string | null;
  ramo: string | null;
  estado: string | null;
}

export interface PolizaCandidata {
  id: string;
  numero_poliza: string;
  cliente: string | null;
  telefono: string | null;
  email: string | null;
  aseguradora: string | null;
  agente: string | null;
  agente_id: string | null;
  oficina: string | null;
  oficina_id: string | null;
  ramo: string;
  fecha_vigencia: string | null;
  fecha_vencimiento: string | null;
  prima: number | null;
  estado: string;
}

export interface ExcepcionDetalle {
  excepcion: ExcepcionRow;
  lineaComision: LineaComisionCruda | null;
  candidatos: CandidatoPoliza[];
  polizaCandidata: PolizaCandidata | null;
  lineaRelacionada: LineaComisionCruda | null;
  agenteActualNombre: string | null;
  agenteReclamadoNombre: string | null;
}

export async function getExcepcionDetalle(id: string): Promise<ExcepcionDetalle> {
  const { data: excepcion, error } = await supabase.from("v_excepciones").select(EXCEPCION_COLUMNS).eq("id", id).single();
  if (error) throw error;
  const exc = excepcion as ExcepcionRow;

  let lineaComision: LineaComisionCruda | null = null;
  if (exc.linea_comision_id) {
    const { data, error: e2 } = await supabase
      .from("lineas_comision")
      .select(
        "id, numero_poliza_crudo, nombre_asegurado_crudo, productor_crudo, prima, tasa, monto, fecha_vigencia, fecha_statement, tipo_transaccion, ramo, estado"
      )
      .eq("id", exc.linea_comision_id)
      .maybeSingle();
    if (e2) throw e2;
    lineaComision = data;
  }

  const candidatos = exc.tipo === "conflicto_venta" ? [] : candidatosComoArray(exc.candidatos);

  let polizaCandidata: PolizaCandidata | null = null;
  const primerCandidatoPolizaId = candidatos[0]?.poliza_id;
  const polizaIdBuscar = primerCandidatoPolizaId ?? (exc.tipo === "conflicto_venta" ? candidatosComoConflicto(exc.candidatos).poliza_id : undefined);
  if (polizaIdBuscar) {
    const { data, error: e3 } = await supabase.from("v_polizas").select("*").eq("id", polizaIdBuscar).maybeSingle();
    if (e3) throw e3;
    polizaCandidata = data as PolizaCandidata | null;
  } else if (exc.agente_sugerido_id && exc.tipo === "sin_identificar") {
    // sin candidato explícito: no hay póliza que mostrar
    polizaCandidata = null;
  }

  let lineaRelacionada: LineaComisionCruda | null = null;
  if (exc.tipo === "duplicado" && exc.linea_relacionada_id) {
    const { data, error: e4 } = await supabase
      .from("lineas_comision")
      .select(
        "id, numero_poliza_crudo, nombre_asegurado_crudo, productor_crudo, prima, tasa, monto, fecha_vigencia, fecha_statement, tipo_transaccion, ramo, estado"
      )
      .eq("id", exc.linea_relacionada_id)
      .maybeSingle();
    if (e4) throw e4;
    lineaRelacionada = data;
  }

  let agenteActualNombre: string | null = null;
  let agenteReclamadoNombre: string | null = null;
  if (exc.tipo === "conflicto_venta") {
    const conf = candidatosComoConflicto(exc.candidatos);
    const ids = [conf.agente_actual, conf.agente_reclamado].filter(Boolean) as string[];
    if (ids.length > 0) {
      const { data, error: e5 } = await supabase.from("agentes").select("id, nombre").in("id", ids);
      if (e5) throw e5;
      const byId = new Map((data ?? []).map((a) => [a.id as string, a.nombre as string]));
      agenteActualNombre = conf.agente_actual ? byId.get(conf.agente_actual) ?? null : null;
      agenteReclamadoNombre = conf.agente_reclamado ? byId.get(conf.agente_reclamado) ?? null : null;
    }
  }

  return { excepcion: exc, lineaComision, candidatos, polizaCandidata, lineaRelacionada, agenteActualNombre, agenteReclamadoNombre };
}

// =========================================================
// Buscador de pólizas (para sin_identificar)
// =========================================================

export async function buscarPolizas(query: string): Promise<PolizaCandidata[]> {
  const term = query.trim().replace(/[%,]/g, "");
  if (!term) return [];
  const { data, error } = await supabase
    .from("v_polizas")
    .select("*")
    .or(`numero_poliza.ilike.%${term}%,cliente.ilike.%${term}%`)
    .limit(20);
  if (error) throw error;
  return (data ?? []) as PolizaCandidata[];
}

// =========================================================
// Resolver excepción (RPC)
// =========================================================

export type AccionResolucion =
  | "confirmar"
  | "reasignar"
  | "asignar"
  | "cuenta_casa"
  | "crear_poliza"
  | "pendiente"
  | "descartar_duplicado"
  | "mantener_ambas"
  | "reclasificar_ajuste"
  | "elegir_dueno";

export interface ClienteNuevo {
  nombre: string;
  telefono?: string;
  email?: string;
  numero_poliza: string;
  ramo: string;
}

export interface ResolverExcepcionParams {
  excepcionId: string;
  accion: AccionResolucion;
  agenteId?: string | null;
  oficinaId?: string | null;
  polizaId?: string | null;
  motivo?: string | null;
  cliente?: ClienteNuevo | null;
}

export async function resolverExcepcion(params: ResolverExcepcionParams): Promise<void> {
  const { error } = await supabase.rpc("resolver_excepcion", {
    p_excepcion_id: params.excepcionId,
    p_accion: params.accion,
    p_agente_id: params.agenteId ?? null,
    p_oficina_id: params.oficinaId ?? null,
    p_poliza_id: params.polizaId ?? null,
    p_motivo: params.motivo ?? null,
    p_cliente: params.cliente ?? null,
  });
  if (error) {
    // Postgres RAISE EXCEPTION llega en error.message; lo dejamos legible tal cual.
    throw new Error(error.message || "No se pudo resolver la excepción.");
  }
}

// =========================================================
// Exportar CSV (client-side, sin librerías)
// =========================================================

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportExcepcionesCsv(rows: ExcepcionRow[], filename = "cola-conciliacion.csv"): void {
  const headers = [
    "Tipo",
    "Aseguradora",
    "N° póliza",
    "Nombre en el reporte",
    "Productor del reporte",
    "Monto",
    "Oficina sugerida",
    "Agente sugerido",
    "Fecha statement",
    "Antigüedad (días)",
    "Atrasada",
    "Estado línea",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.tipo,
        r.aseguradora,
        r.numero_poliza_crudo,
        r.nombre_asegurado_crudo,
        r.productor_crudo,
        r.monto,
        r.oficina_sugerida,
        r.agente_sugerido,
        r.fecha_statement,
        r.antiguedad_dias,
        r.atrasada ? "Sí" : "No",
        r.estado_linea,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

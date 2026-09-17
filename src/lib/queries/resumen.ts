import { supabase } from "@/lib/supabase";

export interface ResumenMontoN {
  monto: number;
  n: number;
}

export interface ResumenPorOficina {
  oficina: string;
  oficina_id: string;
  comision: number;
  excepciones: number;
  antiguedad: number;
}

export interface ResumenPorAseguradora {
  aseguradora: string;
  comision: number;
}

export interface ResumenKpis {
  conciliado: number;
  sin_identificar: ResumenMontoN;
  mismatch: ResumenMontoN;
  duplicados: ResumenMontoN;
  conflictos: number;
  total_disputa: ResumenMontoN;
  por_oficina: ResumenPorOficina[];
  por_aseguradora: ResumenPorAseguradora[];
  agentes_con_comision: number;
}

export type TipoExcepcion = "mismatch" | "sin_identificar" | "duplicado" | "conflicto_venta";

export interface ExcepcionRow {
  id: string;
  tipo: TipoExcepcion;
  estado: string;
  numero_poliza_crudo: string | null;
  nombre_asegurado_crudo: string | null;
  productor_crudo: string | null;
  monto: number | null;
  fecha_statement: string | null;
  score: number | null;
  agente_sugerido: string | null;
  agente_sugerido_id: string | null;
  oficina_sugerida: string | null;
  oficina_sugerida_id: string | null;
  aseguradora: string | null;
  antiguedad_dias: number;
  atrasada: boolean;
  explicacion: string | null;
  created_at: string;
}

/** Rango [primer día, último día] del mes que contiene `d` (o el mes actual si se omite), en formato YYYY-MM-DD. */
export function rangoDelMes(d: Date = new Date()): { desde: string; hasta: string } {
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

export async function getResumenKpis(desde: string, hasta: string): Promise<ResumenKpis> {
  const { data, error } = await supabase.rpc("resumen_kpis", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return data as ResumenKpis;
}

export async function getExcepcionesTop(limit = 5): Promise<ExcepcionRow[]> {
  const { data, error } = await supabase
    .from("v_excepciones")
    .select(
      "id, tipo, estado, numero_poliza_crudo, nombre_asegurado_crudo, productor_crudo, monto, fecha_statement, score, agente_sugerido, agente_sugerido_id, oficina_sugerida, oficina_sugerida_id, aseguradora, antiguedad_dias, atrasada, explicacion, created_at"
    )
    .eq("estado", "pendiente")
    .order("atrasada", { ascending: false })
    .order("antiguedad_dias", { ascending: false })
    .order("monto", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ExcepcionRow[];
}

export async function getExcepcionesPendientesCount(): Promise<number> {
  const { count, error } = await supabase
    .from("v_excepciones")
    .select("id", { count: "exact", head: true })
    .eq("estado", "pendiente");
  if (error) throw error;
  return count ?? 0;
}

export interface BookResumen {
  primaPorOficina: Map<string, number>;
  premiumActivo: number;
  polizasActivas: number;
  premiumCancelado: number;
  polizasCanceladas: number;
}

// Datos del Active Business Book en sí (no de comisiones): cuánta prima hay vigente y
// vendida hoy, cuántas pólizas activas y cuántas canceladas, total y por oficina.
// v_polizas.prima/estado, sin importar en qué mes se cargó ni si ya se conciliaron
// sus comisiones.
export async function getBookResumen(): Promise<BookResumen> {
  const primaPorOficina = new Map<string, number>();
  let premiumActivo = 0;
  let polizasActivas = 0;
  let premiumCancelado = 0;
  let polizasCanceladas = 0;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("v_polizas")
      .select("oficina_id, prima, estado")
      .in("estado", ["activa", "cancelada"])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const p of page) {
      const prima = Number(p.prima ?? 0);
      if (p.estado === "activa") {
        premiumActivo += prima;
        polizasActivas += 1;
        if (p.oficina_id) primaPorOficina.set(p.oficina_id, (primaPorOficina.get(p.oficina_id) ?? 0) + prima);
      } else if (p.estado === "cancelada") {
        premiumCancelado += prima;
        polizasCanceladas += 1;
      }
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { primaPorOficina, premiumActivo, polizasActivas, premiumCancelado, polizasCanceladas };
}

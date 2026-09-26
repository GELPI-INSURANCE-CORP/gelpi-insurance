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

export interface ProduccionMes {
  mes: string;
  polizas: number;
  prima: number;
}

// Cuántas pólizas nuevas entraron cada mes. Se cuenta por fecha de vigencia — cuándo empezó a
// cubrir — y no por cuándo se cargó el archivo: una póliza de agosto es de agosto aunque el Book se
// haya subido en septiembre, y contarla por la carga haría que un mes sin subir figure sin ventas.
export async function getProduccionPorMes(desde: string, hasta: string): Promise<ProduccionMes[]> {
  const { data, error } = await supabase.rpc("polizas_por_mes", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return (data ?? []) as ProduccionMes[];
}

export interface AgenteRanking {
  agente_id: string;
  agente: string;
  oficina: string | null;
  lineas: number;
  comision: number;
}

// Quién produjo y cuánto, ordenado por plata y no por cantidad de líneas: un agente con 159 líneas
// chicas trajo menos que uno con 121 grandes, y lo que se reparte es plata. La cuenta de la casa
// queda afuera del ranking — ahí van los MVR y los ajustes, así que su total es negativo y el
// último puesto sería siempre el dueño en rojo.
export async function getRankingAgentes(
  desde: string,
  hasta: string,
  limite = 10
): Promise<AgenteRanking[]> {
  const { data, error } = await supabase.rpc("ranking_agentes", {
    p_desde: desde,
    p_hasta: hasta,
    p_limite: limite,
  });
  if (error) throw error;
  return (data ?? []) as AgenteRanking[];
}

export interface OficinaRanking {
  oficina_id: string | null;
  oficina: string;
  polizas: number;
  prima: number;
  comision: number;
}

// Reemplaza al ranking de agentes: por oficina (agentes.oficina_id) y por prima de negocio nuevo,
// no por comisión. Es lo que pidió Arturo: "si la póliza le costó 3.000 dólares, al 10% yo gano
// 300. Lo que nosotros estamos mirando son los 3.000 dólares del cliente, quién vendió esos
// 3.000" — y solo cuenta el new business, sin renovaciones. Las líneas sin clasificar (no se sabe
// si son nuevas) quedan afuera a propósito; getPrimaSinClasificar dice cuánta plata es esa.
export async function getRankingOficinas(
  desde: string,
  hasta: string,
  limite = 10
): Promise<OficinaRanking[]> {
  const { data, error } = await supabase.rpc("ranking_oficinas", {
    p_desde: desde,
    p_hasta: hasta,
    p_limite: limite,
  });
  if (error) throw error;
  return (data ?? []) as OficinaRanking[];
}

// Cuánta prima del período no se pudo clasificar como negocio nuevo ni como renovación (ver
// v_lineas_negocio). Esa plata no entra en getRankingOficinas, así que el dashboard la muestra
// aparte para que el número de arriba no parezca completo cuando no lo está.
export async function getPrimaSinClasificar(desde: string, hasta: string): Promise<number> {
  const { data, error } = await supabase.rpc("prima_sin_clasificar", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return Number(data ?? 0);
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
  // Cuántas de las activas traen prima cargada. Un total de prima sumado sobre 50 de 2.331
  // pólizas parece un dato y no lo es: hay que poder decir sobre cuántas está hecho.
  activasConPrima: number;
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
  let activasConPrima = 0;
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
        if (p.prima != null) activasConPrima += 1;
        if (p.oficina_id) primaPorOficina.set(p.oficina_id, (primaPorOficina.get(p.oficina_id) ?? 0) + prima);
      } else if (p.estado === "cancelada") {
        premiumCancelado += prima;
        polizasCanceladas += 1;
      }
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { primaPorOficina, premiumActivo, polizasActivas, premiumCancelado, polizasCanceladas, activasConPrima };
}

// =========================================================
// Datos para las gráficas del dashboard
// =========================================================

export interface PuntoSerie {
  mes: string;
  polizas: number;
  prima: number;
}

// Cómo venía el Book mes a mes, reconstruido desde las fechas de vigencia y vencimiento de cada
// póliza (ver 20260926000013). Es la serie real: las tarjetas del dashboard dibujan esto y no
// una curva de adorno.
//
// Ojo con el último punto: las pólizas sin fecha de vigencia no se pueden ubicar en el tiempo y
// quedan fuera de la serie, así que puede no coincidir exactamente con el total de hoy. La línea
// muestra la forma de la curva, no el total — ese lo da el número grande de la tarjeta.
export async function getSerieBook(meses = 12): Promise<PuntoSerie[]> {
  const { data, error } = await supabase.rpc("serie_mensual_book", { p_meses: meses });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    mes: String(d.mes),
    polizas: Number(d.polizas ?? 0),
    prima: Number(d.prima ?? 0),
  }));
}

export interface RamoPrima {
  ramo: string;
  polizas: number;
  prima: number;
}

export async function getPrimaPorRamo(): Promise<RamoPrima[]> {
  const { data, error } = await supabase.rpc("prima_por_ramo");
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    ramo: String(d.ramo ?? "—"),
    polizas: Number(d.polizas ?? 0),
    prima: Number(d.prima ?? 0),
  }));
}

// Cuánto cambió el último punto contra el anterior. Devuelve null cuando no hay con qué comparar
// o cuando el punto anterior es cero: un "subió infinito" no le dice nada a nadie.
export function variacion(serie: number[]): number | null {
  if (serie.length < 2) return null;
  const antes = serie[serie.length - 2];
  const ahora = serie[serie.length - 1];
  if (!antes) return null;
  return ((ahora - antes) / Math.abs(antes)) * 100;
}

// =========================================================
// Cargos por MVR — la pantalla donde se trabajan
// =========================================================
// El QuoteReport es material de consulta: se sube, se mira y no se toca. El MVR es lo otro —
// 389 cargos de los que unos 47 quedan sin dueño y hay que decidirlos uno por uno. Por eso
// tiene pantalla propia y no un panel.

import { supabase } from "@/lib/supabase";

export interface CargoMvr {
  id: string;
  fila: number | null;
  asegurado_crudo: string | null;
  conductor_crudo: string | null;
  estado_us: string | null;
  fecha_orden: string | null;
  monto: number;
  estado: string;
  regla_match: string | null;
  score: number | null;
  es_comercial: boolean;
  agente_id: string | null;
  agente: string | null;
  oficina: string | null;
  candidatos: unknown;
}

export interface ResumenMvr {
  total: number;
  con_cargo: number;
  monto: number;
  identificados: number;
  sin_dueno: number;
  en_la_casa: number;
  por_oficina: { oficina: string; cargos: number; monto: number }[];
}

export interface MvrDetalle {
  reporteId: string;
  nombreArchivo: string | null;
  periodo: string | null;
  estado: string;
  aseguradora: string | null;
  resumen: ResumenMvr;
  cargos: CargoMvr[];
}

const COLUMNAS =
  "id, fila, asegurado_crudo, conductor_crudo, estado_us, fecha_orden, monto, estado, regla_match, score, es_comercial, agente_id, candidatos, agentes(nombre), oficinas(nombre)";

// PostgREST corta en 1000 filas (max_rows en config.toml). Un MVR de Progressive trae 389, pero
// el QuoteReport trae 1393 y por eso el panel decía "1000 cotizaciones" sobre 1393: la pantalla
// mostraba un número que no era el del archivo. Se pagina para que eso no vuelva a pasar.
async function traerTodos(reporteId: string): Promise<CargoMvr[]> {
  const PAGINA = 1000;
  const out: CargoMvr[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from("lineas_costo")
      .select(COLUMNAS)
      .eq("reporte_id", reporteId)
      .order("fila", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw error;
    const filas = (data ?? []) as unknown as Array<
      Omit<CargoMvr, "agente" | "oficina"> & {
        agentes: { nombre: string } | null;
        oficinas: { nombre: string } | null;
      }
    >;
    out.push(
      ...filas.map((l) => ({ ...l, agente: l.agentes?.nombre ?? null, oficina: l.oficinas?.nombre ?? null }))
    );
    if (filas.length < PAGINA) break;
  }
  return out;
}

export async function getMvrDetalle(reporteId: string): Promise<MvrDetalle> {
  const [rep, res, cargos] = await Promise.all([
    supabase
      .from("reportes")
      .select("id, nombre_archivo, periodo, estado, aseguradoras(nombre)")
      .eq("id", reporteId)
      .single(),
    supabase.rpc("resumen_costos_reporte", { p_reporte_id: reporteId }),
    traerTodos(reporteId),
  ]);
  if (rep.error) throw rep.error;
  if (res.error) throw res.error;
  const r = rep.data as unknown as {
    id: string;
    nombre_archivo: string | null;
    periodo: string | null;
    estado: string;
    aseguradoras: { nombre: string } | null;
  };
  return {
    reporteId: r.id,
    nombreArchivo: r.nombre_archivo,
    periodo: r.periodo,
    estado: r.estado,
    aseguradora: r.aseguradoras?.nombre ?? null,
    resumen: (res.data ?? {}) as unknown as ResumenMvr,
    cargos,
  };
}

export async function asignarCargos(
  ids: string[],
  agenteId: string,
  motivo?: string | null
): Promise<number> {
  const { data, error } = await supabase.rpc("asignar_costos", {
    p_lineas: ids,
    p_agente_id: agenteId,
    p_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message || "No se pudo asignar.");
  return Number(data ?? 0);
}

export async function cargosACuentaCasa(ids: string[], motivo?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("costo_a_cuenta_casa", {
    p_lineas: ids,
    p_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message || "No se pudo mandar a cuenta de la casa.");
  return Number(data ?? 0);
}

// Volver a leer el MISMO archivo, el que ya está guardado, con la función de extracción de hoy.
// Hace falta porque un MVR mal leído no se arregla reprocesando el cruce: los nombres no están
// en la base para recuperarlos -- lineas_costo guarda el dato ya interpretado, no la fila cruda.
// Hasta ahora la única salida era borrar el reporte y volver a subir el archivo a mano.
//
// No es reprocesarReporte(): esa salva a mano lo resuelto en lineas_comision escribiéndolo en el
// Book, y un MVR no tiene nada de eso. El borrado de las líneas lo hace la propia función de
// extracción al empezar, y las excepciones se van solas con ellas (linea_costo_id es ON DELETE
// CASCADE).
export async function releerArchivoMvr(reporteId: string): Promise<void> {
  const { data: actual, error } = await supabase
    .from("reportes")
    .select("estado, updated_at, storage_path")
    .eq("id", reporteId)
    .single();
  if (error) throw error;
  if (!actual?.storage_path) {
    throw new Error("Este reporte se creó a mano y no tiene archivo guardado: no hay nada que volver a leer.");
  }
  // Mismo cuidado que en los statements: cada corrida borra al empezar e inserta al terminar, y
  // dos corridas pisadas dejan el reporte cargado dos veces.
  if (actual.estado === "extrayendo" || actual.estado === "subido") {
    const minutos = (Date.now() - new Date(actual.updated_at).getTime()) / 60000;
    if (minutos < 10) {
      throw new Error(
        `Este reporte ya se está leyendo (empezó hace ${Math.max(1, Math.round(minutos))} min). Esperá a que termine.`
      );
    }
  }

  const { error: updErr } = await supabase
    .from("reportes")
    .update({ estado: "subido", error: null, total_lineas: 0, total_ok: 0, total_excepciones: 0 })
    .eq("id", reporteId);
  if (updErr) throw updErr;

  const { error: fnErr } = await supabase.functions.invoke("extraer-reporte", { body: { reporte_id: reporteId } });
  if (fnErr) throw fnErr;
}

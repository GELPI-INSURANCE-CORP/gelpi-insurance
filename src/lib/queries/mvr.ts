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
  // De que compania vino el cargo. En el consolidado del mes conviven Progressive y National
  // General en la misma tabla, y "por compania cuanto se estan gastando" es justo la pregunta.
  aseguradora: string | null;
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

// El QuoteReport contra el que se cruzaron estos cargos. No es un reporte que haya que revisar
// -- por eso se saco de la lista de archivos -- pero sí hay que poder ver cuál se uso y cuántas
// cotizaciones tenía: si el cruce dejó mucho sin dueño, lo primero que hay que mirar es si el
// padrón es el del mes correcto.
export interface PadronCotizaciones {
  nombreArchivo: string | null;
  periodo: string | null;
  total: number;
  conAgente: number;
}

export interface MvrDetalle {
  reporteId: string;
  nombreArchivo: string | null;
  periodo: string | null;
  estado: string;
  aseguradora: string | null;
  padron: PadronCotizaciones | null;
  resumen: ResumenMvr;
  cargos: CargoMvr[];
}


const COLUMNAS =
  "id, reporte_id, fila, asegurado_crudo, conductor_crudo, estado_us, fecha_orden, monto, estado, regla_match, score, es_comercial, agente_id, candidatos, agentes(nombre), oficinas(nombre)";

// PostgREST corta en 1000 filas (max_rows en config.toml). Un MVR de Progressive trae 389, pero
// el QuoteReport trae 1393 y por eso el panel decía "1000 cotizaciones" sobre 1393: la pantalla
// mostraba un número que no era el del archivo. Se pagina para que eso no vuelva a pasar.
//
// Recibe varios reportes porque la pantalla sirve para dos cosas: un MVR solo, y todos los del
// mes juntos — que es como Arturo le manda a cada oficina lo que gastó, sin importar si vino de
// Progressive o de National General.
async function traerTodos(reporteIds: string[], compañiaDe: Map<string, string | null>): Promise<CargoMvr[]> {
  if (reporteIds.length === 0) return [];
  const PAGINA = 1000;
  const out: CargoMvr[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from("lineas_costo")
      .select(COLUMNAS)
      .in("reporte_id", reporteIds)
      .order("fila", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw error;
    const filas = (data ?? []) as unknown as Array<
      Omit<CargoMvr, "agente" | "oficina" | "aseguradora"> & {
        reporte_id: string;
        agentes: { nombre: string } | null;
        oficinas: { nombre: string } | null;
      }
    >;
    out.push(
      ...filas.map((l) => ({
        ...l,
        agente: l.agentes?.nombre ?? null,
        oficina: l.oficinas?.nombre ?? null,
        aseguradora: compañiaDe.get(l.reporte_id) ?? null,
      }))
    );
    if (filas.length < PAGINA) break;
  }
  return out;
}

function resumirCargos(cargos: CargoMvr[]): ResumenMvr {
  const vivos = cargos.filter((c) => c.estado !== "descartado");
  return {
    total: vivos.length,
    con_cargo: vivos.filter((c) => Number(c.monto ?? 0) > 0).length,
    monto: vivos.reduce((s, c) => s + Number(c.monto ?? 0), 0),
    identificados: vivos.filter((c) => c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado").length,
    sin_dueno: vivos.filter((c) => c.estado === "sin_identificar" || c.estado === "pendiente").length,
    en_la_casa: vivos.filter((c) => c.estado === "cuenta_casa").length,
    por_oficina: [],
  };
}

export async function getMvrDetalle(reporteId: string): Promise<MvrDetalle> {
  const { data: rep, error: errRep } = await supabase
    .from("reportes")
    .select("id, nombre_archivo, periodo, estado, aseguradora_id, aseguradoras(nombre)")
    .eq("id", reporteId)
    .single();
  if (errRep) throw errRep;
  const r = rep as unknown as {
    id: string;
    nombre_archivo: string | null;
    periodo: string | null;
    estado: string;
    aseguradoras: { nombre: string } | null;
  };
  const compania = r.aseguradoras?.nombre ?? null;

  const [res, cargos, cot] = await Promise.all([
    supabase.rpc("resumen_costos_reporte", { p_reporte_id: reporteId }),
    traerTodos([reporteId], new Map([[reporteId, compania]])),
    // El QuoteReport que quedo colgado de este MVR. Se busca por el enlace y no por el mes para
    // que diga exactamente cual se uso, no cual deberia haberse usado.
    supabase
      .from("reportes")
      .select("nombre_archivo, periodo, total_lineas, total_ok")
      .eq("subido_con_id", reporteId)
      .eq("tipo", "cotizaciones")
      .maybeSingle(),
  ]);
  if (res.error) throw res.error;

  return {
    reporteId: r.id,
    nombreArchivo: r.nombre_archivo,
    periodo: r.periodo,
    estado: r.estado,
    aseguradora: compania,
    padron: cot.data
      ? {
          nombreArchivo: cot.data.nombre_archivo as string | null,
          periodo: cot.data.periodo as string | null,
          total: Number(cot.data.total_lineas ?? 0),
          conAgente: Number(cot.data.total_ok ?? 0),
        }
      : null,
    resumen: (res.data ?? {}) as unknown as ResumenMvr,
    cargos,
  };
}

// =========================================================
// Todos los MVR de un mes, juntos
// =========================================================
// Arturo: "deberia haber una parte en que los MVR tu puedas darle merge, puedas exportar un
// Excel y mandarselo a ellos para que vean POR COMPANIA cuanto se estan gastando".
//
// A una oficina no le importa de que archivo salio cada cargo: le importa cuanto gasto en el
// mes y en que. Progressive y National General mandan dos archivos distintos y la oficina paga
// uno solo, asi que la vista que sirve es la del mes entero.
export interface MesConMvr {
  mes: string;
  etiqueta: string | null;
  reportes: number;
}

export async function listMesesConMvr(): Promise<MesConMvr[]> {
  const { data, error } = await supabase
    .from("v_reportes")
    .select("mes_statement, periodo")
    .eq("tipo", "mvr")
    .order("mes_statement", { ascending: false });
  if (error) throw error;
  const m = new Map<string, MesConMvr>();
  for (const r of (data ?? []) as Array<{ mes_statement: string | null; periodo: string | null }>) {
    const mes = r.mes_statement ?? "";
    if (!mes) continue;
    const prev = m.get(mes) ?? { mes, etiqueta: r.periodo, reportes: 0 };
    prev.reportes += 1;
    m.set(mes, prev);
  }
  return [...m.values()];
}

export async function getMvrDelMes(mes: string): Promise<MvrDetalle> {
  const { data, error } = await supabase
    .from("v_reportes")
    .select("id, nombre_archivo, periodo, estado, mes_statement, aseguradoras(nombre)")
    .eq("tipo", "mvr")
    .eq("mes_statement", mes);
  if (error) throw error;
  const reps = (data ?? []) as unknown as Array<{
    id: string;
    nombre_archivo: string | null;
    periodo: string | null;
    estado: string;
    aseguradoras: { nombre: string } | null;
  }>;

  const compañiaDe = new Map<string, string | null>(reps.map((r) => [r.id, r.aseguradoras?.nombre ?? null]));
  const cargos = await traerTodos(reps.map((r) => r.id), compañiaDe);

  return {
    reporteId: "",
    // Los archivos que entraron en este consolidado, para que no sea un numero que sale de
    // ningun lado: si falta uno, se ve que falta.
    nombreArchivo: reps.map((r) => r.nombre_archivo).filter(Boolean).join(" · ") || null,
    periodo: reps[0]?.periodo ?? mes,
    estado: reps.every((r) => r.estado === "cerrado") ? "cerrado" : "matcheado",
    aseguradora: [...new Set(reps.map((r) => r.aseguradoras?.nombre).filter(Boolean))].join(" + ") || null,
    padron: null,
    resumen: resumirCargos(cargos),
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

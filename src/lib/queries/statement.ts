import { supabase } from "@/lib/supabase";
import type { Reporte } from "@/lib/queries/subir";

// Los tres grupos que se muestran arriba del detalle de un statement. Deliberadamente son 3 y no
// los 5 estados internos de una línea: lo que el usuario necesita decidir es "¿esto ya tiene
// dueño?", "¿tengo que decidir algo?" o "¿esto no lo reconoce el sistema?".
export type GrupoLinea = "aprobado" | "pendiente" | "sin_asignar";

const ESTADOS_APROBADOS = ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"];

export function grupoDeEstado(estado: string): GrupoLinea {
  if (ESTADOS_APROBADOS.includes(estado)) return "aprobado";
  if (estado === "sin_identificar") return "sin_asignar";
  return "pendiente";
}

export interface LineaStatement {
  id: string;
  fila: number | null;
  numeroPoliza: string | null;
  cliente: string | null;
  clienteBook: string | null;
  polizaBook: string | null;
  polizaId: string | null;
  tipoTransaccion: string;
  prima: number | null;
  tasa: number | null;
  monto: number;
  fechaStatement: string | null;
  estadoLinea: string;
  grupo: GrupoLinea;
  agenteId: string | null;
  agente: string | null;
  oficina: string | null;
  score: number | null;
  // Datos de la excepción abierta sobre esta línea (si hay)
  excepcionId: string | null;
  excepcionTipo: string | null;
  explicacion: string | null;
  agenteSugeridoId: string | null;
  agenteSugerido: string | null;
  oficinaSugeridaId: string | null;
}

export interface ResumenAgenteStatement {
  agenteId: string;
  nombre: string;
  lineas: number;
  monto: number;
}

export interface StatementDetalle {
  reporte: Reporte;
  lineas: LineaStatement[];
  montoAprobado: number;
  montoPendiente: number;
  montoSinAsignar: number;
  countAprobado: number;
  countPendiente: number;
  countSinAsignar: number;
  porAgente: ResumenAgenteStatement[];
}

// PostgREST corta cada respuesta en max_rows (1000) sin avisar; un statement grande puede
// pasarse, así que paginamos con orden estable.
async function fetchTodo<T>(tabla: string, columnas: string, reporteId: string): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .eq("reporte_id", reporteId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function getStatementDetalle(reporteId: string): Promise<StatementDetalle> {
  const [{ data: reporte, error: errRep }, lineasRaw, excepcionesRaw] = await Promise.all([
    supabase
      .from("reportes")
      .select("*, aseguradora:aseguradoras(nombre)")
      .eq("id", reporteId)
      .single(),
    fetchTodo<Record<string, unknown>>(
      "v_lineas_comision",
      "id, fila, numero_poliza_crudo, nombre_asegurado_crudo, tipo_transaccion, prima, tasa, monto, fecha_statement, estado, score, agente_id, agente, oficina, cliente, poliza_abb, poliza_id",
      reporteId
    ),
    fetchTodo<Record<string, unknown>>(
      "v_excepciones",
      "id, tipo, linea_comision_id, explicacion, estado, agente_sugerido_id, agente_sugerido, oficina_sugerida_id",
      reporteId
    ),
  ]);
  if (errRep) throw errRep;

  const excPorLinea = new Map<string, Record<string, unknown>>();
  for (const e of excepcionesRaw) {
    if (e.estado !== "pendiente") continue;
    const lid = e.linea_comision_id as string | null;
    if (lid) excPorLinea.set(lid, e);
  }

  const lineas: LineaStatement[] = lineasRaw.map((l) => {
    const id = l.id as string;
    const exc = excPorLinea.get(id);
    const estadoLinea = (l.estado as string) ?? "pendiente";
    return {
      id,
      fila: (l.fila as number) ?? null,
      numeroPoliza: (l.numero_poliza_crudo as string) ?? null,
      cliente: (l.nombre_asegurado_crudo as string) ?? null,
      clienteBook: (l.cliente as string) ?? null,
      polizaBook: (l.poliza_abb as string) ?? null,
      polizaId: (l.poliza_id as string) ?? null,
      tipoTransaccion: (l.tipo_transaccion as string) ?? "otro",
      prima: (l.prima as number) ?? null,
      tasa: (l.tasa as number) ?? null,
      monto: Number(l.monto ?? 0),
      fechaStatement: (l.fecha_statement as string) ?? null,
      estadoLinea,
      grupo: grupoDeEstado(estadoLinea),
      agenteId: (l.agente_id as string) ?? null,
      agente: (l.agente as string) ?? null,
      oficina: (l.oficina as string) ?? null,
      score: (l.score as number) ?? null,
      excepcionId: (exc?.id as string) ?? null,
      excepcionTipo: (exc?.tipo as string) ?? null,
      explicacion: (exc?.explicacion as string) ?? null,
      agenteSugeridoId: (exc?.agente_sugerido_id as string) ?? null,
      agenteSugerido: (exc?.agente_sugerido as string) ?? null,
      oficinaSugeridaId: (exc?.oficina_sugerida_id as string) ?? null,
    };
  });

  const sumaDe = (g: GrupoLinea) => lineas.filter((l) => l.grupo === g).reduce((s, l) => s + l.monto, 0);
  const cuentaDe = (g: GrupoLinea) => lineas.filter((l) => l.grupo === g).length;

  const porAgenteMap = new Map<string, ResumenAgenteStatement>();
  for (const l of lineas) {
    if (l.grupo !== "aprobado" || !l.agenteId) continue;
    const actual = porAgenteMap.get(l.agenteId) ?? {
      agenteId: l.agenteId,
      nombre: l.agente ?? "(sin nombre)",
      lineas: 0,
      monto: 0,
    };
    actual.lineas += 1;
    actual.monto += l.monto;
    porAgenteMap.set(l.agenteId, actual);
  }

  return {
    reporte: reporte as unknown as Reporte,
    lineas,
    montoAprobado: sumaDe("aprobado"),
    montoPendiente: sumaDe("pendiente"),
    montoSinAsignar: sumaDe("sin_asignar"),
    countAprobado: cuentaDe("aprobado"),
    countPendiente: cuentaDe("pendiente"),
    countSinAsignar: cuentaDe("sin_asignar"),
    porAgente: Array.from(porAgenteMap.values()).sort((a, b) => b.monto - a.monto),
  };
}

// Cierra el statement. Solo se permite cuando ya no queda nada por decidir: si quedan líneas
// pendientes o sin asignar, cerrarlo escondería plata sin dueño detrás de un estado "Cerrado".
export async function finalizarStatement(reporteId: string): Promise<void> {
  const { error } = await supabase.from("reportes").update({ estado: "cerrado" }).eq("id", reporteId);
  if (error) throw error;
}

export async function reabrirStatement(reporteId: string): Promise<void> {
  const { error } = await supabase.from("reportes").update({ estado: "matcheado" }).eq("id", reporteId);
  if (error) throw error;
}

// Corrige el agente de una línea que YA está conciliada. Las acciones de Conciliación
// (resolver_excepcion) solo sirven mientras hay una excepción abierta; una vez que la línea se
// concilió — sola o a mano — no quedaba forma de tocarla. Pero el sistema acierta ~3 de cada 4, y
// entre el cuarto restante hay casos donde cree que acertó y no: esa plata termina en el cheque de
// alguien, así que tiene que poder corregirse.
export async function reasignarLinea(params: {
  lineaId: string;
  polizaId: string | null;
  agenteIdNuevo: string;
  agenteAnterior: string | null;
  agenteNuevo: string;
  motivo: string;
}): Promise<void> {
  const motivo = params.motivo.trim();
  if (!motivo) throw new Error("El motivo es obligatorio para cambiar el agente de una línea ya conciliada.");

  const { data: agente, error: errAg } = await supabase
    .from("agentes")
    .select("oficina_id")
    .eq("id", params.agenteIdNuevo)
    .single();
  if (errAg) throw errAg;

  const { error: errLinea } = await supabase
    .from("lineas_comision")
    .update({
      agente_id: params.agenteIdNuevo,
      oficina_id: agente?.oficina_id ?? null,
      estado: "conciliado_confirmado",
      regla_match: "override_manual",
    })
    .eq("id", params.lineaId);
  if (errLinea) throw errLinea;

  // El cambio se escribe también en la póliza del Book: si no, el mes que viene el statement
  // vuelve a caer en el agente equivocado y hay que corregirlo de nuevo, todos los meses.
  if (params.polizaId) {
    const { error: errPol } = await supabase
      .from("polizas")
      .update({ agente_id: params.agenteIdNuevo, oficina_id: agente?.oficina_id ?? null })
      .eq("id", params.polizaId);
    if (errPol) throw errPol;
  }

  // Queda registrado quién cobraba antes y por qué se cambió. Sin esto, dentro de seis meses nadie
  // puede explicar por qué una comisión salió de una cuenta y entró en otra.
  const { data: usuario } = await supabase.auth.getUser();
  await supabase.from("auditoria").insert({
    entidad: "lineas_comision",
    entidad_id: params.lineaId,
    accion: "reasignar_agente",
    campo: "agente_id",
    valor_anterior: params.agenteAnterior,
    valor_nuevo: params.agenteNuevo,
    usuario: usuario?.user?.id ?? null,
    motivo,
  });
}

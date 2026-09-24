import { supabase } from "@/lib/supabase";
import type { Reporte } from "@/lib/queries/subir";

// Los tres grupos que se muestran arriba del detalle de un statement. Deliberadamente son 3 y no
// los 5 estados internos de una línea: lo que el usuario necesita decidir es "¿esto ya tiene
// dueño?", "¿tengo que decidir algo?" o "¿esto no lo reconoce el sistema?".
// "excluida" es aparte de los tres: son líneas que el statement muestra pero que NO son plata de
// este mes — el caso real es United, que arriba de todo pone cuánto te pagó el mes pasado. Esa
// línea no puede sumar ni restar: con ella contada, un statement de $13,611.70 se mostraba como
// $9,111.38 y no cuadraba contra el depósito.
export type GrupoLinea = "aprobado" | "pendiente" | "sin_asignar" | "excluida";

const ESTADOS_APROBADOS = ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"];

export function grupoDeEstado(estado: string): GrupoLinea {
  if (estado === "descartado") return "excluida";
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
  // Cuando la linea se marco como gasto de la agencia (MVR, fee, ajuste): la clave de la categoria
  categoriaAjuste: string | null;
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
  montoExcluido: number;
  countExcluida: number;
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
      "id, fila, numero_poliza_crudo, nombre_asegurado_crudo, tipo_transaccion, prima, tasa, monto, fecha_statement, estado, score, agente_id, agente, oficina, cliente, poliza_abb, poliza_id, campos_extra",
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
      categoriaAjuste: ((l.campos_extra as Record<string, unknown>) ?? {}).categoria_ajuste as string ?? null,
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
    montoExcluido: sumaDe("excluida"),
    countExcluida: cuentaDe("excluida"),
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

// Categorías de las líneas que no son comisión de nadie. Se guardan con una clave fija (no con el
// texto que se muestra) para poder desglosarlas después: "cuánto me cobraron de MVR este año" es
// una pregunta que se responde agrupando por esta clave, y no se puede responder agrupando por una
// nota escrita a mano, donde el mismo concepto aparece como "MVR", "mvr", "M.V.R." y "vehiculos".
export const CATEGORIAS_AJUSTE: { value: string; label: string; ayuda: string }[] = [
  { value: "mvr", label: "MVR", ayuda: "Cargo por correr el reporte de vehículo de una cotización" },
  { value: "ajuste_aseguradora", label: "Ajuste de la aseguradora", ayuda: "Correcciones o devoluciones que hace el carrier" },
  { value: "cargo_administrativo", label: "Cargo administrativo", ayuda: "Cuotas, fees o cargos de la cuenta de la agencia" },
  { value: "otro", label: "Otro", ayuda: "Cualquier otra cosa que no sea comisión de un agente" },
  // Distinta de las de arriba: las otras son plata que se movió este mes y suma en el total como
  // gasto de la agencia. Esta NO es plata de este mes — el statement solo la menciona.
  { value: "referencia", label: "Pago de un mes anterior (referencia)", ayuda: "Aparece en el statement pero no es plata de este mes: no suma ni resta" },
];

// Las categorías que sacan la línea del statement en vez de cobrarla a la agencia.
const CATEGORIAS_EXCLUYENTES = ["referencia"];

// Marca una línea como gasto/ajuste de la agencia: deja de buscar agente y pasa a la cuenta de la
// casa, conservando su monto en el statement. La categoría se guarda en la línea, aparte de la
// nota, para que un reporte futuro pueda sumarlas por concepto.
export async function marcarLineaComoAjuste(params: {
  excepcionId: string | null;
  lineaId: string;
  categoria: string;
  nota: string;
}): Promise<void> {
  const etiqueta = CATEGORIAS_AJUSTE.find((c) => c.value === params.categoria)?.label ?? params.categoria;
  const nota = params.nota.trim();
  const motivo = nota ? `${etiqueta} — ${nota}` : etiqueta;
  const excluye = CATEGORIAS_EXCLUYENTES.includes(params.categoria);

  if (excluye) {
    // No es plata de este mes, así que no puede ir a la cuenta de la casa: eso la sumaría al
    // total igual. Se descarta la línea — sigue en el statement, visible y con su monto, pero
    // fuera de todas las cuentas.
    const { error } = await supabase
      .from("lineas_comision")
      .update({ estado: "descartado", regla_match: "no_es_de_este_mes", agente_id: null, oficina_id: null })
      .eq("id", params.lineaId);
    if (error) throw error;
    if (params.excepcionId) {
      await supabase
        .from("excepciones")
        .update({ estado: "resuelta", accion: "excluida_no_es_de_este_mes", nota: motivo, resuelta_en: new Date().toISOString() })
        .eq("id", params.excepcionId);
    }
  } else if (params.excepcionId) {
    const { error: errRpc } = await supabase.rpc("resolver_excepcion", {
      p_excepcion_id: params.excepcionId,
      p_accion: "cuenta_casa",
      p_agente_id: null,
      p_oficina_id: null,
      p_poliza_id: null,
      p_motivo: motivo,
      p_cliente: null,
    });
    if (errRpc) throw errRpc;
  } else {
    // Línea sin excepción abierta (por ejemplo una cancelación que quedó "en espera", que el
    // motor deja en ese estado sin abrir excepción). resolver_excepcion no sirve acá.
    const { data: casa } = await supabase.from("agentes").select("id, oficina_id").eq("es_casa", true).maybeSingle();
    const { error } = await supabase
      .from("lineas_comision")
      .update({
        estado: "cuenta_casa",
        regla_match: "cuenta_casa",
        agente_id: casa?.id ?? null,
        oficina_id: casa?.oficina_id ?? null,
      })
      .eq("id", params.lineaId);
    if (error) throw error;
  }

  // La categoría va en campos_extra de la línea, no solo en la nota de la excepción: la línea es lo
  // que sobrevive y lo que se suma en los reportes. Se lee y se reescribe el objeto entero para no
  // pisar lo que el extractor haya guardado ahí del archivo original.
  const { data: linea } = await supabase.from("lineas_comision").select("campos_extra").eq("id", params.lineaId).single();
  const extra = (linea?.campos_extra ?? {}) as Record<string, unknown>;
  const { error: errLinea } = await supabase
    .from("lineas_comision")
    .update({ campos_extra: { ...extra, categoria_ajuste: params.categoria, nota_ajuste: nota || null } })
    .eq("id", params.lineaId);
  if (errLinea) throw errLinea;
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
  // El motivo se exige solo cuando se le saca la linea a un agente que ya la tenia: ahi hay que
  // poder explicar por que la plata cambio de dueno. Asignar una que no tenia dueno no es corregir
  // a nadie, y pedir un motivo ahi solo agrega friccion.
  if (!motivo && params.agenteAnterior) {
    throw new Error("Poné el motivo: esta línea ya estaba asignada a " + params.agenteAnterior + ".");
  }

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

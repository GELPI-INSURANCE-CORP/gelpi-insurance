import { supabase } from "@/lib/supabase";

export interface AgenteRow {
  id: string;
  nombre: string;
  codigo: string | null;
  oficina_id: string | null;
  supervisor_id: string | null;
  email: string | null;
  telefono: string | null;
  pct_split_default: number;
  fecha_alta: string | null;
  activo: boolean;
  es_casa: boolean;
  oficina?: { nombre: string } | null;
}

export interface AgenteDirectorioItem extends AgenteRow {
  oficinaNombre: string;
  comisionMes: number;
  excepcionesAbiertas: number;
  esEncargado: boolean;
}

function monthRange(d = new Date()) {
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

export async function listOficinasSimple() {
  const { data, error } = await supabase.from("oficinas").select("id, nombre, gerente_agente_id").order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function listAgentesSimple() {
  const { data, error } = await supabase
    .from("agentes")
    .select("id, nombre, codigo, oficina_id, activo, es_casa")
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function listAgentesDirectorio(): Promise<AgenteDirectorioItem[]> {
  const [{ data: agentes, error: e1 }, oficinas] = await Promise.all([
    supabase
      .from("agentes")
      .select("id, nombre, codigo, oficina_id, supervisor_id, email, telefono, pct_split_default, fecha_alta, activo, es_casa, oficina:oficinas(nombre)")
      .eq("activo", true)
      .order("nombre"),
    listOficinasSimple(),
  ]);
  if (e1) throw e1;
  const rows = (agentes ?? []) as unknown as AgenteRow[];
  const { desde, hasta } = monthRange();

  const [{ data: lc, error: e2 }, { data: ex, error: e3 }] = await Promise.all([
    supabase
      .from("v_lineas_comision")
      .select("agente_id, monto")
      .in("estado", ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"])
      .gte("fecha_statement", desde)
      .lte("fecha_statement", hasta),
    supabase.from("v_excepciones").select("agente_sugerido_id").eq("estado", "pendiente"),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const comisionPorAgente = new Map<string, number>();
  for (const l of lc ?? []) {
    if (!l.agente_id) continue;
    comisionPorAgente.set(l.agente_id, (comisionPorAgente.get(l.agente_id) ?? 0) + Number(l.monto ?? 0));
  }
  const excepcionesPorAgente = new Map<string, number>();
  for (const e of ex ?? []) {
    if (!e.agente_sugerido_id) continue;
    excepcionesPorAgente.set(e.agente_sugerido_id, (excepcionesPorAgente.get(e.agente_sugerido_id) ?? 0) + 1);
  }

  const encargadoIds = new Set((oficinas ?? []).map((o) => o.gerente_agente_id).filter(Boolean) as string[]);

  return rows.map((a) => ({
    ...a,
    oficinaNombre: a.oficina?.nombre ?? "Sin oficina",
    comisionMes: comisionPorAgente.get(a.id) ?? 0,
    excepcionesAbiertas: excepcionesPorAgente.get(a.id) ?? 0,
    esEncargado: encargadoIds.has(a.id),
  }));
}

export async function getAgente(id: string): Promise<AgenteRow | null> {
  const { data, error } = await supabase
    .from("agentes")
    .select("id, nombre, codigo, oficina_id, supervisor_id, email, telefono, pct_split_default, fecha_alta, activo, es_casa, oficina:oficinas(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as AgenteRow | null;
}

export async function getAgenteKpis(agenteId: string) {
  const { desde, hasta } = monthRange();
  const anioDesde = `${new Date().getFullYear()}-01-01`;
  const anioHasta = `${new Date().getFullYear()}-12-31`;

  const [mes, ytd, bonos, polizas, excepciones] = await Promise.all([
    supabase
      .from("v_lineas_comision")
      .select("monto")
      .eq("agente_id", agenteId)
      .in("estado", ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"])
      .gte("fecha_statement", desde)
      .lte("fecha_statement", hasta),
    supabase
      .from("v_lineas_comision")
      .select("monto")
      .eq("agente_id", agenteId)
      .in("estado", ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"])
      .gte("fecha_statement", anioDesde)
      .lte("fecha_statement", anioHasta),
    supabase.from("bono_reparto").select("monto, bonos!inner(periodo)").eq("agente_id", agenteId).gte("bonos.periodo", anioDesde.slice(0, 4)),
    supabase.from("v_polizas").select("id", { count: "exact", head: true }).eq("agente_id", agenteId).eq("estado", "activa"),
    supabase.from("v_excepciones").select("id", { count: "exact", head: true }).eq("agente_sugerido_id", agenteId).eq("estado", "pendiente"),
  ]);
  if (mes.error) throw mes.error;
  if (ytd.error) throw ytd.error;
  if (polizas.error) throw polizas.error;
  if (excepciones.error) throw excepciones.error;

  const sum = (rows: { monto: number | null }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.monto ?? 0), 0);
  const bonosYtd = ((bonos.data as unknown as { monto: number }[]) ?? []).reduce((s, b) => s + Number(b.monto ?? 0), 0);

  return {
    comisionMes: sum(mes.data),
    comisionYtd: sum(ytd.data),
    bonosYtd,
    polizasActivas: polizas.count ?? 0,
    excepcionesAbiertas: excepciones.count ?? 0,
  };
}

export interface FiltrosComisiones {
  aseguradoraId?: string;
  desde?: string;
  hasta?: string;
  tipoTransaccion?: string;
  buscar?: string;
}

export async function listLineasComisionAgente(
  agenteId: string,
  filtros: FiltrosComisiones,
  page: number,
  pageSize = 25
) {
  let q = supabase
    .from("v_lineas_comision")
    .select(
      "id, aseguradora, poliza_abb, numero_poliza_crudo, cliente, tipo_transaccion, fecha_statement, prima, tasa, monto, estado, regla_match, score, productor_crudo",
      { count: "exact" }
    )
    .eq("agente_id", agenteId)
    .in("estado", ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"])
    .order("fecha_statement", { ascending: false });

  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.desde) q = q.gte("fecha_statement", filtros.desde);
  if (filtros.hasta) q = q.lte("fecha_statement", filtros.hasta);
  if (filtros.tipoTransaccion) q = q.eq("tipo_transaccion", filtros.tipoTransaccion);
  if (filtros.buscar) {
    q = q.or(`numero_poliza_crudo.ilike.%${filtros.buscar}%,cliente.ilike.%${filtros.buscar}%,poliza_abb.ilike.%${filtros.buscar}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getLineaAuditoria(lineaId: string) {
  const { data, error } = await supabase
    .from("auditoria")
    .select("*")
    .eq("entidad", "linea_comision")
    .eq("entidad_id", lineaId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function reasignarLinea(lineaId: string, agenteId: string, motivo: string) {
  const { error } = await supabase.rpc("reasignar_linea", {
    p_linea_id: lineaId,
    p_agente_id: agenteId,
    p_motivo: motivo,
  });
  if (error) throw error;
}

export async function listBonoRepartoAgente(agenteId: string) {
  const { data, error } = await supabase
    .from("bono_reparto")
    .select("id, monto, motivo, pagado, bonos:bono_id(nombre, tipo, periodo, estado)")
    .eq("agente_id", agenteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listExcepcionesAgente(agenteId: string) {
  const { data, error } = await supabase
    .from("v_excepciones")
    .select("*")
    .eq("agente_sugerido_id", agenteId)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface NuevoAgente {
  nombre: string;
  codigo: string;
  oficina_id: string;
  supervisor_id: string | null;
  email: string;
  telefono: string;
  pct_split_default: number;
}

export async function crearAgente(input: NuevoAgente) {
  const { data, error } = await supabase.from("agentes").insert(input).select("id").single();
  if (error) throw error;
  return data;
}

export async function listAseguradorasSimple() {
  const { data, error } = await supabase.from("aseguradoras").select("id, nombre").order("nombre");
  if (error) throw error;
  return data ?? [];
}

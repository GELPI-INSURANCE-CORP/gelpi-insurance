import { supabase } from "@/lib/supabase";

export interface FiltrosPolizas {
  buscar?: string;
  oficinaId?: string;
  agenteId?: string;
  aseguradoraId?: string;
  ramo?: string;
  estado?: string;
  sinAgente?: boolean;
}

export async function listPolizas(filtros: FiltrosPolizas, page: number, pageSize = 50) {
  let q = supabase
    .from("v_polizas")
    .select(
      "id, cliente_id, cliente, telefono, email, numero_poliza, aseguradora, aseguradora_id, ramo, agente, agente_id, oficina, oficina_id, fecha_vigencia, fecha_vencimiento, estado, origen, prima, updated_at",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  if (filtros.oficinaId) q = q.eq("oficina_id", filtros.oficinaId);
  if (filtros.agenteId) q = q.eq("agente_id", filtros.agenteId);
  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.ramo) q = q.eq("ramo", filtros.ramo);
  if (filtros.estado) q = q.eq("estado", filtros.estado);
  if (filtros.sinAgente) q = q.is("agente_id", null);
  if (filtros.buscar) {
    const term = filtros.buscar.trim().replace(/[%,()]/g, "");
    if (term) {
      q = q.or(`cliente.ilike.%${term}%,numero_poliza.ilike.%${term}%,telefono.ilike.%${term}%`);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function countPolizasSinAsignar() {
  const { count, error } = await supabase
    .from("v_polizas")
    .select("id", { count: "exact", head: true })
    .eq("estado", "activa")
    .or("agente_id.is.null,oficina_id.is.null");
  if (error) throw error;
  return count ?? 0;
}

export async function getPoliza(id: string) {
  const { data, error } = await supabase.from("v_polizas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAuditoriaPoliza(polizaId: string) {
  const { data, error } = await supabase
    .from("auditoria")
    .select("*")
    .eq("entidad", "poliza")
    .eq("entidad_id", polizaId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface EdicionPoliza {
  agente_id?: string | null;
  oficina_id?: string | null;
  estado?: string;
  ramo?: string;
}

export async function actualizarPoliza(id: string, cambios: EdicionPoliza, camposAnteriores: EdicionPoliza, motivo?: string) {
  const { error } = await supabase.from("polizas").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;

  const entradas = Object.entries(cambios).filter(([k, v]) => v !== undefined && v !== (camposAnteriores as Record<string, unknown>)[k]);
  if (entradas.length === 0) return;
  const { data: auth } = await supabase.auth.getUser();
  const rows = entradas.map(([campo, valorNuevo]) => ({
    entidad: "poliza",
    entidad_id: id,
    accion: "editar",
    campo,
    valor_anterior: String((camposAnteriores as Record<string, unknown>)[campo] ?? ""),
    valor_nuevo: String(valorNuevo ?? ""),
    usuario: auth?.user?.id ?? null,
    motivo: motivo ?? null,
  }));
  const { error: e2 } = await supabase.from("auditoria").insert(rows);
  if (e2) throw e2;
}

export interface AltaManual {
  cliente_nombre: string;
  telefono: string;
  email: string;
  numero_poliza: string;
  aseguradora_id: string;
  ramo: string;
  agente_id: string;
  oficina_id: string;
  fecha_vigencia: string;
  prima: number;
}

export async function altaManualClientePoliza(input: AltaManual) {
  const { data: cliente, error: e1 } = await supabase
    .from("clientes")
    .insert({ nombre: input.cliente_nombre, telefono: input.telefono, email: input.email })
    .select("id")
    .single();
  if (e1) throw e1;

  const { error: e2 } = await supabase.from("polizas").insert({
    cliente_id: cliente.id,
    numero_poliza: input.numero_poliza,
    aseguradora_id: input.aseguradora_id,
    ramo: input.ramo,
    agente_id: input.agente_id,
    oficina_id: input.oficina_id,
    fecha_vigencia: input.fecha_vigencia || null,
    prima: input.prima || null,
    origen: "alta_manual",
  });
  if (e2) throw e2;
}

export async function congelarSnapshotAbb(nota: string) {
  const { data: auth } = await supabase.auth.getUser();
  const { error: e1 } = await supabase.from("abb_versiones").update({ estado: "historica" }).eq("estado", "vigente");
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("abb_versiones")
    .insert({ estado: "vigente", nota, subido_por: auth?.user?.id ?? null });
  if (e2) throw e2;
}

export async function listConflictosVenta() {
  const { data, error } = await supabase
    .from("v_excepciones")
    .select("*")
    .eq("tipo", "conflicto_venta")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function resolverConflictoVenta(excepcionId: string, agenteId: string) {
  const { error } = await supabase.rpc("resolver_excepcion", {
    p_excepcion_id: excepcionId,
    p_accion: "elegir_dueno",
    p_agente_id: agenteId,
  });
  if (error) throw error;
}

export async function listAgentesOficinasAseguradoras() {
  const [agentes, oficinas, aseguradoras] = await Promise.all([
    supabase.from("agentes").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("oficinas").select("id, nombre").order("nombre"),
    supabase.from("aseguradoras").select("id, nombre").order("nombre"),
  ]);
  if (agentes.error) throw agentes.error;
  if (oficinas.error) throw oficinas.error;
  if (aseguradoras.error) throw aseguradoras.error;
  return {
    agentes: agentes.data ?? [],
    oficinas: oficinas.data ?? [],
    aseguradoras: aseguradoras.data ?? [],
  };
}

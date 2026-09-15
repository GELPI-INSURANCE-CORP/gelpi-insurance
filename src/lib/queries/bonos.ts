import { supabase } from "@/lib/supabase";

export interface BonoRow {
  id: string;
  tipo: string;
  nombre: string | null;
  aseguradora_id: string | null;
  periodo: string | null;
  monto_total: number;
  regla_reparto: string;
  oficina_id: string | null;
  estado: string;
  created_at: string;
  aseguradora?: { nombre: string } | null;
  oficina?: { nombre: string } | null;
}

export interface FiltrosBonos {
  aseguradoraId?: string;
  periodo?: string;
  tipo?: string;
  estado?: string;
  agenteId?: string;
  oficinaId?: string;
}

export async function listBonos(filtros: FiltrosBonos) {
  let q = supabase
    .from("bonos")
    .select("*, aseguradora:aseguradoras(nombre), oficina:oficinas(nombre)")
    .order("created_at", { ascending: false });
  if (filtros.aseguradoraId) q = q.eq("aseguradora_id", filtros.aseguradoraId);
  if (filtros.periodo) q = q.eq("periodo", filtros.periodo);
  if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
  if (filtros.estado) q = q.eq("estado", filtros.estado);
  if (filtros.oficinaId) q = q.eq("oficina_id", filtros.oficinaId);
  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as unknown as BonoRow[];

  if (filtros.agenteId) {
    const { data: repartos, error: e2 } = await supabase
      .from("bono_reparto")
      .select("bono_id")
      .eq("agente_id", filtros.agenteId);
    if (e2) throw e2;
    const ids = new Set((repartos ?? []).map((r) => r.bono_id));
    rows = rows.filter((b) => ids.has(b.id));
  }

  const { data: conteos, error: e3 } = await supabase.from("bono_reparto").select("bono_id");
  if (e3) throw e3;
  const conteoMap = new Map<string, number>();
  for (const c of conteos ?? []) {
    conteoMap.set(c.bono_id, (conteoMap.get(c.bono_id) ?? 0) + 1);
  }

  return rows.map((b) => ({ ...b, agentesBeneficiados: conteoMap.get(b.id) ?? 0 }));
}

export async function getBono(id: string) {
  const { data, error } = await supabase
    .from("bonos")
    .select("*, aseguradora:aseguradoras(nombre), oficina:oficinas(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as BonoRow | null;
}

export async function listRepartoBono(bonoId: string) {
  const { data, error } = await supabase
    .from("bono_reparto")
    .select("id, monto, motivo, pagado, agente:agentes(id, nombre)")
    .eq("bono_id", bonoId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function agregarFilaReparto(bonoId: string, agenteId: string, monto: number, motivo: string) {
  const { error } = await supabase.from("bono_reparto").insert({ bono_id: bonoId, agente_id: agenteId, monto, motivo });
  if (error) throw error;
}

export async function quitarFilaReparto(id: string) {
  const { error } = await supabase.from("bono_reparto").delete().eq("id", id);
  if (error) throw error;
}

export async function simularRepartoProporcional(bono: BonoRow) {
  if (!bono.periodo) return [];
  const match = /^(\d{4})-(\d{2})$/.exec(bono.periodo.trim());
  if (!match) {
    throw new Error(`Período de bono con formato inválido: "${bono.periodo}" (se espera AAAA-MM).`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) {
    throw new Error(`Mes inválido en período de bono: "${bono.periodo}".`);
  }
  const desde = new Date(y, m - 1, 1).toISOString().slice(0, 10);
  const hasta = new Date(y, m, 0).toISOString().slice(0, 10);

  let q = supabase
    .from("v_lineas_comision")
    .select("agente_id, agente, monto")
    .in("estado", ["conciliado_auto", "conciliado_confirmado"])
    .gte("fecha_statement", desde)
    .lte("fecha_statement", hasta)
    .not("agente_id", "is", null);
  if (bono.aseguradora_id) q = q.eq("aseguradora_id", bono.aseguradora_id);
  if (bono.oficina_id) q = q.eq("oficina_id", bono.oficina_id);
  const { data, error } = await q;
  if (error) throw error;

  const porAgente = new Map<string, { nombre: string; produccion: number }>();
  for (const l of data ?? []) {
    if (!l.agente_id) continue;
    const cur = porAgente.get(l.agente_id) ?? { nombre: l.agente ?? "", produccion: 0 };
    cur.produccion += Number(l.monto ?? 0);
    porAgente.set(l.agente_id, cur);
  }
  const totalProduccion = [...porAgente.values()].reduce((s, v) => s + v.produccion, 0);
  if (totalProduccion <= 0) return [];
  return [...porAgente.entries()].map(([agenteId, v]) => ({
    agente_id: agenteId,
    agente_nombre: v.nombre,
    produccion: v.produccion,
    monto: Math.round(((v.produccion / totalProduccion) * bono.monto_total) * 100) / 100,
  }));
}

export async function ejecutarReparto(bonoId: string, propuesta: { agente_id: string; monto: number; motivo?: string }[]) {
  await supabase.from("bono_reparto").delete().eq("bono_id", bonoId);
  const { error: e1 } = await supabase.from("bono_reparto").insert(
    propuesta.map((p) => ({ bono_id: bonoId, agente_id: p.agente_id, monto: p.monto, motivo: p.motivo ?? "Reparto proporcional a producción del período" }))
  );
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("bonos").update({ estado: "repartido" }).eq("id", bonoId);
  if (e2) throw e2;
}

export async function marcarBonoPagado(bonoId: string) {
  const { error: e1 } = await supabase.from("bonos").update({ estado: "pagado" }).eq("id", bonoId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("bono_reparto").update({ pagado: true }).eq("bono_id", bonoId);
  if (e2) throw e2;
}

export interface NuevoBono {
  tipo: string;
  nombre: string;
  aseguradora_id: string | null;
  periodo: string;
  monto_total: number;
  regla_reparto: string;
  oficina_id: string | null;
}

export async function crearBonoManual(input: NuevoBono) {
  const { error } = await supabase.from("bonos").insert(input);
  if (error) throw error;
}

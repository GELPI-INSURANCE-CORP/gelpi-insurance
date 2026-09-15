import { supabase } from "@/lib/supabase";

export interface OficinaRow {
  id: string;
  nombre: string;
  codigo: string | null;
  direccion: string | null;
  gerente_agente_id: string | null;
  pct_override: number;
  activa: boolean;
  created_at: string;
}

export interface OficinaResumen extends OficinaRow {
  gerenteNombre: string;
  numAgentes: number;
  polizasActivas: number;
  comisionMes: number;
  excepcionesAbiertas: number;
  antiguedadPromedioAnios: number;
  pctConciliadoAuto: number;
}

function monthRange(periodo?: string) {
  if (periodo) {
    const [y, m] = periodo.split("-").map(Number);
    const desde = new Date(y, m - 1, 1).toISOString().slice(0, 10);
    const hasta = new Date(y, m, 0).toISOString().slice(0, 10);
    return { desde, hasta };
  }
  const d = new Date();
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

export async function listOficinasResumen(periodo?: string, aseguradoraId?: string): Promise<OficinaResumen[]> {
  const { desde, hasta } = monthRange(periodo);

  const [{ data: oficinas, error: e1 }, { data: agentes, error: e2 }] = await Promise.all([
    supabase.from("oficinas").select("*, gerente:agentes!oficinas_gerente_fk(nombre)").order("nombre"),
    supabase.from("agentes").select("id, oficina_id, fecha_alta, activo").eq("activo", true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  // PostgREST recorta cada respuesta a max_rows=1000 (supabase/config.toml) sin avisar; esta
  // consulta es company-wide (todas las oficinas del mes), así que paginamos en bloques con un
  // orden estable (id) hasta cubrir el total real.
  const lc: { oficina_id: string | null; estado: string | null; monto: number | null }[] = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      let lcQuery = supabase
        .from("v_lineas_comision")
        .select("oficina_id, estado, monto")
        .gte("fecha_statement", desde)
        .lte("fecha_statement", hasta)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (aseguradoraId) lcQuery = lcQuery.eq("aseguradora_id", aseguradoraId);
      const { data, error: e3 } = await lcQuery;
      if (e3) throw e3;
      const page = data ?? [];
      lc.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
  }

  const { data: polizas, error: e4 } = await supabase.from("v_polizas").select("oficina_id").eq("estado", "activa");
  if (e4) throw e4;

  const { data: excepciones, error: e5 } = await supabase
    .from("v_excepciones")
    .select("oficina_sugerida_id")
    .eq("estado", "pendiente");
  if (e5) throw e5;

  const agentesPorOficina = new Map<string, { count: number; fechas: string[] }>();
  for (const a of agentes ?? []) {
    if (!a.oficina_id) continue;
    const cur = agentesPorOficina.get(a.oficina_id) ?? { count: 0, fechas: [] };
    cur.count += 1;
    if (a.fecha_alta) cur.fechas.push(a.fecha_alta);
    agentesPorOficina.set(a.oficina_id, cur);
  }

  const polizasPorOficina = new Map<string, number>();
  for (const p of polizas ?? []) {
    if (!p.oficina_id) continue;
    polizasPorOficina.set(p.oficina_id, (polizasPorOficina.get(p.oficina_id) ?? 0) + 1);
  }

  const excepcionesPorOficina = new Map<string, number>();
  for (const e of excepciones ?? []) {
    if (!e.oficina_sugerida_id) continue;
    excepcionesPorOficina.set(e.oficina_sugerida_id, (excepcionesPorOficina.get(e.oficina_sugerida_id) ?? 0) + 1);
  }

  const conteoPorOficina = new Map<string, { auto: number; confirmado: number; monto: number }>();
  for (const l of lc) {
    if (!l.oficina_id) continue;
    const cur = conteoPorOficina.get(l.oficina_id) ?? { auto: 0, confirmado: 0, monto: 0 };
    if (l.estado === "conciliado_auto") cur.auto += 1;
    if (l.estado === "conciliado_confirmado") cur.confirmado += 1;
    if (["conciliado_auto", "conciliado_confirmado", "cuenta_casa"].includes(l.estado ?? "")) cur.monto += Number(l.monto ?? 0);
    conteoPorOficina.set(l.oficina_id, cur);
  }

  const now = Date.now();
  return (oficinas ?? []).map((o) => {
    const ag = agentesPorOficina.get(o.id) ?? { count: 0, fechas: [] };
    const antiguedadPromedioAnios =
      ag.fechas.length === 0
        ? 0
        : ag.fechas.reduce((s, f) => s + (now - new Date(f).getTime()) / (365.25 * 24 * 3600 * 1000), 0) / ag.fechas.length;
    const conteo = conteoPorOficina.get(o.id) ?? { auto: 0, confirmado: 0, monto: 0 };
    const excep = excepcionesPorOficina.get(o.id) ?? 0;
    const denom = conteo.auto + conteo.confirmado + excep;
    return {
      ...o,
      gerenteNombre: (o as unknown as { gerente?: { nombre: string } }).gerente?.nombre ?? "Sin encargado",
      numAgentes: ag.count,
      polizasActivas: polizasPorOficina.get(o.id) ?? 0,
      comisionMes: conteo.monto,
      excepcionesAbiertas: excep,
      antiguedadPromedioAnios,
      pctConciliadoAuto: denom === 0 ? 0 : (conteo.auto / denom) * 100,
    };
  });
}

export interface NuevaOficina {
  nombre: string;
  codigo: string | null;
  direccion: string;
  gerente_agente_id: string | null;
  pct_override: number;
}

export async function crearOficina(input: NuevaOficina) {
  const { error } = await supabase.from("oficinas").insert(input);
  if (error) throw error;
}

export async function actualizarOficina(id: string, cambios: Partial<NuevaOficina>) {
  const { error } = await supabase.from("oficinas").update(cambios).eq("id", id);
  if (error) throw error;
}

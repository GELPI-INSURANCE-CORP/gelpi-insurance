import { supabase } from "@/lib/supabase";
import { fetchTodasLineasComision, listOficinasSimple } from "@/lib/queries/agentes";

// Estados que cuentan como comisión ya conciliada (la que sabemos de quién es). Las líneas en
// excepción NO se cuentan: hasta que no se resuelven en Conciliación no hay dueño confirmado,
// y pagarlas sería adivinar.
const ESTADOS_CONCILIADOS = ["conciliado_auto", "conciliado_confirmado", "cuenta_casa"];

export interface FilaLiquidacion {
  agenteId: string;
  nombre: string;
  oficinaNombre: string;
  activo: boolean;
  pct: number;
  comisionRecibida: number;
  aPagar: number;
}

export interface Liquidacion {
  periodo: string;
  filas: FilaLiquidacion[];
  totalRecibido: number;
  totalAPagar: number;
  sinAsignar: number;
  // Un período cerrado muestra la foto que se guardó al cerrarlo, no un cálculo en vivo: cambiar
  // el % de un agente después no puede mover lo que ya se pagó.
  cerrada: boolean;
  cerradaEn: string | null;
}

export function rangoDePeriodo(periodo: string): { desde: string; hasta: string } {
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimoDia = new Date(anio, mes, 0).getDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimoDia).padStart(2, "0")}` };
}

export function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getLiquidacionEnVivo(periodo: string): Promise<Liquidacion> {
  const { desde, hasta } = rangoDePeriodo(periodo);

  const [{ data: agentes, error }, oficinas, lineas] = await Promise.all([
    supabase.from("agentes").select("id, nombre, oficina_id, activo, pct_split_default").order("nombre"),
    listOficinasSimple(),
    fetchTodasLineasComision(desde, hasta, ESTADOS_CONCILIADOS),
  ]);
  if (error) throw error;

  const oficinaPorId = new Map((oficinas ?? []).map((o) => [o.id, o.nombre]));
  const comisionPorAgente = new Map<string, number>();
  let sinAsignar = 0;
  for (const l of lineas) {
    const monto = Number(l.monto ?? 0);
    if (!l.agente_id) {
      sinAsignar += monto;
      continue;
    }
    comisionPorAgente.set(l.agente_id, (comisionPorAgente.get(l.agente_id) ?? 0) + monto);
  }

  const filas: FilaLiquidacion[] = (agentes ?? []).map((a) => {
    const comisionRecibida = comisionPorAgente.get(a.id) ?? 0;
    const pct = Number(a.pct_split_default ?? 0);
    return {
      agenteId: a.id,
      nombre: a.nombre,
      oficinaNombre: (a.oficina_id && oficinaPorId.get(a.oficina_id)) || "Sin oficina",
      activo: a.activo,
      pct,
      comisionRecibida,
      aPagar: (comisionRecibida * pct) / 100,
    };
  });

  return {
    periodo,
    filas,
    totalRecibido: filas.reduce((s, f) => s + f.comisionRecibida, 0),
    totalAPagar: filas.reduce((s, f) => s + f.aPagar, 0),
    sinAsignar,
    cerrada: false,
    cerradaEn: null,
  };
}

export async function getLiquidacion(periodo: string): Promise<Liquidacion> {
  const { data: cerrada, error } = await supabase
    .from("liquidaciones")
    .select("id, cerrada_en, total_recibido, total_a_pagar, liquidacion_agente(agente_id, agente_nombre, comision_recibida, pct, a_pagar)")
    .eq("periodo", periodo)
    .maybeSingle();
  // Si la migración de liquidaciones todavía no corrió, la tabla no existe. Eso no es motivo para
  // dejar al usuario sin la pantalla: se cae al cálculo en vivo, que es exactamente como funcionaba
  // antes. Cualquier otro error sí se levanta.
  if (error) {
    const tablaFalta = error.code === "42P01" || /liquidaciones/.test(error.message ?? "");
    if (!tablaFalta) throw error;
    return getLiquidacionEnVivo(periodo);
  }
  if (!cerrada) return getLiquidacionEnVivo(periodo);

  // Para la oficina y el estado activo se mira el agente de hoy: son datos de presentación y no
  // cambian un centavo de lo que se pagó. Los montos y el % salen todos de la foto.
  const [oficinas, { data: agentesHoy }] = await Promise.all([
    listOficinasSimple(),
    supabase.from("agentes").select("id, oficina_id, activo"),
  ]);
  const oficinaPorId = new Map((oficinas ?? []).map((o) => [o.id, o.nombre]));
  const agentePorId = new Map((agentesHoy ?? []).map((a) => [a.id, a]));

  const detalle = (cerrada.liquidacion_agente ?? []) as {
    agente_id: string;
    agente_nombre: string;
    comision_recibida: number;
    pct: number;
    a_pagar: number;
  }[];

  const filas: FilaLiquidacion[] = detalle
    .map((d) => {
      const hoy = agentePorId.get(d.agente_id);
      return {
        agenteId: d.agente_id,
        nombre: d.agente_nombre,
        oficinaNombre: (hoy?.oficina_id && oficinaPorId.get(hoy.oficina_id)) || "Sin oficina",
        activo: hoy?.activo ?? false,
        pct: Number(d.pct ?? 0),
        comisionRecibida: Number(d.comision_recibida ?? 0),
        aPagar: Number(d.a_pagar ?? 0),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    periodo,
    filas,
    totalRecibido: Number(cerrada.total_recibido ?? 0),
    totalAPagar: Number(cerrada.total_a_pagar ?? 0),
    sinAsignar: 0,
    cerrada: true,
    cerradaEn: cerrada.cerrada_en as string,
  };
}

export async function actualizarPctSplit(agenteId: string, pct: number): Promise<void> {
  const { error } = await supabase.from("agentes").update({ pct_split_default: pct }).eq("id", agenteId);
  if (error) throw error;
}

// Congela el mes: guarda cuánto entró por cada agente, con qué % y cuánto se le paga. A partir de
// acá, tocar el % de un agente no mueve este mes.
export async function cerrarLiquidacion(periodo: string): Promise<void> {
  const viva = await getLiquidacionEnVivo(periodo);
  const conMovimiento = viva.filas.filter((f) => f.comisionRecibida !== 0);
  if (conMovimiento.length === 0) {
    throw new Error("No hay comisiones conciliadas en este período, no hay nada que cerrar.");
  }

  const { data: usuario } = await supabase.auth.getUser();
  const { data: cabecera, error: errCab } = await supabase
    .from("liquidaciones")
    .insert({
      periodo,
      total_recibido: viva.totalRecibido,
      total_a_pagar: viva.totalAPagar,
      cerrada_por: usuario?.user?.id ?? null,
    })
    .select("id")
    .single();
  if (errCab) {
    // El período es unique: si ya estaba cerrado, decirlo en criollo en vez de mostrar el error de
    // Postgres, porque el caso normal es haberle dado dos veces al botón.
    if (errCab.code === "23505") throw new Error("Este período ya está cerrado. Reabrilo si necesitás recalcularlo.");
    throw errCab;
  }

  const { error: errDet } = await supabase.from("liquidacion_agente").insert(
    conMovimiento.map((f) => ({
      liquidacion_id: cabecera.id,
      agente_id: f.agenteId,
      agente_nombre: f.nombre,
      comision_recibida: f.comisionRecibida,
      pct: f.pct,
      a_pagar: f.aPagar,
    }))
  );
  if (errDet) {
    // Sin detalle, la cabecera sola es una liquidación cerrada y vacía: peor que no haberla
    // cerrado, porque tapa el cálculo en vivo. Se deshace.
    await supabase.from("liquidaciones").delete().eq("id", cabecera.id);
    throw errDet;
  }
}

export async function reabrirLiquidacion(periodo: string): Promise<void> {
  const { error } = await supabase.from("liquidaciones").delete().eq("periodo", periodo);
  if (error) throw error;
}

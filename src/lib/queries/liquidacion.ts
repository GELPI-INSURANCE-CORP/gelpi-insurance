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

export async function getLiquidacion(periodo: string): Promise<Liquidacion> {
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
  };
}

export async function actualizarPctSplit(agenteId: string, pct: number): Promise<void> {
  const { error } = await supabase.from("agentes").update({ pct_split_default: pct }).eq("id", agenteId);
  if (error) throw error;
}

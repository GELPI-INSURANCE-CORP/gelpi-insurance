import { supabase } from "@/lib/supabase";

// El cruce entre lo que el reporte de ventas dice que se vendió y lo que las compañías pagaron.
//
// Arturo, después de mandar un export de ventas de QQ para contrastar un mes: *"que se haga el
// cruce por lo que subo de QQ: qué falta con relación a QQ y qué falta con relación a los
// statements, y que hagan cruces viceversa."*
//
// Ver la migración 20261003000001 para por qué hace falta y cómo empareja los nombres.

export type EstadoCruce = "solo_venta" | "en_ambos" | "solo_statement";

export interface FilaCruce {
  estado: EstadoCruce;
  cliente: string;
  agente: string;
  oficina: string;
  ramo: string;
  companias: string;
  fechaVenta: string | null;
  primaVendida: number;
  primaCobrada: number;
  comision: number;
  polizas: string;
}

function rangoDelMes(periodo: string): { desde: string; hasta: string } {
  const [anio, mes] = periodo.split("-").map(Number);
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: iso(desde), hasta: iso(hasta) };
}

export async function getCruce(periodo: string): Promise<FilaCruce[]> {
  const { desde, hasta } = rangoDelMes(periodo);
  const { data, error } = await supabase.rpc("cruce_ventas_statements", {
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    estado: (d.estado as EstadoCruce) ?? "en_ambos",
    cliente: String(d.cliente ?? "—"),
    agente: String(d.agente ?? "—"),
    oficina: String(d.oficina ?? "—"),
    ramo: String(d.ramo ?? "—"),
    companias: String(d.companias ?? "—"),
    fechaVenta: (d.fecha_venta as string) ?? null,
    primaVendida: Number(d.prima_vendida ?? 0),
    primaCobrada: Number(d.prima_cobrada ?? 0),
    comision: Number(d.comision ?? 0),
    polizas: String(d.polizas ?? "-"),
  }));
}

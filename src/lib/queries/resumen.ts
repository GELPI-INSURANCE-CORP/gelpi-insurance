import { supabase } from "@/lib/supabase";

export interface ResumenMontoN {
  monto: number;
  n: number;
}

export interface ResumenPorOficina {
  oficina: string;
  oficina_id: string;
  comision: number;
  excepciones: number;
  antiguedad: number;
}

export interface ResumenPorAseguradora {
  aseguradora: string;
  comision: number;
}

export interface ResumenKpis {
  conciliado: number;
  sin_identificar: ResumenMontoN;
  mismatch: ResumenMontoN;
  duplicados: ResumenMontoN;
  conflictos: number;
  total_disputa: ResumenMontoN;
  por_oficina: ResumenPorOficina[];
  por_aseguradora: ResumenPorAseguradora[];
  agentes_con_comision: number;
}

export type TipoExcepcion = "mismatch" | "sin_identificar" | "duplicado" | "conflicto_venta";

export interface ExcepcionRow {
  id: string;
  tipo: TipoExcepcion;
  estado: string;
  numero_poliza_crudo: string | null;
  nombre_asegurado_crudo: string | null;
  productor_crudo: string | null;
  monto: number | null;
  fecha_statement: string | null;
  score: number | null;
  agente_sugerido: string | null;
  agente_sugerido_id: string | null;
  oficina_sugerida: string | null;
  oficina_sugerida_id: string | null;
  aseguradora: string | null;
  antiguedad_dias: number;
  atrasada: boolean;
  explicacion: string | null;
  created_at: string;
  // Un cargo de MVR sin dueño. Su importe NO viaja en `monto` a propósito: esa columna la suman
  // resumen_kpis y las pantallas de agentes, oficinas y clientes para decir "esto es lo que está
  // en disputa", y eso es comisión que le DEBEN a la agencia. Un MVR es plata que DEBE. Sumarlas
  // daría un número que no significa nada, así que el cargo llega con monto en null y su importe
  // en monto_costo. Ver 20261009000002.
  linea_costo_id?: string | null;
  monto_costo?: number | null;
  costo_conductor?: string | null;
  costo_es_comercial?: boolean | null;
}

/** Rango [primer día, último día] del mes que contiene `d` (o el mes actual si se omite), en formato YYYY-MM-DD. */
export function rangoDelMes(d: Date = new Date()): { desde: string; hasta: string } {
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

export interface ProduccionMes {
  mes: string;
  polizas: number;
  prima: number;
}

// Cuántas pólizas nuevas entraron cada mes. Se cuenta por fecha de vigencia — cuándo empezó a
// cubrir — y no por cuándo se cargó el archivo: una póliza de agosto es de agosto aunque el Book se
// haya subido en septiembre, y contarla por la carga haría que un mes sin subir figure sin ventas.
export async function getProduccionPorMes(desde: string, hasta: string): Promise<ProduccionMes[]> {
  const { data, error } = await supabase.rpc("polizas_por_mes", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return (data ?? []) as ProduccionMes[];
}

export interface AgenteRanking {
  agente_id: string;
  agente: string;
  oficina: string | null;
  lineas: number;
  comision: number;
}

// Quién produjo y cuánto, ordenado por plata y no por cantidad de líneas: un agente con 159 líneas
// chicas trajo menos que uno con 121 grandes, y lo que se reparte es plata. La cuenta de la casa
// queda afuera del ranking — ahí van los MVR y los ajustes, así que su total es negativo y el
// último puesto sería siempre el dueño en rojo.
export async function getRankingAgentes(
  desde: string,
  hasta: string,
  limite = 10
): Promise<AgenteRanking[]> {
  const { data, error } = await supabase.rpc("ranking_agentes", {
    p_desde: desde,
    p_hasta: hasta,
    p_limite: limite,
  });
  if (error) throw error;
  return (data ?? []) as AgenteRanking[];
}

export interface OficinaRanking {
  oficina_id: string | null;
  oficina: string;
  polizas: number;
  prima: number;
  comision: number;
}

// Reemplaza al ranking de agentes: por oficina (agentes.oficina_id) y por prima de negocio nuevo,
// no por comisión. Es lo que pidió Arturo: "si la póliza le costó 3.000 dólares, al 10% yo gano
// 300. Lo que nosotros estamos mirando son los 3.000 dólares del cliente, quién vendió esos
// 3.000" — y solo cuenta el new business, sin renovaciones. Las líneas sin clasificar (no se sabe
// si son nuevas) quedan afuera a propósito; getPrimaSinClasificar dice cuánta plata es esa.
export async function getRankingOficinas(
  desde: string,
  hasta: string,
  limite = 10
): Promise<OficinaRanking[]> {
  const { data, error } = await supabase.rpc("ranking_oficinas", {
    p_desde: desde,
    p_hasta: hasta,
    p_limite: limite,
  });
  if (error) throw error;
  return (data ?? []) as OficinaRanking[];
}

// Cuánta prima del período no se pudo clasificar como negocio nuevo ni como renovación (ver
// v_lineas_negocio). Esa plata no entra en getRankingOficinas, así que el dashboard la muestra
// aparte para que el número de arriba no parezca completo cuando no lo está.
export async function getPrimaSinClasificar(desde: string, hasta: string): Promise<number> {
  const { data, error } = await supabase.rpc("prima_sin_clasificar", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function getResumenKpis(desde: string, hasta: string): Promise<ResumenKpis> {
  const { data, error } = await supabase.rpc("resumen_kpis", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return data as ResumenKpis;
}

export async function getExcepcionesTop(limit = 5): Promise<ExcepcionRow[]> {
  const { data, error } = await supabase
    .from("v_excepciones")
    .select(
      "id, tipo, estado, numero_poliza_crudo, nombre_asegurado_crudo, productor_crudo, monto, fecha_statement, score, agente_sugerido, agente_sugerido_id, oficina_sugerida, oficina_sugerida_id, aseguradora, antiguedad_dias, atrasada, explicacion, created_at"
    )
    .eq("estado", "pendiente")
    .order("atrasada", { ascending: false })
    .order("antiguedad_dias", { ascending: false })
    .order("monto", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ExcepcionRow[];
}

export async function getExcepcionesPendientesCount(): Promise<number> {
  const { count, error } = await supabase
    .from("v_excepciones")
    .select("id", { count: "exact", head: true })
    .eq("estado", "pendiente");
  if (error) throw error;
  return count ?? 0;
}

export interface BookResumen {
  primaPorOficina: Map<string, number>;
  premiumActivo: number;
  polizasActivas: number;
  premiumCancelado: number;
  polizasCanceladas: number;
  // Cuántas de las activas traen prima cargada. Un total de prima sumado sobre 50 de 2.331
  // pólizas parece un dato y no lo es: hay que poder decir sobre cuántas está hecho.
  activasConPrima: number;
}

// Datos del Active Business Book en sí (no de comisiones): cuánta prima hay vigente y
// vendida hoy, cuántas pólizas activas y cuántas canceladas, total y por oficina.
// v_polizas.prima/estado, sin importar en qué mes se cargó ni si ya se conciliaron
// sus comisiones.
export async function getBookResumen(): Promise<BookResumen> {
  const primaPorOficina = new Map<string, number>();
  let premiumActivo = 0;
  let polizasActivas = 0;
  let premiumCancelado = 0;
  let polizasCanceladas = 0;
  let activasConPrima = 0;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("v_polizas")
      .select("oficina_id, prima, estado")
      .in("estado", ["activa", "cancelada"])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const p of page) {
      const prima = Number(p.prima ?? 0);
      if (p.estado === "activa") {
        premiumActivo += prima;
        polizasActivas += 1;
        if (p.prima != null) activasConPrima += 1;
        if (p.oficina_id) primaPorOficina.set(p.oficina_id, (primaPorOficina.get(p.oficina_id) ?? 0) + prima);
      } else if (p.estado === "cancelada") {
        premiumCancelado += prima;
        polizasCanceladas += 1;
      }
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { primaPorOficina, premiumActivo, polizasActivas, premiumCancelado, polizasCanceladas, activasConPrima };
}

// =========================================================
// Datos para las gráficas del dashboard
// =========================================================

export interface PuntoSerie {
  mes: string;
  polizas: number;
  prima: number;
}

// Cómo venía el Book mes a mes, reconstruido desde las fechas de vigencia y vencimiento de cada
// póliza (ver 20260926000013). Es la serie real: las tarjetas del dashboard dibujan esto y no
// una curva de adorno.
//
// Ojo con el último punto: las pólizas sin fecha de vigencia no se pueden ubicar en el tiempo y
// quedan fuera de la serie, así que puede no coincidir exactamente con el total de hoy. La línea
// muestra la forma de la curva, no el total — ese lo da el número grande de la tarjeta.
export async function getSerieBook(meses = 12): Promise<PuntoSerie[]> {
  const { data, error } = await supabase.rpc("serie_mensual_book", { p_meses: meses });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    mes: String(d.mes),
    polizas: Number(d.polizas ?? 0),
    prima: Number(d.prima ?? 0),
  }));
}

export interface RamoPrima {
  ramo: string;
  polizas: number;
  prima: number;
}

export async function getPrimaPorRamo(): Promise<RamoPrima[]> {
  const { data, error } = await supabase.rpc("prima_por_ramo");
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    ramo: String(d.ramo ?? "—"),
    polizas: Number(d.polizas ?? 0),
    prima: Number(d.prima ?? 0),
  }));
}

// Cuánto cambió el último punto contra el anterior. Devuelve null cuando no hay con qué comparar
// o cuando el punto anterior es cero: un "subió infinito" no le dice nada a nadie.
export function variacion(serie: number[]): number | null {
  if (serie.length < 2) return null;
  const antes = serie[serie.length - 2];
  const ahora = serie[serie.length - 1];
  if (!antes) return null;
  return ((ahora - antes) / Math.abs(antes)) * 100;
}

// =========================================================
// El royalty de la franquicia
// =========================================================
// Cada oficina le paga a la casa matriz un porcentaje de la COMISIÓN que genera. Ojo que no es
// la misma cuenta que el pago a los agentes: a ellos se les paga sobre la PRIMA y solo del
// negocio nuevo; el royalty va sobre la comisión bruta, nueva y renovación. Ver
// 20260927000001.

export interface RoyaltyOficina {
  oficinaId: string;
  oficina: string;
  esCorporativa: boolean;
  comisionGenerada: number;
  // Nulo = todavía no se le definió el porcentaje a esa oficina. No es lo mismo que 0, y la
  // pantalla los muestra distinto: uno es "falta configurarlo" y el otro "no paga".
  pctRoyalty: number | null;
  // Los ajustes marcados como que llevan royalty, ya sumados. Va aparte de la comisión para que
  // el estado de cuenta pueda mostrar la cuenta completa y no solo el resultado.
  ajustesEnBase: number;
  royalty: number;
}

export async function getRoyaltyPorOficina(desde: string, hasta: string): Promise<RoyaltyOficina[]> {
  const { data, error } = await supabase.rpc("royalty_por_oficina", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    oficinaId: String(d.oficina_id),
    oficina: String(d.oficina ?? "—"),
    esCorporativa: Boolean(d.es_corporativa),
    comisionGenerada: Number(d.comision_generada ?? 0),
    ajustesEnBase: Number(d.ajustes_en_base ?? 0),
    pctRoyalty: d.pct_royalty == null ? null : Number(d.pct_royalty),
    royalty: Number(d.royalty ?? 0),
  }));
}

// Del 1 de enero de ese año hasta el final del mes que se está mirando. No hasta hoy: si se mira
// un mes pasado, el acumulado tiene que llegar hasta ese mes y no incluir lo que vino después,
// porque si no el "year to date" de marzo mostraría plata de septiembre.
export function rangoYtd(mes: Date): { desde: string; hasta: string } {
  const anio = mes.getFullYear();
  const finDeMes = new Date(anio, mes.getMonth() + 1, 0);
  const dd = String(finDeMes.getDate()).padStart(2, "0");
  const mm = String(mes.getMonth() + 1).padStart(2, "0");
  return { desde: `${anio}-01-01`, hasta: `${anio}-${mm}-${dd}` };
}

export async function actualizarPctRoyalty(oficinaId: string, pct: number | null): Promise<void> {
  const { error } = await supabase.from("oficinas").update({ pct_royalty: pct }).eq("id", oficinaId);
  if (error) throw error;
}

// =========================================================
// El estado de cuenta que se le manda a cada oficina
// =========================================================
// Un documento por oficina y por mes: lo que generó con cada compañía, el royalty que se le
// cobra, y lo que le queda. Es lo que Arturo les envía; la oficina después le paga a su gente
// como quiera — eso ya no es cuenta de la casa matriz.

export interface LineaCompania {
  compania: string;
  polizas: number;
  prima: number;
  comision: number;
  // Lo mismo en el mes anterior, para ver si subió o bajó. Nulo cuando esa compañía no aparece
  // en el mes anterior: eso es "no había", que no es lo mismo que "dio cero".
  comisionMesAnterior: number | null;
}

// =========================================================
// Ajustes manuales del estado de cuenta
// =========================================================
// Plata que el statement de la compañía no explica y que igual hay que pasarle a la oficina:
// fees de la agencia, devoluciones, acuerdos. El caso que lo destapó fueron los tres cargos
// "Fee-UWReports" de Kemper de septiembre (-$397.80), que no traen oficina y por eso no se
// pueden repartir solos. Ver 20261001000001.
//
// El monto va FIRMADO: negativo descuenta de lo que se le manda a la oficina, positivo suma.
// Un solo campo con signo en vez de un "tipo" más un monto siempre positivo, porque con dos
// campos siempre llega el día en que alguien guarda "cargo" con monto negativo y se resta dos
// veces.

export interface AjusteOficina {
  id: string;
  oficinaId: string;
  periodo: string;
  concepto: string;
  monto: number;
  // Si cambia la base sobre la que se calcula el royalty, o si se descuenta después. Con un fee
  // de -$397.80 en una oficina al 12% son $47.74 de diferencia, así que no tiene default.
  aplicaRoyalty: boolean;
  nota: string | null;
}

export async function getAjustesOficina(oficinaId: string, periodo: string): Promise<AjusteOficina[]> {
  const { data, error } = await supabase
    .from("ajustes_oficina")
    .select("id, oficina_id, periodo, concepto, monto, aplica_royalty, nota")
    .eq("oficina_id", oficinaId)
    .eq("periodo", periodo)
    .order("creado_en", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    id: String(d.id),
    oficinaId: String(d.oficina_id),
    periodo: String(d.periodo),
    concepto: String(d.concepto ?? ""),
    monto: Number(d.monto ?? 0),
    aplicaRoyalty: Boolean(d.aplica_royalty),
    nota: (d.nota as string) ?? null,
  }));
}

export async function crearAjusteOficina(a: {
  oficinaId: string;
  periodo: string;
  concepto: string;
  monto: number;
  aplicaRoyalty: boolean;
  nota?: string | null;
}): Promise<void> {
  const { data: usuario } = await supabase.auth.getUser();
  const { error } = await supabase.from("ajustes_oficina").insert({
    oficina_id: a.oficinaId,
    periodo: a.periodo,
    concepto: a.concepto.trim(),
    monto: a.monto,
    aplica_royalty: a.aplicaRoyalty,
    nota: a.nota?.trim() || null,
    creado_por: usuario?.user?.id ?? null,
  });
  if (error) throw error;
}

export async function borrarAjusteOficina(id: string): Promise<void> {
  const { error } = await supabase.from("ajustes_oficina").delete().eq("id", id);
  if (error) throw error;
}

// Un renglón de MVR por compañía: "MVR PROGRESSIVE $601.00", igual que en la planilla con la
// que Arturo le liquida a cada oficina. Sale de lineas_costo, no de ajustes_oficina: estos se
// calculan del archivo que manda la compañía, no se teclean.
export interface LineaCostoOficina {
  compania: string;
  cargos: number;     // renglones = conductores
  conCargo: number;   // los que de verdad cobraron (muchos MVR vienen en $0)
  casos: number;      // asegurados distintos
  monto: number;
}

export interface EstadoCuentaOficina {
  oficinaId: string;
  oficina: string;
  esCorporativa: boolean;
  pctRoyalty: number | null;
  companias: LineaCompania[];
  totalPolizas: number;
  totalPrima: number;
  comisionGenerada: number;
  ajustes: AjusteOficina[];
  costos: LineaCostoOficina[];
  totalCostos: number;
  royalty: number;
  neto: number;
  comisionMesAnterior: number;
}

function rangoDeMes(mes: Date): { desde: string; hasta: string } {
  const a = mes.getFullYear();
  const m = mes.getMonth();
  const ultimo = new Date(a, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

export async function getEstadoCuentaOficina(
  oficinaId: string,
  mes: Date
): Promise<EstadoCuentaOficina | null> {
  const actual = rangoDeMes(mes);
  const anterior = rangoDeMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1));

  // El período de los ajustes se arma del mes pedido, en el mismo formato canónico YYYY-MM en
  // que se guardan los períodos de los statements (ver 20260927000005).
  const periodoTxt = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, "0")}`;

  const [resumen, detalle, detalleAnterior, ajustes, costos] = await Promise.all([
    getRoyaltyPorOficina(actual.desde, actual.hasta),
    supabase.rpc("royalty_detalle_por_compania", { p_desde: actual.desde, p_hasta: actual.hasta }),
    supabase.rpc("royalty_detalle_por_compania", { p_desde: anterior.desde, p_hasta: anterior.hasta }),
    getAjustesOficina(oficinaId, periodoTxt),
    supabase.rpc("costos_por_oficina", { p_desde: actual.desde, p_hasta: actual.hasta }),
  ]);
  if (detalle.error) throw detalle.error;
  if (detalleAnterior.error) throw detalleAnterior.error;
  if (costos.error) throw costos.error;

  const ofi = resumen.find((o) => o.oficinaId === oficinaId);
  if (!ofi) return null;

  type Fila = Record<string, unknown>;
  const mias = ((detalle.data ?? []) as Fila[]).filter((d) => String(d.oficina_id) === oficinaId);
  const antes = new Map(
    ((detalleAnterior.data ?? []) as Fila[])
      .filter((d) => String(d.oficina_id) === oficinaId)
      .map((d) => [String(d.compania), Number(d.comision ?? 0)])
  );

  const companias: LineaCompania[] = mias.map((d) => ({
    compania: String(d.compania ?? "—"),
    polizas: Number(d.polizas ?? 0),
    prima: Number(d.prima ?? 0),
    comision: Number(d.comision ?? 0),
    comisionMesAnterior: antes.has(String(d.compania)) ? antes.get(String(d.compania))! : null,
  }));

  // Los MVR de esta oficina, un renglón por compañía. Vienen con monto positivo (es lo que la
  // compañía cobró) y se restan al final, nunca de la base del royalty: Arturo cobra el royalty
  // sobre la ganancia bruta y los gastos no lo tocan.
  const misCostos: LineaCostoOficina[] = ((costos.data ?? []) as Fila[])
    .filter((d) => String(d.oficina_id) === oficinaId)
    .map((d) => ({
      compania: String(d.compania ?? "—"),
      cargos: Number(d.cargos ?? 0),
      conCargo: Number(d.con_cargo ?? 0),
      casos: Number(d.casos ?? 0),
      monto: Number(d.monto ?? 0),
    }))
    .filter((c) => c.monto !== 0);
  const totalCostos = misCostos.reduce((s, c) => s + c.monto, 0);

  return {
    oficinaId,
    oficina: ofi.oficina,
    esCorporativa: ofi.esCorporativa,
    pctRoyalty: ofi.pctRoyalty,
    companias,
    totalPolizas: companias.reduce((s, c) => s + c.polizas, 0),
    totalPrima: companias.reduce((s, c) => s + c.prima, 0),
    comisionGenerada: ofi.comisionGenerada,
    ajustes,
    costos: misCostos,
    totalCostos,
    royalty: ofi.royalty,
    // Lo que de verdad le entra a su cuenta. Es el número que la oficina va a mirar primero.
    //
    // Entran TODOS los ajustes, lleven royalty o no: la diferencia entre unos y otros no es si
    // se descuentan sino cuándo. Los que llevan royalty ya movieron la base (y por eso el
    // royalty que viene de la base ya salió más chico); los que no, se descuentan acá al final.
    // En los dos casos la oficina recibe lo mismo de menos.
    //
    // Los MVR se restan acá al final y JAMÁS de la base del royalty. Es la regla de Arturo:
    // "si ellos ganan $10,000, me tienen que pagar el royalty de los $10,000, no importa si
    // tuvieron $50,000 o $1,000 en MVR". Su planilla de Miami Lakes lo confirma al centavo:
    // 26,911.59 bruto → royalty 12% = 3,229.39 → 23,682.20 → menos 1,833.18 de gastos →
    // 21,849.02. El royalty sale del bruto, siempre.
    neto:
      ofi.comisionGenerada + ajustes.reduce((t, x) => t + x.monto, 0) - ofi.royalty - totalCostos,
    comisionMesAnterior: [...antes.values()].reduce((s, v) => s + v, 0),
  };
}

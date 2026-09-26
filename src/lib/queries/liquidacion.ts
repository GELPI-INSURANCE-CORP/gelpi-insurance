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
  // A los agentes se les paga un porcentaje SOLO del negocio nuevo; las renovaciones no se pagan.
  // Las tres cifras van por separado y no solo la que se paga, porque un número suelto no deja
  // ver de dónde sale. `sinClasificar` es la importante de mirar: si tiene plata, hay líneas que
  // el sistema no pudo separar entre nuevo y renovación, y conviene revisarlas antes de pagar.
  comisionNuevo: number;
  comisionRenovacion: number;
  comisionSinClasificar: number;
  // LA BASE DE PAGO BUENA: el premium que vendió el agente, no la comisión que cobró la agencia.
  // Con la base vieja, lo que ganaba el agente dependía de cuánto le paga la compañía a la
  // agencia — vender $100.000 de una compañía al 15% pagaba más que vender $100.000 de una al
  // 10%, por el mismo trabajo. Ver 20260926000012.
  primaNuevo: number;
  primaRenovacion: number;
  primaSinClasificar: number;
  // Nulo = todavía no se le definió el porcentaje a este agente. No es lo mismo que 0: uno es
  // "no cobra nada" y el otro es "falta configurarlo", y la pantalla los muestra distinto.
  pctPrima: number | null;
  aPagarPrima: number;
}

export interface Liquidacion {
  periodo: string;
  filas: FilaLiquidacion[];
  totalRecibido: number;
  totalAPagar: number;
  totalPrimaNuevo: number;
  totalAPagarPrima: number;
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

type AgenteDeLiquidacion = {
  id: string;
  nombre: string;
  oficina_id: string | null;
  activo: boolean;
  pct_split_default: number | null;
  pct_sobre_prima?: number | null;
};

// El frontend se despliega con un push y las migraciones se corren a mano, así que entre las dos
// cosas hay una ventana en la que el código nuevo le pide a la base una columna que todavía no
// existe. Si eso tumbara la pantalla entera, la liquidación quedaría muerta hasta que alguien
// corriera el SQL. Se reintenta sin la columna nueva: se ve todo lo de antes y el pago por
// premium sale en cero, que es lo honesto mientras el dato no exista.
// Mismo criterio que ya se usa más abajo con la tabla `liquidaciones`.
async function traerAgentes(): Promise<AgenteDeLiquidacion[]> {
  const conPrima = await supabase
    .from("agentes")
    .select("id, nombre, oficina_id, activo, pct_split_default, pct_sobre_prima")
    .order("nombre");
  if (!conPrima.error) return (conPrima.data ?? []) as AgenteDeLiquidacion[];

  const faltaLaColumna =
    conPrima.error.code === "42703" || /pct_sobre_prima/.test(conPrima.error.message ?? "");
  if (!faltaLaColumna) throw conPrima.error;

  const sinPrima = await supabase
    .from("agentes")
    .select("id, nombre, oficina_id, activo, pct_split_default")
    .order("nombre");
  if (sinPrima.error) throw sinPrima.error;
  return (sinPrima.data ?? []) as AgenteDeLiquidacion[];
}

async function getLiquidacionEnVivo(periodo: string): Promise<Liquidacion> {
  const { desde, hasta } = rangoDePeriodo(periodo);

  // El corte entre negocio nuevo y renovación lo hace la base, no esta pantalla: sale de lo que
  // dice cada archivo (el "Renewal Count" de Progressive, la sección de GEICO, el código de
  // transacción del resto) y no de una suposición del navegador. Ver
  // supabase/migrations/20260926000005_negocio_nuevo_para_liquidar.sql.
  const [agentesRes, { data: reparto, error: errReparto }, oficinas, lineas] = await Promise.all([
    traerAgentes(),
    supabase.rpc("liquidacion_negocio_nuevo", { p_desde: desde, p_hasta: hasta }),
    listOficinasSimple(),
    fetchTodasLineasComision(desde, hasta, ESTADOS_CONCILIADOS),
  ]);
  const agentes = agentesRes;
  if (errReparto) throw errReparto;

  const oficinaPorId = new Map((oficinas ?? []).map((o) => [o.id, o.nombre]));
  type Reparto = {
    agente_id: string;
    comision_nuevo: number;
    comision_renovacion: number;
    comision_sin_clasificar: number;
    prima_nuevo: number | null;
    prima_renovacion: number | null;
    prima_sin_clasificar: number | null;
    a_pagar_prima: number | null;
  };
  const repartoPorAgente = new Map<string, Reparto>(
    ((reparto ?? []) as Reparto[]).map((r) => [r.agente_id, r])
  );

  // Las líneas sin agente se siguen contando aparte: es plata del período que todavía no tiene
  // dueño, y tiene que verse aunque no entre en el pago de nadie.
  let sinAsignar = 0;
  for (const l of lineas) if (!l.agente_id) sinAsignar += Number(l.monto ?? 0);

  const filas: FilaLiquidacion[] = (agentes ?? []).map((a) => {
    const r = repartoPorAgente.get(a.id);
    const comisionNuevo = Number(r?.comision_nuevo ?? 0);
    const comisionRenovacion = Number(r?.comision_renovacion ?? 0);
    const comisionSinClasificar = Number(r?.comision_sin_clasificar ?? 0);
    const pct = Number(a.pct_split_default ?? 0);
    const primaNuevo = Number(r?.prima_nuevo ?? 0);
    // El % sobre prima puede no estar puesto todavía, y eso hay que poder distinguirlo de un 0.
    const pctPrima = a.pct_sobre_prima == null ? null : Number(a.pct_sobre_prima);
    return {
      agenteId: a.id,
      nombre: a.nombre,
      oficinaNombre: (a.oficina_id && oficinaPorId.get(a.oficina_id)) || "Sin oficina",
      activo: a.activo,
      pct,
      // Lo que entró a nombre del agente, todo junto. Se sigue mostrando para poder comparar
      // contra el statement, pero ya NO es la base del pago.
      comisionRecibida: comisionNuevo + comisionRenovacion + comisionSinClasificar,
      comisionNuevo,
      comisionRenovacion,
      comisionSinClasificar,
      // El porcentaje se aplica solo sobre el negocio nuevo.
      aPagar: (comisionNuevo * pct) / 100,
      primaNuevo,
      primaRenovacion: Number(r?.prima_renovacion ?? 0),
      primaSinClasificar: Number(r?.prima_sin_clasificar ?? 0),
      pctPrima,
      aPagarPrima: (primaNuevo * (pctPrima ?? 0)) / 100,
    };
  });

  return {
    periodo,
    filas,
    totalRecibido: filas.reduce((s, f) => s + f.comisionRecibida, 0),
    totalAPagar: filas.reduce((s, f) => s + f.aPagar, 0),
    totalPrimaNuevo: filas.reduce((s, f) => s + f.primaNuevo, 0),
    totalAPagarPrima: filas.reduce((s, f) => s + f.aPagarPrima, 0),
    sinAsignar,
    cerrada: false,
    cerradaEn: null,
  };
}

export async function getLiquidacion(periodo: string): Promise<Liquidacion> {
  // Igual que con los agentes: mientras la migración no esté corrida, las columnas del pago por
  // premium no existen todavía y pedirlas tumbaría la pantalla. Se reintenta sin ellas.
  const CAMPOS_BASE =
    "agente_id, agente_nombre, comision_recibida, comision_nuevo, comision_renovacion, comision_sin_clasificar, pct, a_pagar";
  const CABECERA = "id, cerrada_en, total_recibido, total_a_pagar, liquidacion_agente";
  let { data: cerrada, error } = await supabase
    .from("liquidaciones")
    .select(`${CABECERA}(${CAMPOS_BASE}, prima_nuevo, pct_prima, a_pagar_prima)`)
    .eq("periodo", periodo)
    .maybeSingle();
  if (error && (error.code === "42703" || /prima_nuevo|pct_prima|a_pagar_prima/.test(error.message ?? ""))) {
    ({ data: cerrada, error } = await supabase
      .from("liquidaciones")
      .select(`${CABECERA}(${CAMPOS_BASE})`)
      .eq("periodo", periodo)
      .maybeSingle());
  }
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
    comision_nuevo: number | null;
    comision_renovacion: number | null;
    comision_sin_clasificar: number | null;
    pct: number;
    a_pagar: number;
    prima_nuevo: number | null;
    pct_prima: number | null;
    a_pagar_prima: number | null;
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
        // Los meses cerrados antes del corte por tipo de negocio no guardaron el desglose: en
        // esos el pago se calculó sobre la comisión entera, así que esa ES la base que se usó, y
        // mostrarla como tal es más fiel que mostrar un cero.
        comisionNuevo: Number(d.comision_nuevo ?? 0) || Number(d.comision_recibida ?? 0),
        comisionRenovacion: Number(d.comision_renovacion ?? 0),
        comisionSinClasificar: Number(d.comision_sin_clasificar ?? 0),
        aPagar: Number(d.a_pagar ?? 0),
        // Los meses cerrados antes de que existiera el pago por premium no lo guardaron. Quedan
        // en cero y con el % nulo, que es la verdad: en esos meses el pago no salió de ahí.
        primaNuevo: Number(d.prima_nuevo ?? 0),
        primaRenovacion: 0,
        primaSinClasificar: 0,
        pctPrima: d.pct_prima == null ? null : Number(d.pct_prima),
        aPagarPrima: Number(d.a_pagar_prima ?? 0),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    periodo,
    filas,
    totalRecibido: Number(cerrada.total_recibido ?? 0),
    totalAPagar: Number(cerrada.total_a_pagar ?? 0),
    totalPrimaNuevo: filas.reduce((s, f) => s + f.primaNuevo, 0),
    totalAPagarPrima: filas.reduce((s, f) => s + f.aPagarPrima, 0),
    sinAsignar: 0,
    cerrada: true,
    cerradaEn: cerrada.cerrada_en as string,
  };
}

export async function actualizarPctSplit(agenteId: string, pct: number): Promise<void> {
  const { error } = await supabase.from("agentes").update({ pct_split_default: pct }).eq("id", agenteId);
  if (error) throw error;
}

// El porcentaje sobre el premium vendido, que es la base de pago buena. Se guarda null cuando se
// borra el campo, y no 0: "todavía no lo definí" y "a este no le pago nada" son cosas distintas
// y la pantalla las tiene que poder mostrar distinto.
export async function actualizarPctSobrePrima(agenteId: string, pct: number | null): Promise<void> {
  const { error } = await supabase.from("agentes").update({ pct_sobre_prima: pct }).eq("id", agenteId);
  if (error) throw error;
}

// Congela el mes: guarda cuánto entró por cada agente, con qué % y cuánto se le paga. A partir de
// acá, tocar el % de un agente no mueve este mes.
export async function cerrarLiquidacion(periodo: string): Promise<void> {
  const viva = await getLiquidacionEnVivo(periodo);
  // También cuenta el premium: un agente puede tener negocio nuevo cargado y todavía no tener
  // comisión conciliada, y dejarlo fuera del recibo borraría su venta del mes.
  const conMovimiento = viva.filas.filter((f) => f.comisionRecibida !== 0 || f.primaNuevo !== 0);
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
      comision_nuevo: f.comisionNuevo,
      comision_renovacion: f.comisionRenovacion,
      comision_sin_clasificar: f.comisionSinClasificar,
      pct: f.pct,
      a_pagar: f.aPagar,
      prima_nuevo: f.primaNuevo,
      pct_prima: f.pctPrima,
      a_pagar_prima: f.aPagarPrima,
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

// ---------------------------------------------------------------------------
// De dónde sale lo que se le paga a un agente
// ---------------------------------------------------------------------------
// En Liquidación se ve un número por agente y nada más. Para saber de dónde sale había que ir
// statement por statement filtrando por esa persona, y una venta del mismo mes puede estar
// repartida entre GEICO, Progressive y Kemper.
//
// Esto trae todas sus líneas de todas las compañías juntas. Usa el mismo criterio de mes que el
// total de arriba (ver detalle_liquidacion_agente en la migración): si usara otro, el detalle no
// sumaría el total y no se podría confiar en ninguno de los dos.

export interface LineaDeAgente {
  fecha: string | null;
  compania: string;
  numeroPoliza: string;
  cliente: string;
  tipo: string;
  negocioNuevo: boolean | null;
  prima: number | null;
  comision: number;
  statement: string | null;
}

export async function getDetalleAgente(
  agenteId: string,
  periodo: string
): Promise<LineaDeAgente[]> {
  const { desde, hasta } = rangoDePeriodo(periodo);
  const { data, error } = await supabase.rpc("detalle_liquidacion_agente", {
    p_agente: agenteId,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    fecha: (d.fecha as string) ?? null,
    compania: (d.compania as string) ?? "—",
    numeroPoliza: (d.numero_poliza as string) ?? "—",
    cliente: (d.cliente as string) ?? "—",
    tipo: (d.tipo as string) ?? "otro",
    negocioNuevo: (d.negocio_nuevo as boolean | null) ?? null,
    prima: d.prima == null ? null : Number(d.prima),
    comision: Number(d.comision ?? 0),
    statement: (d.statement as string) ?? null,
  }));
}

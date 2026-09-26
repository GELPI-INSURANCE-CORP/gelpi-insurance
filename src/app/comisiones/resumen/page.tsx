"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calendar,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Shield,
  ShieldAlert,
  Trophy,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card, CardHead, Chip, EmptyState } from "@/components/ui";
import type { Tone } from "@/components/ui/Badge";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ClaveTexto, Idioma } from "@/lib/i18n/textos";
import {
  type BookResumen,
  type ExcepcionRow,
  type OficinaRanking,
  type ProduccionMes,
  type ResumenKpis,
  getBookResumen,
  getExcepcionesPendientesCount,
  getExcepcionesTop,
  getPrimaSinClasificar,
  getProduccionPorMes,
  getRankingOficinas,
  getResumenKpis,
  getSerieBook,
  getPrimaPorRamo,
  variacion,
  rangoDelMes,
  type PuntoSerie,
  type RamoPrima,
} from "@/lib/queries/resumen";
import { Sparkline, Dona, Cascada, COLORES_GRAFICA, type PorcionDona } from "@/components/dashboard/charts";

const UMBRAL_ATRASADA_DIAS = 10;

// $3,639,752.46 no entra en el centro de una dona de 168px ni en una leyenda de siete renglones.
// Acá se abrevia; el número exacto sigue estando en la tarjeta de arriba, que es de donde hay
// que leerlo cuando importa el centavo.
function moneyCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// Copa para el 1er, 2do y 3er puesto de "Top-producing offices". Clases completas y a mano (no
// se arman con un template string) porque Tailwind purga lo que no encuentra escrito así en el
// código.
const COPA_POR_PUESTO: Record<0 | 1 | 2, string> = {
  0: "text-trophy-gold",
  1: "text-trophy-silver",
  2: "text-trophy-bronze",
};

function primerDiaDelMes(offsetMeses: number): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() - offsetMeses, 1);
}

// Firma de la funcion de traduccion, para pasarla como parametro a los helpers de aca abajo: son
// funciones de modulo (no componentes ni hooks) y no pueden llamar a useI18n() por su cuenta.
type TFunc = (clave: ClaveTexto, vars?: Record<string, string | number>) => string;

// El mes corto para el eje del grafico. Se arma en UTC: la fecha viene como "2026-08-01" y
// leida en la zona de Miami cae el 31 de julio a la noche, asi que agosto se rotularia Jul.
function etiquetaMesCorto(iso: string, idioma: Idioma): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString(idioma === "es" ? "es-US" : "en-US", { month: "short", timeZone: "UTC" });
}

function etiquetaMes(d: Date, idioma: Idioma): string {
  const s = d.toLocaleDateString(idioma === "es" ? "es-US" : "en-US", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function etiquetaTipoExcepcion(tipo: ExcepcionRow["tipo"], t: TFunc): { texto: string; tone: Tone; icon: React.ReactNode } {
  switch (tipo) {
    case "mismatch":
      return { texto: t("dash.excTypeMismatch"), tone: "warn", icon: <AlertCircle size={12} /> };
    case "sin_identificar":
      return { texto: t("dash.unidentified"), tone: "bad", icon: <AlertTriangle size={12} /> };
    case "duplicado":
      return { texto: t("dash.excTypeDuplicate"), tone: "silver", icon: <Copy size={12} /> };
    case "conflicto_venta":
      return { texto: t("dash.excTypeSaleConflict"), tone: "info", icon: <ShieldAlert size={12} /> };
    default:
      return { texto: tipo, tone: "neutral", icon: undefined };
  }
}

function nombreExcepcion(e: ExcepcionRow, t: TFunc): string {
  const quien = e.nombre_asegurado_crudo || e.numero_poliza_crudo || e.productor_crudo || t("dash.noData");
  return e.aseguradora ? `${e.aseguradora} · ${quien}` : quien;
}

function sugerenciaTexto(e: ExcepcionRow, t: TFunc): string | null {
  if (!e.agente_sugerido) return null;
  const partes = [e.agente_sugerido, e.oficina_sugerida].filter(Boolean).join(", ");
  const score = e.score != null ? ` (${Math.round(e.score)}%)` : "";
  const explicacion = e.explicacion ? ` — ${e.explicacion}` : "";
  return t("dash.suggestion", { detalle: `${partes}${score}${explicacion}` });
}

export default function ResumenPage() {
  const router = useRouter();
  const { t, idioma } = useI18n();
  const [mes, setMes] = useState<Date>(() => primerDiaDelMes(0));
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [kpis, setKpis] = useState<ResumenKpis | null>(null);
  const [excepciones, setExcepciones] = useState<ExcepcionRow[]>([]);
  const [totalPendientes, setTotalPendientes] = useState(0);
  const [book, setBook] = useState<BookResumen | null>(null);
  const [produccion, setProduccion] = useState<ProduccionMes[]>([]);
  const [ranking, setRanking] = useState<OficinaRanking[]>([]);
  const [primaSinClasificar, setPrimaSinClasificar] = useState(0);
  // La serie real del Book y el reparto por ramo: alimentan las lineas de las tarjetas y la dona.
  const [serie, setSerie] = useState<PuntoSerie[]>([]);
  const [ramos, setRamos] = useState<RamoPrima[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    setError(null);
    const { desde, hasta } = rangoDelMes(mes);

    // La producción se mira por año entero y no por el mes elegido: el gráfico existe justamente
    // para comparar un mes contra los otros, así que si se moviera con el filtro mostraría siempre
    // una sola barra.
    const anio = mes.getFullYear();
    const desdeAnio = `${anio}-01-01`;
    const hastaAnio = `${anio}-12-31`;

    Promise.all([
      getResumenKpis(desde, hasta),
      getExcepcionesTop(5),
      getExcepcionesPendientesCount(),
      getBookResumen(),
      getProduccionPorMes(desdeAnio, hastaAnio),
      getRankingOficinas(desde, hasta, 10),
      getPrimaSinClasificar(desde, hasta),
      getSerieBook(12),
      getPrimaPorRamo(),
    ])
      .then(([k, ex, n, b, prod, rank, sinClasificar, s, r]) => {
        if (!activo) return;
        setKpis(k);
        setExcepciones(ex);
        setTotalPendientes(n);
        setBook(b);
        setProduccion(prod);
        setRanking(rank);
        setPrimaSinClasificar(sinClasificar);
        setSerie(s);
        setRamos(r);
      })
      .catch((err: unknown) => {
        if (!activo) return;
        console.error(err);
        setError(err instanceof Error ? err.message : t("dash.loadError"));
        setKpis(null);
        setExcepciones([]);
        setTotalPendientes(0);
        setBook(null);
        setProduccion([]);
        setRanking([]);
        setPrimaSinClasificar(0);
        setSerie([]);
        setRamos([]);
      })
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, [mes]);

  const opcionesMes = useMemo(() => Array.from({ length: 12 }, (_, i) => primerDiaDelMes(i)), []);
  const totalOficinas = kpis?.por_oficina ?? [];

  // Para la dona: los seis ramos con más prima y el resto junto en "Otros". Más de seis porciones
  // dejan de leerse — las últimas quedan como hilos de color sin nombre posible.
  const { porcionesRamo, totalRamos } = useMemo(() => {
    const total = ramos.reduce((s, r) => s + r.prima, 0);
    const top = ramos.slice(0, 6);
    const resto = ramos.slice(6).reduce((s, r) => s + r.prima, 0);
    const porciones: PorcionDona[] = top.map((r, i) => ({
      etiqueta: r.ramo,
      valor: r.prima,
      color: COLORES_GRAFICA[i % COLORES_GRAFICA.length],
    }));
    if (resto > 0) porciones.push({ etiqueta: t("dash.otherLines"), valor: resto, color: "var(--chart-8)" });
    return { porcionesRamo: porciones, totalRamos: total };
  }, [ramos, t]);

  // Para la cascada: de qué está hecho el total en disputa.
  //
  // NO arranca en lo conciliado. El total en disputa es la SUMA de los tres tipos de excepción,
  // no "lo conciliado menos las excepciones" — son dos bolsas distintas. Empezar en lo conciliado
  // dibujaba una cascada que no cerraba: en agosto salía de $67,010.43 y terminaba en -$726.37
  // sin que la resta diera eso. Arrancando en cero, cada barra encadena con la siguiente y la
  // última es exactamente la suma de las anteriores, que es lo único que una cascada puede
  // afirmar honestamente. Lo conciliado va en el subtítulo, como contexto.
  //
  // Los montos ya vienen en negativo desde la base, así que se suman tal cual.
  const pasosCascada = useMemo(
    () => [
      { etiqueta: t("dash.unidentified"), valor: kpis?.sin_identificar.monto ?? 0 },
      { etiqueta: t("dash.pendingMismatch"), valor: kpis?.mismatch.monto ?? 0 },
      { etiqueta: t("dash.suspectedDuplicates"), valor: kpis?.duplicados.monto ?? 0 },
      { etiqueta: t("dash.totalInDispute"), valor: kpis?.total_disputa.monto ?? 0, esTotal: true },
    ],
    [kpis, t]
  );
  const primaPorOficina = book?.primaPorOficina ?? new Map<string, number>();
  const sumaOficinas = useMemo(
    () => ({
      comision: totalOficinas.reduce((s, o) => s + o.comision, 0),
      excepciones: totalOficinas.reduce((s, o) => s + o.excepciones, 0),
      prima: totalOficinas.reduce((s, o) => s + (primaPorOficina.get(o.oficina_id) ?? 0), 0),
    }),
    [totalOficinas, primaPorOficina]
  );

  // Con menos de la mitad de las pólizas trayendo prima, el total no es un número chico: es un
  // número equivocado. Mejor no mostrarlo que mostrarlo como si estuviera completo.
  const totalProduccion = produccion.reduce((s, p) => s + Number(p.polizas), 0);
  const maxProduccion = produccion.reduce((m, p) => Math.max(m, Number(p.polizas)), 0);
  const mesClave = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, "0")}`;

  const primaIncompleta =
    (book?.polizasActivas ?? 0) > 0 && (book?.activasConPrima ?? 0) < (book?.polizasActivas ?? 0) / 2;

  return (
    <div className="flex flex-col gap-6">
      {/* Saludo + selector de período */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xl font-semibold text-foreground">GELPI INSURANCE CORP</span>
        </div>
        <div className="relative" ref={menuRef}>
          <Chip icon={<ChevronDown size={14} />} onClick={() => setMenuAbierto((v) => !v)}>
            <Calendar size={14} />
            {etiquetaMes(mes, idioma)}
          </Chip>
          {menuAbierto && (
            <div className="absolute right-0 top-10 z-20 max-h-72 w-52 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
              {opcionesMes.map((d) => (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => {
                    setMes(d);
                    setMenuAbierto(false);
                  }}
                  className={clsx(
                    "block w-full px-3 py-2 text-left text-[13px] hover:bg-background",
                    d.getMonth() === mes.getMonth() && d.getFullYear() === mes.getFullYear()
                      ? "font-semibold text-brand"
                      : "text-foreground"
                  )}
                >
                  {etiquetaMes(d, idioma)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-bad-fg bg-bad-bg px-5 py-4 text-[13px] text-bad-fg">
          {t("dash.loadErrorWithDetail", { detalle: error })}
        </Card>
      )}

      {cargando && !kpis ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-brand" size={28} />
        </div>
      ) : (
        <>
          {/* KPI del Book de negocio — lo primero que se ve.
              La línea al pie de cada tarjeta es la serie real del Book mes a mes, reconstruida
              desde las fechas de vigencia y vencimiento de cada póliza (ver 20260926000013). Las
              dos tarjetas que no tienen serie real no llevan línea: dibujar una de adorno en una
              pantalla donde se mira plata es peor que no dibujar nada. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* El total de prima se sumaba sobre todas las activas sin decir que casi ninguna
                traía prima cargada: 50 de 2.331. Un número así parece completo y no lo es, y con
                él se toman decisiones. Ahora dice sobre cuántas está hecho, y avisa cuando la
                mayoría falta. */}
            <KpiCard
              label={t("dash.bookPremium")}
              value={primaIncompleta ? "—" : money(book?.premiumActivo ?? 0)}
              sub={
                primaIncompleta
                  ? t("dash.premiumIncomplete", { con: book?.activasConPrima ?? 0, total: book?.polizasActivas ?? 0 })
                  : t("dash.premiumOverActive", { con: book?.activasConPrima ?? 0, total: book?.polizasActivas ?? 0 })
              }
              subTone={primaIncompleta ? "bad" : "brand"}
              icono={<Shield size={17} />}
              color="var(--chart-1)"
              serie={serie.map((s) => s.prima)}
            />
            <KpiCard
              label={t("dash.activePolicies")}
              value={(book?.polizasActivas ?? 0).toLocaleString("en-US")}
              sub={t("dash.inActiveBook")}
              subTone="ok"
              icono={<FileText size={17} />}
              color="var(--chart-2)"
              serie={serie.map((s) => s.polizas)}
            />
            <KpiCard
              label={t("dash.canceledPolicies")}
              value={(book?.polizasCanceladas ?? 0).toLocaleString("en-US")}
              sub={t("dash.canceledPremium", { monto: money(book?.premiumCancelado ?? 0) })}
              subTone="muted"
              icono={<XCircle size={17} />}
              color="var(--bad-fg)"
            />
            <KpiCard
              label={t("dash.activeOffices")}
              value={String(totalOficinas.length)}
              sub={t("dash.writingThisMonth")}
              subTone="muted"
              icono={<Building2 size={17} />}
              color="var(--chart-3)"
            />
          </div>

          {/* KPI de conciliación de comisiones — secundario */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t("dash.commissionReconciliation")}</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <KpiComisionesConciliadas monto={kpis?.conciliado ?? 0} mes={mes} numOficinas={totalOficinas.length} />
            <KpiCard label={t("dash.unidentified")} value={money(kpis?.sin_identificar.monto ?? 0)} sub={t("dash.linesCount", { n: kpis?.sin_identificar.n ?? 0 })} subTone="warn" icono={<AlertTriangle size={16} />} color="var(--warn-fg)" />
            <KpiCard label={t("dash.pendingMismatch")} value={money(kpis?.mismatch.monto ?? 0)} sub={t("dash.linesCount", { n: kpis?.mismatch.n ?? 0 })} subTone="warn" icono={<AlertCircle size={16} />} color="var(--chart-4)" />
            <KpiCard label={t("dash.suspectedDuplicates")} value={money(kpis?.duplicados.monto ?? 0)} sub={t("dash.casesCount", { n: kpis?.duplicados.n ?? 0 })} subTone="muted" icono={<Copy size={16} />} color="var(--chart-3)" />
            <KpiCard label={t("dash.saleConflicts")} value={String(kpis?.conflictos ?? 0)} sub={t("dash.openCases")} subTone="muted" icono={<ShieldAlert size={16} />} color="var(--chart-6)" />
            <button
              type="button"
              onClick={() => router.push("/comisiones/conciliacion")}
              className="flex flex-col gap-1 rounded-xl border border-bad-fg bg-bad-bg p-5 text-left transition hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-bad-fg">{t("dash.totalInDispute")}</span>
                <ArrowRight size={14} className="text-bad-fg" />
              </div>
              <div className="text-[28px] font-semibold tracking-tight tabular-nums text-bad-fg">
                {money(kpis?.total_disputa.monto ?? 0)}
              </div>
              <div className="mt-2 text-xs font-medium text-bad-fg">
                {t("dash.disputeCasesDetail", { n: kpis?.total_disputa.n ?? 0, conciliacion: t("nav.reconciliation") })}
              </div>
            </button>
          </div>

          {/* Producción y ranking: las dos preguntas que el dashboard no contestaba. Van antes que
              las excepciones porque una es cómo viene el negocio y la otra es trabajo pendiente —
              y el trabajo pendiente ya está resumido arriba en un número. */}
          <div className="grid grid-cols-1 gap-6 items-stretch lg:grid-cols-2 xl:grid-cols-3">
            <Card className="flex flex-col">
              <CardHead
                title={t("dash.newPolicies")}
                action={
                  <span className="text-[13px] text-muted">
                    {t("dash.policiesIn", { n: totalProduccion.toLocaleString("en-US"), anio: mes.getFullYear() })}
                  </span>
                }
              />
              <div className="px-5 pb-5 pt-1">
                {produccion.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-muted">
                    {t("dash.noPoliciesInYear", { anio: mes.getFullYear() })}
                  </p>
                ) : (
                  <>
                    <div className="flex h-[150px] items-end gap-1.5">
                      {produccion.map((p) => {
                        // La altura se mide contra el mejor mes del año, no contra un tope fijo:
                        // así la diferencia entre 12 y 432 se ve, que es de lo que se trata.
                        const alto = maxProduccion > 0 ? Math.max(3, (p.polizas / maxProduccion) * 120) : 3;
                        const esMesElegido = p.mes.slice(0, 7) === mesClave;
                        return (
                          <div key={p.mes} className="flex flex-1 flex-col items-center gap-1">
                            <span
                              className={clsx(
                                "text-[11px] tabular-nums",
                                esMesElegido ? "font-semibold text-foreground" : "text-muted"
                              )}
                            >
                              {p.polizas}
                            </span>
                            <div
                              className={clsx(
                                "w-full rounded-t",
                                esMesElegido ? "bg-brand-dark" : "bg-brand"
                              )}
                              style={{ height: `${alto}px` }}
                              title={t("dash.monthPoliciesPremium", { mes: etiquetaMesCorto(p.mes, idioma), n: p.polizas, monto: money(Number(p.prima)) })}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      {produccion.map((p) => (
                        <span
                          key={p.mes}
                          className={clsx(
                            "flex-1 text-center text-[11px]",
                            p.mes.slice(0, 7) === mesClave ? "font-semibold text-foreground" : "text-muted"
                          )}
                        >
                          {etiquetaMesCorto(p.mes, idioma)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* De qué está hecho el Book. Contesta una pregunta que hasta ahora no contestaba
                ninguna pantalla: en qué ramo está metida la prima. */}
            <Card className="flex flex-col">
              <CardHead title={t("dash.premiumByLine")} subtitle={t("dash.ofActiveBook")} />
              {porcionesRamo.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-muted">{t("dash.noLineData")}</div>
              ) : (
                <div className="flex flex-1 flex-wrap items-center justify-center gap-5 px-1 pb-1 pt-2">
                  <Dona
                    porciones={porcionesRamo}
                    centroArriba={moneyCorto(totalRamos)}
                    centroAbajo={t("dash.totalPremium")}
                    tamano={168}
                  />
                  <div className="flex min-w-[168px] flex-1 flex-col gap-1.5">
                    {porcionesRamo.map((p) => (
                      <div key={p.etiqueta} className="flex items-center gap-2 text-[12px]">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ background: p.color }}
                          aria-hidden
                        />
                        <span className="flex-1 truncate capitalize text-foreground">{p.etiqueta}</span>
                        <span className="tabular-nums text-muted">
                          {totalRamos > 0 ? ((p.valor / totalRamos) * 100).toFixed(1) : "0.0"}%
                        </span>
                        <span className="w-[74px] text-right tabular-nums text-foreground">{moneyCorto(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHead
                title={t("dash.topOffices")}
                subtitle={t("dash.byNewBusinessPremium")}
              />
              {ranking.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-muted">
                  {t("dash.noOfficePremium", { mes: etiquetaMes(mes, idioma) })}
                </p>
              ) : (
                /* Lista y no tabla: en la columna angosta del dashboard una tabla de cuatro
                   columnas se corta y hay que arrastrarla de lado. La barra dice de un vistazo
                   la distancia entre la primera oficina y las demás, que es justo lo que se
                   viene a mirar acá — el detalle exacto está en la tabla de más abajo. */
                <div className="flex flex-col gap-3 px-5 pb-4 pt-1">
                  {ranking.map((o, i) => {
                    const copaClase = i === 0 || i === 1 || i === 2 ? COPA_POR_PUESTO[i] : null;
                    // La barra se mide contra la oficina que más vendió, no contra el total: si
                    // se midiera contra el total, con cinco oficinas todas quedarían cortitas y
                    // no se distinguiría nada.
                    const tope = Math.max(...ranking.map((r) => Math.abs(Number(r.prima))), 1);
                    const prima = Number(o.prima);
                    const ancho = Math.max((Math.abs(prima) / tope) * 100, 1.5);
                    const enRojo = prima < 0;
                    return (
                      <div key={o.oficina_id ?? "sin-oficina"} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="flex w-5 flex-shrink-0 items-center justify-center">
                            {copaClase ? (
                              <Trophy size={16} className={copaClase} aria-hidden />
                            ) : (
                              <span className="text-xs tabular-nums text-muted">{i + 1}</span>
                            )}
                          </span>
                          <span className="flex-1 truncate font-medium text-foreground">{o.oficina}</span>
                          <span className="flex-shrink-0 text-xs tabular-nums text-muted">
                            {t("dash.policiesShort", { n: o.polizas })}
                          </span>
                          <span
                            className={clsx(
                              "w-[86px] flex-shrink-0 text-right font-semibold tabular-nums",
                              enRojo ? "text-bad-fg" : "text-foreground"
                            )}
                          >
                            {money(prima)}
                          </span>
                        </div>
                        <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-background">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${ancho}%`,
                              background: enRojo ? "var(--bad-fg)" : COLORES_GRAFICA[i % COLORES_GRAFICA.length],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {primaSinClasificar > 0 && (
                <div className="px-5 pb-4 pt-2 text-xs text-muted">
                  {t("dash.unclassifiedPremiumNote", { monto: money(primaSinClasificar) })}
                </div>
              )}
            </Card>
          </div>

          {/* Cómo se llega de lo conciliado a lo que está en disputa. Los mismos números de las
              tarjetas de arriba, pero encadenados: se ve cuál de los tres se está comiendo el
              total en vez de tener que restarlos de cabeza. */}
          <Card>
            <CardHead
              title={t("dash.waterfallTitle")}
              subtitle={t("dash.waterfallSubtitle", {
                mes: etiquetaMes(mes, idioma),
                conciliado: money(kpis?.conciliado ?? 0),
              })}
            />
            {/* Acotada y centrada: cuatro barras estiradas a todo el ancho de la pantalla quedan
                tan separadas que se deja de leer que una encadena con la otra, que es lo único
                que esta gráfica tiene para decir. */}
            <div className="mx-auto w-full max-w-3xl px-5 pb-5 pt-3">
              <Cascada pasos={pasosCascada} alto={170} />
            </div>
          </Card>

          {/* Excepciones + tabla por oficina */}
          <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card>
                <CardHead
                  title={t("dash.exceptionsTitle")}
                  action={<Badge tone="bad">{t("dash.openCount", { n: totalPendientes })}</Badge>}
                />
                <div className="px-5 pb-4 pt-2">
                  <div className="mb-1 text-xs text-muted">{t("dash.sortedByAgeAmount")}</div>

                  {excepciones.length === 0 ? (
                    <EmptyState
                      title={t("dash.noExceptionsTitle")}
                      description={t("dash.noExceptionsDescription")}
                    />
                  ) : (
                    <div className="flex flex-col">
                      {/* Cada renglón es un link directo al panel de esa excepción en Conciliación
                          (mismo deep-link ?excepcion=<id> que ya usa AgenteFicha). Arturo las veía
                          pero no podía hacer nada con ellas — ahora un clic lo deja parado en la
                          pantalla donde se resuelve. Se muestran más compactas (menos padding,
                          sugerencia en una sola línea con truncate) porque el detalle completo ya
                          está a un clic de distancia. */}
                      {excepciones.map((e, i) => {
                        const badge = e.atrasada
                          ? { texto: t("dash.overdue"), tone: "bad" as Tone, icon: <AlertTriangle size={12} /> }
                          : etiquetaTipoExcepcion(e.tipo, t);
                        const sugerencia = sugerenciaTexto(e, t);
                        return (
                          <Link
                            key={e.id}
                            href={`/comisiones/conciliacion/?excepcion=${e.id}`}
                            className={clsx(
                              "group flex flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-background",
                              i < excepciones.length - 1 && "border-b border-border"
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge tone={badge.tone} icon={badge.icon}>
                                  {badge.texto}
                                </Badge>
                                {e.atrasada && (
                                  <span className="text-xs text-muted">{etiquetaTipoExcepcion(e.tipo, t).texto}</span>
                                )}
                                <span className="truncate text-sm font-medium text-foreground">{nombreExcepcion(e, t)}</span>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-3">
                                <span className="min-w-[5rem] whitespace-nowrap text-right text-sm font-medium tabular-nums text-foreground">
                                  {money(e.monto)}
                                </span>
                                <span className="w-14 text-right text-xs tabular-nums text-muted">
                                  {t("dash.daysCount", { n: e.antiguedad_dias, s: e.antiguedad_dias === 1 ? "" : "s" })}
                                </span>
                                <ArrowRight
                                  size={14}
                                  className="flex-shrink-0 text-muted transition-colors group-hover:text-foreground"
                                  aria-hidden
                                />
                              </div>
                            </div>
                            {sugerencia && <div className="truncate pl-[76px] text-xs text-muted">{sugerencia}</div>}
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  {totalPendientes > 0 && (
                    <div className="flex justify-end pt-3.5">
                      <Button variant="secondary" size="sm" href="/comisiones/conciliacion">
                        {t("dash.viewAllInReconciliation", { n: totalPendientes, conciliacion: t("nav.reconciliation") })}
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <Card className="overflow-hidden">
                <CardHead
                  title={t("dash.commissionsExceptionsByOffice")}
                  action={
                    <Button variant="ghost" size="sm" href="/comisiones/agentes/">
                      {t("dash.viewAgents")}
                    </Button>
                  }
                />
                {totalOficinas.length === 0 ? (
                  <EmptyState title={t("dash.noOfficeDataTitle")} description={t("dash.noOfficeDataDescription")} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-background">
                          <th className="whitespace-nowrap px-5 py-2.5 text-left font-medium text-muted">{t("col.office")}</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">{t("dash.activePremiumBook")}</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">{t("dash.commission")}</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">{t("dash.excAbbrev")}</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-left font-medium text-muted">{t("dash.age")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {totalOficinas.map((o) => (
                          <tr key={o.oficina_id} className="border-t border-border">
                            <td className="px-5 py-3 font-medium text-foreground">{o.oficina}</td>
                            {/* Misma razón que el KPI de arriba: si el Book casi no trae primas,
                                el número por oficina tampoco significa nada. */}
                            <td className="px-5 py-3 text-right tabular-nums text-foreground">
                              {primaIncompleta ? "—" : money(primaPorOficina.get(o.oficina_id) ?? 0)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-foreground">{money(o.comision)}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-foreground">{o.excepciones}</td>
                            <td className="px-5 py-3 text-muted">
                              <span className="mr-2">{t("dash.daysCount", { n: o.antiguedad, s: o.antiguedad === 1 ? "" : "s" })}</span>
                              {o.antiguedad >= UMBRAL_ATRASADA_DIAS && o.excepciones > 0 && <Badge tone="bad">{t("dash.overdueOffice")}</Badge>}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-border bg-background">
                          <td className="px-5 py-3 font-medium text-foreground">{t("dash.officeCount", { n: totalOficinas.length, s: totalOficinas.length === 1 ? "" : "s" })}</td>
                          <td className="px-5 py-3 text-right font-medium tabular-nums text-foreground">{money(sumaOficinas.prima)}</td>
                          <td className="px-5 py-3 text-right font-medium tabular-nums text-foreground">{money(sumaOficinas.comision)}</td>
                          <td className="px-5 py-3 text-right font-medium tabular-nums text-foreground">{sumaOficinas.excepciones}</td>
                          <td className="px-5 py-3 text-muted">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          </div>

        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  subTone,
  icono,
  color,
  serie,
  destacado,
}: {
  label: string;
  value: string;
  sub: string;
  subTone: "ok" | "warn" | "bad" | "muted" | "brand";
  // Todo lo de abajo es opcional: las tarjetas de conciliación se quedan en la versión simple.
  icono?: React.ReactNode;
  color?: string;
  // Si hay serie, va la línea y el badge de variación. Si no hay, no se dibuja nada: una curva
  // inventada se ve igual de bien que una de verdad, y por eso no puede haber ninguna.
  serie?: number[];
  destacado?: boolean;
}) {
  const toneClass: Record<typeof subTone, string> = {
    ok: "text-ok-fg",
    warn: "text-warn-fg",
    bad: "text-bad-fg",
    muted: "text-muted",
    brand: "text-brand",
  };
  const cambio = serie ? variacion(serie) : null;

  return (
    <div
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-md",
        destacado ? "border-bad-fg/40" : "border-border"
      )}
    >
      <div className="flex flex-col gap-1 p-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {icono && (
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                style={color ? { background: `color-mix(in srgb, ${color} 12%, transparent)`, color } : undefined}
                aria-hidden
              >
                {icono}
              </span>
            )}
            <span className="text-[13px] leading-tight text-muted">{label}</span>
          </div>
          {cambio != null && (
            <span
              className={clsx(
                "flex flex-shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                cambio >= 0 ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"
              )}
              title="Contra el mes anterior"
            >
              {cambio >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              {Math.abs(cambio).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
        <div className={clsx("text-xs font-medium", toneClass[subTone])}>{sub}</div>
      </div>
      {serie && serie.length > 1 && (
        <div className="mt-auto">
          <Sparkline datos={serie} color={color ?? "var(--chart-1)"} alto={46} />
        </div>
      )}
    </div>
  );
}

function KpiComisionesConciliadas({ monto, mes, numOficinas }: { monto: number; mes: Date; numOficinas: number }) {
  const { t, idioma } = useI18n();
  const mesCorto = mes.toLocaleDateString(idioma === "es" ? "es-US" : "en-US", { month: "short", year: "numeric" });
  const mesCapitalizado = mesCorto.charAt(0).toUpperCase() + mesCorto.slice(1);
  return (
    <KpiCard
      label={t("dash.reconciledCommissions")}
      value={money(monto)}
      sub={`${mesCapitalizado}, ${t("dash.officeCount", { n: numOficinas, s: numOficinas === 1 ? "" : "s" })}`}
      subTone="brand"
    />
  );
}

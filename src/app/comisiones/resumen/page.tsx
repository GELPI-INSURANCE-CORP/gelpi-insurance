"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronDown,
  Copy,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card, CardHead, Chip, EmptyState } from "@/components/ui";
import type { Tone } from "@/components/ui/Badge";
import { money } from "@/lib/format";
import {
  type AgenteRanking,
  type BookResumen,
  type ExcepcionRow,
  type ProduccionMes,
  type ResumenKpis,
  getBookResumen,
  getExcepcionesPendientesCount,
  getExcepcionesTop,
  getProduccionPorMes,
  getRankingAgentes,
  getResumenKpis,
  rangoDelMes,
} from "@/lib/queries/resumen";

const UMBRAL_ATRASADA_DIAS = 10;

function primerDiaDelMes(offsetMeses: number): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() - offsetMeses, 1);
}

// El mes corto para el eje del grafico. Se arma en UTC: la fecha viene como "2026-08-01" y
// leida en la zona de Miami cae el 31 de julio a la noche, asi que agosto se rotularia Jul.
function etiquetaMesCorto(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function etiquetaMes(d: Date): string {
  const s = d.toLocaleDateString("es-US", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function etiquetaTipoExcepcion(tipo: ExcepcionRow["tipo"]): { texto: string; tone: Tone; icon: React.ReactNode } {
  switch (tipo) {
    case "mismatch":
      return { texto: "Mismatch", tone: "warn", icon: <AlertCircle size={12} /> };
    case "sin_identificar":
      return { texto: "Sin identificar", tone: "bad", icon: <AlertTriangle size={12} /> };
    case "duplicado":
      return { texto: "Duplicado sospechoso", tone: "silver", icon: <Copy size={12} /> };
    case "conflicto_venta":
      return { texto: "Conflicto de venta", tone: "info", icon: <ShieldAlert size={12} /> };
    default:
      return { texto: tipo, tone: "neutral", icon: undefined };
  }
}

function nombreExcepcion(e: ExcepcionRow): string {
  const quien = e.nombre_asegurado_crudo || e.numero_poliza_crudo || e.productor_crudo || "Sin datos";
  return e.aseguradora ? `${e.aseguradora} · ${quien}` : quien;
}

function sugerenciaTexto(e: ExcepcionRow): string | null {
  if (!e.agente_sugerido) return null;
  const partes = [e.agente_sugerido, e.oficina_sugerida].filter(Boolean).join(", ");
  const score = e.score != null ? ` (${Math.round(e.score)}%)` : "";
  const explicacion = e.explicacion ? ` — ${e.explicacion}` : "";
  return `Sugerencia: ${partes}${score}${explicacion}`;
}

export default function ResumenPage() {
  const router = useRouter();
  const [mes, setMes] = useState<Date>(() => primerDiaDelMes(0));
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [kpis, setKpis] = useState<ResumenKpis | null>(null);
  const [excepciones, setExcepciones] = useState<ExcepcionRow[]>([]);
  const [totalPendientes, setTotalPendientes] = useState(0);
  const [book, setBook] = useState<BookResumen | null>(null);
  const [produccion, setProduccion] = useState<ProduccionMes[]>([]);
  const [ranking, setRanking] = useState<AgenteRanking[]>([]);
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
      getRankingAgentes(desde, hasta, 10),
    ])
      .then(([k, ex, n, b, prod, rank]) => {
        if (!activo) return;
        setKpis(k);
        setExcepciones(ex);
        setTotalPendientes(n);
        setBook(b);
        setProduccion(prod);
        setRanking(rank);
      })
      .catch((err: unknown) => {
        if (!activo) return;
        console.error(err);
        setError(err instanceof Error ? err.message : "No se pudo cargar el resumen.");
        setKpis(null);
        setExcepciones([]);
        setTotalPendientes(0);
        setBook(null);
        setProduccion([]);
        setRanking([]);
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
            {etiquetaMes(mes)}
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
                  {etiquetaMes(d)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-bad-fg bg-bad-bg px-5 py-4 text-[13px] text-bad-fg">
          No se pudo cargar el resumen: {error}
        </Card>
      )}

      {cargando && !kpis ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-brand" size={28} />
        </div>
      ) : (
        <>
          {/* KPI del Book de negocio — lo primero que se ve */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* El total de prima se sumaba sobre todas las activas sin decir que casi ninguna
                traía prima cargada: 50 de 2.331. Un número así parece completo y no lo es, y con
                él se toman decisiones. Ahora dice sobre cuántas está hecho, y avisa cuando la
                mayoría falta. */}
            <KpiCard
              label="Premium total (pólizas activas)"
              value={primaIncompleta ? "—" : money(book?.premiumActivo ?? 0)}
              sub={
                primaIncompleta
                  ? `Solo ${book?.activasConPrima ?? 0} de ${book?.polizasActivas ?? 0} pólizas traen prima: volvé a subir el Book para completarlo`
                  : `sobre ${book?.activasConPrima ?? 0} de ${book?.polizasActivas ?? 0} pólizas activas`
              }
              subTone={primaIncompleta ? "bad" : "brand"}
            />
            <KpiCard
              label="Pólizas activas"
              value={String(book?.polizasActivas ?? 0)}
              sub="en el Active Business Book"
              subTone="ok"
            />
            <KpiCard
              label="Pólizas canceladas"
              value={String(book?.polizasCanceladas ?? 0)}
              sub={`${money(book?.premiumCancelado ?? 0)} en premium cancelado`}
              subTone="muted"
            />
          </div>

          {/* KPI de conciliación de comisiones — secundario */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Conciliación de comisiones</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <KpiComisionesConciliadas monto={kpis?.conciliado ?? 0} mes={mes} numOficinas={totalOficinas.length} />
            <KpiCard label="Sin identificar" value={money(kpis?.sin_identificar.monto ?? 0)} sub={`${kpis?.sin_identificar.n ?? 0} líneas`} subTone="warn" />
            <KpiCard label="Mismatch pendiente" value={money(kpis?.mismatch.monto ?? 0)} sub={`${kpis?.mismatch.n ?? 0} líneas`} subTone="warn" />
            <KpiCard label="Duplicados sospechosos" value={money(kpis?.duplicados.monto ?? 0)} sub={`${kpis?.duplicados.n ?? 0} casos`} subTone="muted" />
            <KpiCard label="Conflictos de venta" value={String(kpis?.conflictos ?? 0)} sub="casos abiertos" subTone="muted" />
            <button
              type="button"
              onClick={() => router.push("/comisiones/conciliacion")}
              className="flex flex-col gap-1 rounded-xl border border-bad-fg bg-bad-bg p-5 text-left transition hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-bad-fg">Total en disputa</span>
                <ArrowRight size={14} className="text-bad-fg" />
              </div>
              <div className="text-[28px] font-semibold tracking-tight text-bad-fg">
                {money(kpis?.total_disputa.monto ?? 0)}
              </div>
              <div className="mt-2 text-xs font-medium text-bad-fg">
                {kpis?.total_disputa.n ?? 0} casos abiertos · Ver en Conciliación
              </div>
            </button>
          </div>

          {/* Producción y ranking: las dos preguntas que el dashboard no contestaba. Van antes que
              las excepciones porque una es cómo viene el negocio y la otra es trabajo pendiente —
              y el trabajo pendiente ya está resumido arriba en un número. */}
          <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-2">
            <Card>
              <CardHead
                title="Pólizas nuevas por mes"
                action={
                  <span className="text-[13px] text-muted">
                    {totalProduccion.toLocaleString("en-US")} en {mes.getFullYear()}
                  </span>
                }
              />
              <div className="px-5 pb-5 pt-1">
                {produccion.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-muted">
                    Todavía no hay pólizas con fecha de vigencia en {mes.getFullYear()}.
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
                              title={`${etiquetaMesCorto(p.mes)}: ${p.polizas} pólizas · ${money(Number(p.prima))}`}
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
                          {etiquetaMesCorto(p.mes)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardHead
                title="Agentes que más produjeron"
                subtitle="Por comisión conciliada del mes elegido"
              />
              {ranking.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-muted">
                  Ningún agente tiene comisión conciliada en {etiquetaMes(mes)}.
                </p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-background">
                      <th className="px-5 py-2.5 text-left font-medium text-muted">Agente</th>
                      <th className="px-5 py-2.5 text-left font-medium text-muted">Oficina</th>
                      <th className="px-5 py-2.5 text-right font-medium text-muted">Líneas</th>
                      <th className="px-5 py-2.5 text-right font-medium text-muted">Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((a) => (
                      <tr key={a.agente_id} className="border-b border-border last:border-b-0">
                        <td className="px-5 py-3 font-medium text-foreground">{a.agente}</td>
                        <td className="px-5 py-3 text-muted">{a.oficina ?? "—"}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{a.lineas}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums text-foreground">
                          {money(Number(a.comision))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {/* Excepciones + tabla por oficina */}
          <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card>
                <CardHead
                  title="Excepciones que necesitan tu atención hoy"
                  action={<Badge tone="bad">{totalPendientes} abiertas</Badge>}
                />
                <div className="px-5 pb-4 pt-2">
                  <div className="mb-1 text-xs text-muted">Ordenadas por antigüedad y monto</div>

                  {excepciones.length === 0 ? (
                    <EmptyState
                      title="No hay excepciones pendientes"
                      description="Todas las líneas del período están conciliadas o resueltas."
                    />
                  ) : (
                    <div className="flex flex-col">
                      {excepciones.map((e, i) => {
                        const badge = e.atrasada
                          ? { texto: "Atrasada", tone: "bad" as Tone, icon: <AlertTriangle size={12} /> }
                          : etiquetaTipoExcepcion(e.tipo);
                        const sugerencia = sugerenciaTexto(e);
                        return (
                          <div
                            key={e.id}
                            className={clsx("flex flex-col gap-1 py-2.5", i < excepciones.length - 1 && "border-b border-border")}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge tone={badge.tone} icon={badge.icon}>
                                  {badge.texto}
                                </Badge>
                                {e.atrasada && (
                                  <span className="text-xs text-muted">{etiquetaTipoExcepcion(e.tipo).texto}</span>
                                )}
                                <span className="truncate text-sm font-medium text-foreground">{nombreExcepcion(e)}</span>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-4">
                                <span className="text-sm font-medium text-foreground">{money(e.monto)}</span>
                                <span className="w-14 text-right text-xs text-muted">
                                  {e.antiguedad_dias} {e.antiguedad_dias === 1 ? "día" : "días"}
                                </span>
                              </div>
                            </div>
                            {sugerencia && <div className="pl-[76px] text-xs leading-relaxed text-muted">{sugerencia}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {totalPendientes > 0 && (
                    <div className="flex justify-end pt-3.5">
                      <Button variant="secondary" size="sm" href="/comisiones/conciliacion">
                        Ver las {totalPendientes} en Conciliación
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <Card>
                <CardHead
                  title="Comisiones y excepciones por oficina"
                  action={
                    <Button variant="ghost" size="sm" href="/comisiones/agentes/">
                      Ver agentes
                    </Button>
                  }
                />
                {totalOficinas.length === 0 ? (
                  <EmptyState title="Sin datos de oficinas" description="Todavía no hay comisiones conciliadas en este período." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-background">
                          <th className="whitespace-nowrap px-5 py-2.5 text-left font-medium text-muted">Oficina</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">Prima activa (Book)</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">Comisión</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-right font-medium text-muted">Excep.</th>
                          <th className="whitespace-nowrap px-5 py-2.5 text-left font-medium text-muted">Antigüedad</th>
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
                              <span className="mr-2">{o.antiguedad} {o.antiguedad === 1 ? "día" : "días"}</span>
                              {o.antiguedad >= UMBRAL_ATRASADA_DIAS && o.excepciones > 0 && <Badge tone="bad">Atrasadas</Badge>}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-border bg-background">
                          <td className="px-5 py-3 font-medium text-foreground">{totalOficinas.length} oficinas</td>
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
}: {
  label: string;
  value: string;
  sub: string;
  subTone: "ok" | "warn" | "bad" | "muted" | "brand";
}) {
  const toneClass: Record<typeof subTone, string> = {
    ok: "text-ok-fg",
    warn: "text-warn-fg",
    bad: "text-bad-fg",
    muted: "text-muted",
    brand: "text-brand",
  };
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-5">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="text-[26px] font-semibold tracking-tight text-foreground">{value}</div>
      <div className={clsx("mt-2 text-xs font-medium", toneClass[subTone])}>{sub}</div>
    </div>
  );
}

function KpiComisionesConciliadas({ monto, mes, numOficinas }: { monto: number; mes: Date; numOficinas: number }) {
  const mesCorto = mes.toLocaleDateString("es-US", { month: "short", year: "numeric" });
  return (
    <KpiCard
      label="Comisiones conciliadas del período"
      value={money(monto)}
      sub={`${mesCorto.charAt(0).toUpperCase() + mesCorto.slice(1)}, ${numOficinas} ${numOficinas === 1 ? "oficina" : "oficinas"}`}
      subTone="brand"
    />
  );
}

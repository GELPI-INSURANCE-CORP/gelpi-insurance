"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, AlertTriangle, RefreshCw, Ban, CheckCircle2, X, Inbox, GitCompare, Wallet, ChevronDown } from "lucide-react";
import SubirReporteModal from "@/components/reportes/SubirReporteModal";
import clsx from "clsx";
import { Badge, Card, CardHead, EmptyState, Select, type Tone } from "@/components/ui";
import { fechaHora, TIPOS_REPORTE } from "@/lib/format";
import {
  esReporteReintentable,
  getReporteLineas,
  listAseguradoras,
  listReportes,
  reintentarExtraccion,
  subscribeReporteUpdates,
  type Aseguradora,
  type BonoResumen,
  type LineaComision,
  type LineaVenta,
  type Reporte,
  type TipoReporte,
} from "@/lib/queries/subir";
import ReporteDrawer from "@/components/reportes/ReporteDrawer";

const ESTADOS_REPORTE: Record<string, string> = {
  subido: "Subido",
  extrayendo: "Extrayendo",
  extraido: "Extraído",
  matcheado: "Matcheado",
  cerrado: "Finalizado",
  error: "Error",
  bloqueado: "Bloqueado",
};

function estadoReporteBadge(r: Reporte): { tone: Tone; label: string; icon?: ReactNode } {
  const pend = r.total_excepciones ?? 0;
  switch (r.estado) {
    case "subido":
      return { tone: "neutral", label: "Subido" };
    case "extrayendo":
      return { tone: "info", label: "Extrayendo…", icon: <RefreshCw size={12} className="animate-spin" /> };
    case "extraido":
      return pend > 0
        ? { tone: "warn", label: `Extraído · revisar mapeo (${pend} pend.)`, icon: <AlertTriangle size={12} /> }
        : { tone: "ok", label: "Extraído", icon: <CheckCircle2 size={12} /> };
    case "matcheado":
      return pend > 0
        ? { tone: "warn", label: `Matcheado · ${pend} pend.`, icon: <AlertTriangle size={12} /> }
        : { tone: "ok", label: "Matcheado", icon: <CheckCircle2 size={12} /> };
    case "cerrado":
      return { tone: "ok", label: "Finalizado", icon: <CheckCircle2 size={12} /> };
    case "error":
      return { tone: "bad", label: "Error", icon: <AlertTriangle size={12} /> };
    case "bloqueado":
      return { tone: "bad", label: "Bloqueado", icon: <Ban size={12} /> };
    default:
      return { tone: "neutral", label: r.estado };
  }
}

function isPreviewable(estado: Reporte["estado"]) {
  return estado === "extraido" || estado === "matcheado" || estado === "cerrado";
}

// Reportes de comisiones (statement de aseguradora y afines): al hacer click van a la pantalla de
// detalle dedicada (/comisiones/statement/). El resto (venta interna, bonos, ABB) sigue abriendo el
// drawer lateral de siempre porque esa pantalla nueva está pensada solo para conciliar comisiones.
const TIPOS_PANTALLA_STATEMENT = new Set<TipoReporte>([
  "comision_aseguradora",
  "chargebacks",
  "produccion",
  "cancelaciones",
  "renovaciones",
  "resumen_anual",
  "otro",
]);

// Agrupa por período (o, si no se asignó uno, por el mes de subida) para que la tabla se lea
// como una sola lista larga con encabezados, en vez de una fila plana por archivo. Los reportes
// ya llegan ordenados por fecha descendente, así que recorrerlos una vez con un Map alcanza para
// que los grupos salgan en orden correcto sin tener que parsear ni comparar fechas de nuevo.
function mesLabel(iso: string): string {
  const raw = new Date(iso).toLocaleDateString("es-US", { year: "numeric", month: "long" });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function agruparReportesPorPeriodo(lista: Reporte[]): { clave: string; reportes: Reporte[] }[] {
  const grupos = new Map<string, Reporte[]>();
  for (const r of lista) {
    const clave = r.periodo?.trim() || mesLabel(r.created_at);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(r);
  }
  return Array.from(grupos.entries()).map(([clave, reportes]) => ({ clave, reportes }));
}

export default function SubirPage() {
  const router = useRouter();
  const [aseguradoras, setAseguradoras] = useState<Aseguradora[]>([]);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [loadingReportes, setLoadingReportes] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroAseguradora, setFiltroAseguradora] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  const [modalAbierto, setModalAbierto] = useState(false);

  const [selectedReporte, setSelectedReporte] = useState<Reporte | null>(null);
  const [lineasComision, setLineasComision] = useState<LineaComision[]>([]);
  const [lineasVenta, setLineasVenta] = useState<LineaVenta[]>([]);
  const [bonoResumen, setBonoResumen] = useState<BonoResumen | null>(null);
  const [loadingLineas, setLoadingLineas] = useState(false);
  // último reporte pedido para la vista previa: descarta respuestas fuera de orden (ver abrirVistaPrevia)
  const solicitudLineasRef = useRef<string | null>(null);


  const refreshReportes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingReportes(true);
      try {
        const rows = await listReportes({
          tipo: filtroTipo || undefined,
          aseguradoraId: filtroAseguradora || undefined,
          estado: filtroEstado || undefined,
        });
        setReportes(rows);
        setPageError(null);
      } catch (err) {
        setPageError(err instanceof Error ? err.message : "No se pudieron cargar los archivos subidos.");
      } finally {
        setLoadingReportes(false);
      }
    },
    [filtroTipo, filtroAseguradora, filtroEstado]
  );

  useEffect(() => {
    listAseguradoras()
      .then(setAseguradoras)
      .catch((err) => setPageError(err instanceof Error ? err.message : "No se pudieron cargar las aseguradoras."));
  }, []);

  useEffect(() => {
    refreshReportes();
  }, [refreshReportes]);

  // Sondeo simple cada 4s para reflejar el progreso de extracción (subido/extrayendo), sin parpadeo de carga
  useEffect(() => {
    const t = setInterval(() => {
      refreshReportes({ silent: true });
    }, 4000);
    return () => clearInterval(t);
  }, [refreshReportes]);

  // Realtime para el reporte abierto en la vista previa
  useEffect(() => {
    const reporteId = selectedReporte?.id;
    if (!reporteId) return;
    const channel = subscribeReporteUpdates(reporteId, (actualizado) => {
      setSelectedReporte((prev) => (prev && prev.id === actualizado.id ? { ...prev, ...actualizado } : prev));
      setReportes((prev) => prev.map((r) => (r.id === actualizado.id ? { ...r, ...actualizado } : r)));
    });
    return () => {
      channel.unsubscribe();
    };
  }, [selectedReporte?.id]);

  async function abrirVistaPrevia(reporte: Reporte) {
    solicitudLineasRef.current = reporte.id; // marca esta como la solicitud vigente (síncrono, no depende del render)
    setSelectedReporte(reporte);
    setLoadingLineas(true);
    setLineasComision([]);
    setLineasVenta([]);
    setBonoResumen(null);
    try {
      const { comision, venta, bono } = await getReporteLineas(reporte.id, reporte.tipo);
      if (solicitudLineasRef.current !== reporte.id) return; // llegó una solicitud más nueva mientras tanto: descartar
      setLineasComision(comision);
      setLineasVenta(venta);
      setBonoResumen(bono);
    } catch (err) {
      if (solicitudLineasRef.current !== reporte.id) return;
      setPageError(err instanceof Error ? err.message : "No se pudo cargar la vista previa de extracción.");
    } finally {
      if (solicitudLineasRef.current === reporte.id) setLoadingLineas(false);
    }
  }

  function onFilaClick(reporte: Reporte) {
    if (!isPreviewable(reporte.estado)) return;
    if (TIPOS_PANTALLA_STATEMENT.has(reporte.tipo)) {
      router.push(`/comisiones/statement/?id=${reporte.id}`);
    } else {
      abrirVistaPrevia(reporte);
    }
  }

  async function onReintentar(reporte: Reporte) {
    try {
      await reintentarExtraccion(reporte.id);
      refreshReportes();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "No se pudo reintentar la extracción.");
    }
  }

  const aseguradoraOptions = aseguradoras.map((a) => ({ value: a.id, label: a.nombre }));
  const tipoFiltroOptions = Object.entries(TIPOS_REPORTE).map(([value, label]) => ({ value, label }));
  const estadoFiltroOptions = Object.entries(ESTADOS_REPORTE).map(([value, label]) => ({ value, label }));
  const gruposReportes = agruparReportesPorPeriodo(reportes);

  return (
    <div className="flex flex-col gap-7">
      {/* Conciliación y Liquidación salieron del menú lateral porque son pasos DE un statement, no
          secciones aparte. Se entra desde acá, que es donde el usuario ya está cuando las necesita:
          primero sube el statement, después resuelve lo que quedó sin identificar, y al final mira
          cuánto le toca a cada agente. El subtítulo dice para qué sirve cada una, porque los
          nombres solos no se lo dicen a alguien que no armó el sistema. */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/comisiones/conciliacion/"
          className="flex flex-1 min-w-[240px] items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 transition-colors hover:bg-brand-tint/50"
        >
          <GitCompare className="h-5 w-5 flex-shrink-0 text-brand" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-foreground">Conciliación</span>
            <span className="text-xs text-muted">Resolvé las líneas que el sistema no pudo identificar</span>
          </span>
        </Link>
        <Link
          href="/comisiones/liquidacion/"
          className="flex flex-1 min-w-[240px] items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 transition-colors hover:bg-brand-tint/50"
        >
          <Wallet className="h-5 w-5 flex-shrink-0 text-brand" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-foreground">Liquidación</span>
            <span className="text-xs text-muted">Cuánto le toca a cada agente este mes</span>
          </span>
        </Link>
      </div>

      {pageError && (
        <div className="flex items-center gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-3 text-[13px] text-bad-fg">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button type="button" onClick={() => setPageError(null)} aria-label="Cerrar" className="flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Antes había dos cajones grandes de arrastrar y soltar, uno al lado del otro, ocupando
          media pantalla para algo que se usa una vez al mes por compañía. Ahora es un botón: el
          formulario (tipo de reporte, compañía, período, archivo) vive en una ventana que se abre
          encima. El de ventas interno dejó de tener cajón propio y pasó a ser un tipo más dentro
          de la lista, con la explicación al lado de para qué sirve. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold text-foreground">Statements y reportes</span>
          <span className="text-xs text-muted">
            Subí el estado de cuenta de cada compañía y el sistema reparte las comisiones
          </span>
        </div>
        <button
          type="button"
          onClick={() => setModalAbierto(true)}
          className="flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          <UploadCloud size={16} />
          Subir reporte
        </button>
      </div>

      {/* CATÁLOGO: es documentación, no una herramienta — si un archivo no sirve, la ventana de
          subida lo avisa al elegirlo. Va plegado para no ocupar lugar en la vista principal. */}
      <details className="group/detalle">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-foreground">
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="underline decoration-dotted underline-offset-2">¿Qué archivos puedo subir?</span>
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/detalle:rotate-180" />
        </summary>
        <div className="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-0.5 text-xs text-muted">Por aseguradora:</span>
            <Badge tone="info">Statement de comisiones</Badge>
            <Badge tone="info">Reporte de producción / nuevo negocio</Badge>
            <Badge tone="info">Book of business del carrier</Badge>
            <Badge tone="info">Cancelaciones y pendientes de cancelación</Badge>
            <Badge tone="info">Renovaciones</Badge>
            <Badge tone="info">Chargebacks y ajustes</Badge>
            <Badge tone="info">Resumen anual (1099)</Badge>
            <span className="ml-2 mr-0.5 text-xs text-muted">Internos:</span>
            <Badge tone="neutral">Reporte de ventas</Badge>
          </div>
          <span className="text-xs text-muted">Formatos: PDF · Excel · CSV — la IA lee cualquiera</span>
        </div>
      </details>

      {/* TABLA DE ARCHIVOS */}
      <Card className="flex flex-col overflow-hidden rounded-2xl!">
        <CardHead
          title="Archivos subidos"
          subtitle="La suma de “en excepción” de este lote no coincide necesariamente con los casos abiertos en Conciliación: esa cola acumula también statements de meses anteriores sin resolver."
          action={<Badge tone="neutral">{reportes.length} archivo{reportes.length === 1 ? "" : "s"}</Badge>}
        />
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3">
          <Select
            options={tipoFiltroOptions}
            placeholder="Tipo de archivo"
            value={filtroTipo}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroTipo(e.target.value)}
            className="w-44"
          />
          <Select
            options={aseguradoraOptions}
            placeholder="Aseguradora"
            value={filtroAseguradora}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroAseguradora(e.target.value)}
            className="w-40"
          />
          <Select
            options={estadoFiltroOptions}
            placeholder="Estado del archivo"
            value={filtroEstado}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroEstado(e.target.value)}
            className="w-44"
          />
        </div>

        {loadingReportes ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">Cargando archivos…</div>
        ) : reportes.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title="Todavía no hay archivos"
            description="Subí un statement de aseguradora o un reporte de ventas usando las zonas de arriba."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-background">
                  {["Archivo", "Tipo", "Aseguradora", "Fecha", "Filas", "OK", "En excepción", "Estado del archivo"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={clsx(
                          "whitespace-nowrap border-b border-border px-5 py-3 text-left font-medium text-muted",
                          i >= 4 && i <= 6 && "text-right"
                        )}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {gruposReportes.map((grupo) => (
                  <Fragment key={grupo.clave}>
                    <tr className="bg-background">
                      <td
                        colSpan={8}
                        className="border-t border-border px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted"
                      >
                        {grupo.clave} · {grupo.reportes.length} archivo{grupo.reportes.length === 1 ? "" : "s"}
                      </td>
                    </tr>
                    {grupo.reportes.map((r) => {
                      const badge = estadoReporteBadge(r);
                      const clickable = isPreviewable(r.estado);
                      const selected = selectedReporte?.id === r.id;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => onFilaClick(r)}
                          className={clsx(
                            "border-b border-border transition-colors last:border-b-0",
                            clickable && "cursor-pointer hover:bg-brand-tint/50",
                            selected && "bg-brand-tint"
                          )}
                        >
                          <td className="px-5 py-2.5 font-medium text-foreground">{r.nombre_archivo}</td>
                          <td className="px-5 py-2.5 text-muted">{TIPOS_REPORTE[r.tipo] ?? r.tipo}</td>
                          <td className="px-5 py-2.5">{r.aseguradora?.nombre ?? "—"}</td>
                          <td className="px-5 py-2.5 text-muted">{fechaHora(r.created_at)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_lineas}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_ok}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_excepciones}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex flex-col items-start gap-1">
                              <Badge tone={badge.tone} icon={badge.icon}>
                                {badge.label}
                              </Badge>
                              {r.total_lineas > 0 && r.total_lineas - r.total_ok - r.total_excepciones > 0 && (
                                <span className="text-xs font-medium text-bad-fg">
                                  ⚠ {r.total_lineas - r.total_ok - r.total_excepciones} fila
                                  {r.total_lineas - r.total_ok - r.total_excepciones === 1 ? "" : "s"} sin cuadrar (ni OK ni en excepción)
                                </span>
                              )}
                              {esReporteReintentable(r) && (
                                <div className="flex flex-col gap-0.5">
                                  {r.error ? (
                                    <span className="text-xs text-bad-fg">{r.error}</span>
                                  ) : (
                                    <span className="text-xs text-bad-fg">La extracción no respondió a tiempo.</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onReintentar(r);
                                    }}
                                    className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
                                  >
                                    <RefreshCw size={12} />
                                    Reintentar extracción
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SubirReporteModal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        aseguradoras={aseguradoras}
        onAseguradorasChange={setAseguradoras}
        onSubido={refreshReportes}
      />

      {selectedReporte && (
        <ReporteDrawer
          reporte={selectedReporte}
          lineasComision={lineasComision}
          lineasVenta={lineasVenta}
          bonoResumen={bonoResumen}
          loadingLineas={loadingLineas}
          onClose={() => setSelectedReporte(null)}
          onPeriodoActualizado={(periodo) => {
            setSelectedReporte((prev) => (prev ? { ...prev, periodo } : prev));
            setReportes((prev) => prev.map((r) => (r.id === selectedReporte.id ? { ...r, periodo } : r)));
          }}
        />
      )}
    </div>
  );
}


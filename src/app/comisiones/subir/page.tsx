"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, AlertTriangle, RefreshCw, Ban, CheckCircle2, X, Inbox } from "lucide-react";
import clsx from "clsx";
import { Badge, Card, CardHead, EmptyState, Input, Select, type Tone } from "@/components/ui";
import { fechaHora, TIPOS_REPORTE } from "@/lib/format";
import {
  DuplicadoError,
  esReporteReintentable,
  getReporteLineas,
  listAseguradoras,
  listReportes,
  reintentarExtraccion,
  uploadReporte,
  subscribeReporteUpdates,
  type Aseguradora,
  type BonoResumen,
  type LineaComision,
  type LineaVenta,
  type Reporte,
  type TipoReporte,
} from "@/lib/queries/subir";
import { crearAseguradora } from "@/lib/queries/configuracion";
import ReporteDrawer from "@/components/reportes/ReporteDrawer";

const SUBTIPOS_ASEGURADORA: TipoReporte[] = [
  "comision_aseguradora",
  "produccion",
  "cancelaciones",
  "renovaciones",
  "chargebacks",
  "resumen_anual",
  "otro",
];

const ESTADOS_REPORTE: Record<string, string> = {
  subido: "Subido",
  extrayendo: "Extrayendo",
  extraido: "Extraído",
  matcheado: "Matcheado",
  cerrado: "Cerrado",
  error: "Error",
  bloqueado: "Bloqueado",
};

type ZoneKey = "aseguradora" | "venta";

interface ZoneMsg {
  tone: Tone;
  text: string;
}

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
      return { tone: "ok", label: "Cerrado", icon: <CheckCircle2 size={12} /> };
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

  const [aseguradoraSel, setAseguradoraSel] = useState("");
  const [altaAsegAbierta, setAltaAsegAbierta] = useState(false);
  const [nuevaAsegNombre, setNuevaAsegNombre] = useState("");
  const [creandoAseg, setCreandoAseg] = useState(false);
  const [periodoInput, setPeriodoInput] = useState("");
  const [subtipo, setSubtipo] = useState<TipoReporte>("comision_aseguradora");
  const [dragKey, setDragKey] = useState<ZoneKey | null>(null);
  const [zoneMsg, setZoneMsg] = useState<Partial<Record<ZoneKey, ZoneMsg>>>({});

  const [selectedReporte, setSelectedReporte] = useState<Reporte | null>(null);
  const [lineasComision, setLineasComision] = useState<LineaComision[]>([]);
  const [lineasVenta, setLineasVenta] = useState<LineaVenta[]>([]);
  const [bonoResumen, setBonoResumen] = useState<BonoResumen | null>(null);
  const [loadingLineas, setLoadingLineas] = useState(false);
  // último reporte pedido para la vista previa: descarta respuestas fuera de orden (ver abrirVistaPrevia)
  const solicitudLineasRef = useRef<string | null>(null);

  const zoneTimers = useRef<Partial<Record<ZoneKey, ReturnType<typeof setTimeout>>>>({});

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

  // Alta de aseguradora sin salir de esta pantalla. Ya se podía hacer desde Configuración, pero
  // enterrada en la pestaña "Plantillas por aseguradora": el momento en que hace falta es este,
  // cuando llega un statement de una compañía nueva y no está en la lista.
  async function crearAseguradoraInline() {
    const nombre = nuevaAsegNombre.trim();
    if (!nombre) return;
    setCreandoAseg(true);
    try {
      await crearAseguradora(nombre, "");
      const lista = await listAseguradoras();
      setAseguradoras(lista);
      // Queda elegida la recién creada, que es para lo que se la creó.
      const creada = lista.find((a) => a.nombre.toLowerCase() === nombre.toLowerCase());
      if (creada) setAseguradoraSel(creada.id);
      setNuevaAsegNombre("");
      setAltaAsegAbierta(false);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "No se pudo crear la aseguradora.");
    } finally {
      setCreandoAseg(false);
    }
  }

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

  function setZoneMessage(zone: ZoneKey, msg: ZoneMsg | null, autoClearMs?: number) {
    setZoneMsg((prev) => ({ ...prev, [zone]: msg ?? undefined }));
    const prevTimer = zoneTimers.current[zone];
    if (prevTimer) clearTimeout(prevTimer);
    if (msg && autoClearMs) {
      zoneTimers.current[zone] = setTimeout(() => {
        setZoneMsg((prev) => ({ ...prev, [zone]: undefined }));
      }, autoClearMs);
    }
  }

  async function subirArchivo(zone: ZoneKey, file: File, tipo: TipoReporte, aseguradoraId: string | null, periodo: string | null) {
    if (zone === "aseguradora" && !aseguradoraId) {
      setZoneMessage(zone, { tone: "bad", text: "Elegí la aseguradora antes de subir el archivo." }, 5000);
      return;
    }
    setZoneMessage(zone, { tone: "info", text: `Subiendo ${file.name}…` });
    try {
      await uploadReporte({ file, tipo, aseguradoraId, periodo });
      setZoneMessage(zone, { tone: "ok", text: `${file.name} subido — extrayendo…` }, 5000);
      if (zone === "aseguradora") setPeriodoInput("");
      refreshReportes();
    } catch (err) {
      if (err instanceof DuplicadoError) {
        setZoneMessage(zone, { tone: "bad", text: "Bloqueado — archivo idéntico ya subido." }, 8000);
      } else {
        setZoneMessage(
          zone,
          { tone: "bad", text: err instanceof Error ? err.message : "No se pudo subir el archivo." },
          8000
        );
      }
    }
  }

  function handleFiles(zone: ZoneKey, files: FileList | null, tipo: TipoReporte, aseguradoraId: string | null, periodo: string | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((f) => subirArchivo(zone, f, tipo, aseguradoraId, periodo));
  }

  function onDrop(e: DragEvent<HTMLDivElement>, zone: ZoneKey, tipo: TipoReporte, aseguradoraId: string | null, periodo: string | null) {
    e.preventDefault();
    setDragKey(null);
    handleFiles(zone, e.dataTransfer.files, tipo, aseguradoraId, periodo);
  }

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
  const subtipoOptions = SUBTIPOS_ASEGURADORA.map((t) => ({ value: t, label: TIPOS_REPORTE[t] }));
  const tipoFiltroOptions = Object.entries(TIPOS_REPORTE).map(([value, label]) => ({ value, label }));
  const estadoFiltroOptions = Object.entries(ESTADOS_REPORTE).map(([value, label]) => ({ value, label }));
  const gruposReportes = agruparReportesPorPeriodo(reportes);

  return (
    <div className="flex flex-col gap-7">
      {pageError && (
        <div className="flex items-center gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-3 text-[13px] text-bad-fg">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button type="button" onClick={() => setPageError(null)} aria-label="Cerrar" className="flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ZONAS DE CARGA */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* 1. Reporte de aseguradora */}
        <DropZone
          active={dragKey === "aseguradora"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragKey("aseguradora");
          }}
          onDragLeave={() => setDragKey(null)}
          onDrop={(e) => onDrop(e, "aseguradora", subtipo, aseguradoraSel || null, periodoInput.trim() || null)}
        >
          <ZoneHeader title="Reporte de aseguradora (comisiones)" />
          <Select
            options={aseguradoraOptions}
            placeholder="Aseguradora…"
            value={aseguradoraSel}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setAseguradoraSel(e.target.value)}
            className="h-8 bg-surface text-xs"
          />
          {altaAsegAbierta ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                value={nuevaAsegNombre}
                onChange={(e) => setNuevaAsegNombre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") crearAseguradoraInline();
                  if (e.key === "Escape") setAltaAsegAbierta(false);
                }}
                placeholder="Nombre (ej: Responsive)"
                autoFocus
                className="h-8 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground outline-none placeholder:text-muted"
              />
              <button
                type="button"
                onClick={crearAseguradoraInline}
                disabled={creandoAseg || !nuevaAsegNombre.trim()}
                className="h-8 rounded-lg bg-brand px-2.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {creandoAseg ? "…" : "Crear"}
              </button>
              <button
                type="button"
                onClick={() => setAltaAsegAbierta(false)}
                className="h-8 rounded-lg border border-border px-2.5 text-xs text-muted"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAltaAsegAbierta(true);
              }}
              className="self-start text-[11px] text-brand underline"
            >
              ¿No está tu aseguradora? Agregala
            </button>
          )}
          <Select
            options={subtipoOptions}
            value={subtipo}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSubtipo(e.target.value as TipoReporte)}
            className="h-8 bg-surface text-xs"
          />
          <Input
            icon={false}
            value={periodoInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPeriodoInput(e.target.value)}
            placeholder='Período (ej: "Agosto 2026")'
            className="h-8 bg-surface text-xs"
          />
          <ZoneFooter
            zone="aseguradora"
            hint="Arrastrá PDF, Excel o CSV"
            msg={zoneMsg.aseguradora}
            tipo={subtipo}
            aseguradoraId={aseguradoraSel || null}
            periodo={periodoInput.trim() || null}
            onFiles={handleFiles}
          />
        </DropZone>

        {/* 2. Reporte de ventas interno */}
        <DropZone
          active={dragKey === "venta"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragKey("venta");
          }}
          onDragLeave={() => setDragKey(null)}
          onDrop={(e) => onDrop(e, "venta", "venta_interna", null, null)}
        >
          <ZoneHeader title="Reporte de ventas interno" />
          <ZoneFooter
            zone="venta"
            hint="Arrastrá Excel o CSV del sistema interno de Jose"
            msg={zoneMsg.venta}
            tipo="venta_interna"
            aseguradoraId={null}
            periodo={null}
            onFiles={handleFiles}
          />
        </DropZone>
      </div>

      {/* CATÁLOGO */}
      <Card className="flex flex-col gap-3 overflow-hidden rounded-2xl! px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-brand" />
            <span className="text-sm font-semibold text-foreground">Reportes que acepta el sistema</span>
          </div>
          <span className="text-xs text-muted">Formatos: PDF · Excel · CSV — la IA lee cualquiera</span>
        </div>
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
      </Card>

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
                  {["Archivo", "Tipo", "Aseguradora", "Subido por", "Fecha", "Filas", "OK", "En excepción", "Estado del archivo"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={clsx(
                          "whitespace-nowrap border-b border-border px-5 py-3 text-left font-medium text-muted",
                          i >= 5 && i <= 7 && "text-right"
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
                        colSpan={9}
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
                          <td className="px-5 py-2.5 text-muted">{r.subido_por ? r.subido_por.slice(0, 8) : "—"}</td>
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

// =========================================================
// Subcomponentes de la página
// =========================================================

function DropZone({
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  active: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={clsx(
        "flex flex-col gap-3 rounded-2xl border-[1.5px] border-dashed bg-brand-tint p-5 transition",
        active ? "border-brand bg-brand-tint/80" : "border-brand-tint"
      )}
    >
      {children}
    </div>
  );
}

function ZoneHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <UploadCloud size={18} className="flex-shrink-0 text-brand" />
      <span className="text-[13px] font-semibold text-foreground">{title}</span>
    </div>
  );
}

function ZoneFooter({
  zone,
  hint,
  msg,
  tipo,
  aseguradoraId,
  periodo,
  onFiles,
}: {
  zone: ZoneKey;
  hint: string | null;
  msg: ZoneMsg | undefined;
  tipo: TipoReporte;
  aseguradoraId: string | null;
  periodo: string | null;
  onFiles: (zone: ZoneKey, files: FileList | null, tipo: TipoReporte, aseguradoraId: string | null, periodo: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {hint && <span className="text-xs text-muted">{hint}</span>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="self-start text-xs font-medium text-brand hover:text-brand-dark"
      >
        Explorar archivo…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
        multiple
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onFiles(zone, e.target.files, tipo, aseguradoraId, periodo);
          e.target.value = "";
        }}
      />
      {msg && (
        <span
          className={clsx(
            "rounded-md px-2 py-1 text-xs font-medium",
            msg.tone === "bad" && "bg-bad-bg text-bad-fg",
            msg.tone === "ok" && "bg-ok-bg text-ok-fg",
            msg.tone === "info" && "bg-info-bg text-info-fg",
            msg.tone === "neutral" && "bg-neutral-bg text-neutral-fg",
            msg.tone === "warn" && "bg-warn-bg text-warn-fg"
          )}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}

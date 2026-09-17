"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  UploadCloud,
  FileText,
  AlertTriangle,
  RefreshCw,
  Info,
  ArrowRight,
  Ban,
  Eye,
  X,
  Inbox,
} from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card, CardHead, EmptyState, Select, type Tone } from "@/components/ui";
import { fechaHora, money, pct, TIPOS_REPORTE, ESTADOS_LINEA } from "@/lib/format";
import {
  DuplicadoError,
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

const ESTADOS_VENTA_ABB: Record<string, { label: string; tone: Tone }> = {
  pendiente: { label: "Pendiente", tone: "neutral" },
  nuevo: { label: "Nuevo en el ABB", tone: "ok" },
  coincide: { label: "Coincide", tone: "ok" },
  conflicto: { label: "Conflicto", tone: "bad" },
};

type ZoneKey = "aseguradora" | "venta" | "bono" | "abb";

interface ZoneMsg {
  tone: Tone;
  text: string;
}

// Si la función de extracción muere sin escribir 'error' (crash, límite de wall-clock de la
// plataforma), el reporte queda para siempre en 'extrayendo'. Pasados unos minutos sin novedad
// lo tratamos como atascado y ofrecemos el mismo botón de reintentar que usa estado==='error'.
const MINUTOS_ATASCADO = 5;
function reporteAtascado(r: Reporte): boolean {
  if (r.estado !== "extrayendo") return false;
  const desde = new Date(r.updated_at ?? r.created_at).getTime();
  if (Number.isNaN(desde)) return false;
  return Date.now() - desde > MINUTOS_ATASCADO * 60 * 1000;
}

function estadoReporteBadge(r: Reporte): { tone: Tone; label: string } {
  const pend = r.total_excepciones ?? 0;
  switch (r.estado) {
    case "subido":
      return { tone: "neutral", label: "Subido" };
    case "extrayendo":
      return { tone: "info", label: "Extrayendo…" };
    case "extraido":
      return pend > 0
        ? { tone: "warn", label: `Extraído · revisar mapeo (${pend} pend.)` }
        : { tone: "ok", label: "Extraído" };
    case "matcheado":
      return pend > 0 ? { tone: "warn", label: `Matcheado · ${pend} pend.` } : { tone: "ok", label: "Matcheado" };
    case "cerrado":
      return { tone: "ok", label: "Cerrado" };
    case "error":
      return { tone: "bad", label: "Error" };
    case "bloqueado":
      return { tone: "bad", label: "Bloqueado" };
    default:
      return { tone: "neutral", label: r.estado };
  }
}

function isPreviewable(estado: Reporte["estado"]) {
  return estado === "extraido" || estado === "matcheado" || estado === "cerrado";
}

export default function SubirPage() {
  const [aseguradoras, setAseguradoras] = useState<Aseguradora[]>([]);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [loadingReportes, setLoadingReportes] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroAseguradora, setFiltroAseguradora] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  const [zoneAseguradoraSel, setZoneAseguradoraSel] = useState<Record<string, string>>({
    aseguradora: "",
    bono: "",
  });
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

  const [rawModal, setRawModal] = useState<{ titulo: string; datos: Record<string, unknown> | null } | null>(null);

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

  async function subirArchivo(zone: ZoneKey, file: File, tipo: TipoReporte, aseguradoraId: string | null) {
    if ((zone === "aseguradora" || zone === "bono") && !aseguradoraId) {
      setZoneMessage(zone, { tone: "bad", text: "Elegí la aseguradora antes de subir el archivo." }, 5000);
      return;
    }
    setZoneMessage(zone, { tone: "info", text: `Subiendo ${file.name}…` });
    try {
      await uploadReporte({ file, tipo, aseguradoraId });
      setZoneMessage(zone, { tone: "ok", text: `${file.name} subido — extrayendo…` }, 5000);
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

  function handleFiles(zone: ZoneKey, files: FileList | null, tipo: TipoReporte, aseguradoraId: string | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((f) => subirArchivo(zone, f, tipo, aseguradoraId));
  }

  function onDrop(e: DragEvent<HTMLDivElement>, zone: ZoneKey, tipo: TipoReporte, aseguradoraId: string | null) {
    e.preventDefault();
    setDragKey(null);
    handleFiles(zone, e.dataTransfer.files, tipo, aseguradoraId);
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

  const conflictosVenta = lineasVenta.filter((l) => l.estado_en_abb === "conflicto");

  return (
    <div className="flex flex-col gap-6">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Reporte de aseguradora */}
        <DropZone
          active={dragKey === "aseguradora"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragKey("aseguradora");
          }}
          onDragLeave={() => setDragKey(null)}
          onDrop={(e) => onDrop(e, "aseguradora", subtipo, zoneAseguradoraSel.aseguradora || null)}
        >
          <ZoneHeader title="Reporte de aseguradora (comisiones)" />
          <Select
            options={aseguradoraOptions}
            placeholder="Aseguradora…"
            value={zoneAseguradoraSel.aseguradora}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setZoneAseguradoraSel((prev) => ({ ...prev, aseguradora: e.target.value }))
            }
            className="h-8 bg-surface text-xs"
          />
          <Select
            options={subtipoOptions}
            value={subtipo}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSubtipo(e.target.value as TipoReporte)}
            className="h-8 bg-surface text-xs"
          />
          <ZoneFooter
            zone="aseguradora"
            hint="Arrastrá PDF, Excel o CSV"
            msg={zoneMsg.aseguradora}
            tipo={subtipo}
            aseguradoraId={zoneAseguradoraSel.aseguradora || null}
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
          onDrop={(e) => onDrop(e, "venta", "venta_interna", null)}
        >
          <ZoneHeader title="Reporte de ventas interno" />
          <ZoneFooter
            zone="venta"
            hint="Arrastrá Excel o CSV del sistema interno de Jose"
            msg={zoneMsg.venta}
            tipo="venta_interna"
            aseguradoraId={null}
            onFiles={handleFiles}
          />
        </DropZone>

        {/* 3. Statement de bono / contingencia */}
        <DropZone
          active={dragKey === "bono"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragKey("bono");
          }}
          onDragLeave={() => setDragKey(null)}
          onDrop={(e) => onDrop(e, "bono", "bono_contingencia", zoneAseguradoraSel.bono || null)}
        >
          <ZoneHeader title="Statement de bono / contingencia" />
          <Select
            options={aseguradoraOptions}
            placeholder="Aseguradora…"
            value={zoneAseguradoraSel.bono}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setZoneAseguradoraSel((prev) => ({ ...prev, bono: e.target.value }))
            }
            className="h-8 bg-surface text-xs"
          />
          <ZoneFooter
            zone="bono"
            hint="Arrastrá el archivo del statement"
            msg={zoneMsg.bono}
            tipo="bono_contingencia"
            aseguradoraId={zoneAseguradoraSel.bono || null}
            onFiles={handleFiles}
          />
        </DropZone>

        {/* 4. Actualizar ABB */}
        <DropZone
          active={dragKey === "abb"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragKey("abb");
          }}
          onDragLeave={() => setDragKey(null)}
          onDrop={(e) => onDrop(e, "abb", "actualizacion_abb", null)}
        >
          <ZoneHeader title="Actualizar Active Business Book (libro maestro)" />
          <span className="text-xs text-muted">Arrastrá el Excel/CSV con el libro completo de clientes y pólizas</span>
          <span className="text-xs text-brand-dark">
            Usalo solo si manejás el libro maestro aparte. Si se arma solo con Ventas internas + Altas manuales, no hace
            falta.
          </span>
          <ZoneFooter
            zone="abb"
            hint={null}
            msg={zoneMsg.abb}
            tipo="actualizacion_abb"
            aseguradoraId={null}
            onFiles={handleFiles}
          />
        </DropZone>
      </div>

      {/* CATÁLOGO */}
      <Card className="flex flex-col gap-2 px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-brand" />
            <span className="text-sm font-semibold text-foreground">Reportes que acepta el sistema</span>
          </div>
          <span className="text-xs text-muted">Formatos: PDF · Excel · CSV — la IA lee cualquiera</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-muted">Por aseguradora:</span>
          <Badge tone="info">Statement de comisiones</Badge>
          <Badge tone="info">Reporte de producción / nuevo negocio</Badge>
          <Badge tone="info">Book of business del carrier</Badge>
          <Badge tone="info">Cancelaciones y pendientes de cancelación</Badge>
          <Badge tone="info">Renovaciones</Badge>
          <Badge tone="info">Chargebacks y ajustes</Badge>
          <Badge tone="info">Bono / contingencia</Badge>
          <Badge tone="info">Resumen anual (1099)</Badge>
          <span className="ml-2 mr-0.5 text-xs text-muted">Internos:</span>
          <Badge tone="neutral">Reporte de ventas</Badge>
          <Badge tone="neutral">Active Business Book</Badge>
        </div>
      </Card>

      {/* TABLA DE ARCHIVOS */}
      <Card className="flex flex-col">
        <CardHead
          title="Archivos subidos"
          subtitle="La suma de “en excepción” de este lote no coincide necesariamente con los casos abiertos en Conciliación: esa cola acumula también statements de meses anteriores sin resolver."
          action={<Badge tone="neutral">{reportes.length} archivo{reportes.length === 1 ? "" : "s"}</Badge>}
        />
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-2.5">
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
            description="Subí un statement de aseguradora, un reporte de ventas o el libro maestro usando las zonas de arriba."
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
                          "whitespace-nowrap border-b border-border px-5 py-2.5 text-left font-medium text-muted",
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
                {reportes.map((r) => {
                  const badge = estadoReporteBadge(r);
                  const clickable = isPreviewable(r.estado);
                  const selected = selectedReporte?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => clickable && abrirVistaPrevia(r)}
                      className={clsx(
                        "border-b border-border last:border-b-0",
                        clickable && "cursor-pointer hover:bg-background",
                        selected && "bg-brand-tint"
                      )}
                    >
                      <td className="px-5 py-2 font-medium text-foreground">{r.nombre_archivo}</td>
                      <td className="px-5 py-2 text-muted">{TIPOS_REPORTE[r.tipo] ?? r.tipo}</td>
                      <td className="px-5 py-2">{r.aseguradora?.nombre ?? "—"}</td>
                      <td className="px-5 py-2 text-muted">{r.subido_por ? r.subido_por.slice(0, 8) : "—"}</td>
                      <td className="px-5 py-2 text-muted">{fechaHora(r.created_at)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_lineas}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_ok}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.estado === "subido" || r.estado === "extrayendo" ? "—" : r.total_excepciones}</td>
                      <td className="px-5 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={badge.tone} icon={r.estado === "bloqueado" ? <Ban size={12} /> : undefined}>
                            {badge.label}
                          </Badge>
                          {r.total_lineas > 0 && r.total_lineas - r.total_ok - r.total_excepciones > 0 && (
                            <span className="text-xs font-medium text-bad-fg">
                              ⚠ {r.total_lineas - r.total_ok - r.total_excepciones} fila
                              {r.total_lineas - r.total_ok - r.total_excepciones === 1 ? "" : "s"} sin cuadrar (ni OK ni en excepción)
                            </span>
                          )}
                          {(r.estado === "error" || reporteAtascado(r)) && (
                            <div className="flex flex-col gap-0.5">
                              {r.error ? (
                                <span className="text-xs text-bad-fg">{r.error}</span>
                              ) : (
                                reporteAtascado(r) && (
                                  <span className="text-xs text-bad-fg">La extracción no respondió a tiempo.</span>
                                )
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
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* VISTA PREVIA DE EXTRACCIÓN */}
      {selectedReporte && (
        <Card className="flex flex-col">
          <CardHead
            title={`Vista previa de extracción — ${selectedReporte.nombre_archivo}`}
            subtitle={
              <>
                {selectedReporte.aseguradora?.nombre ?? TIPOS_REPORTE[selectedReporte.tipo]}
                {selectedReporte.periodo ? ` · ${selectedReporte.periodo}` : ""}
              </>
            }
            action={
              <>
                {selectedReporte.confianza_promedio != null && (
                  <Badge tone="ok">Confianza promedio {pct(selectedReporte.confianza_promedio)}</Badge>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedReporte(null)}
                  aria-label="Cerrar vista previa"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-background"
                >
                  <X size={16} />
                </button>
              </>
            }
          />

          {selectedReporte.mapeo_columnas && Object.keys(selectedReporte.mapeo_columnas).length > 0 && (
            <div className="flex flex-col gap-1.5 px-5 pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Mapeo aprendido:</span>
                {Object.entries(selectedReporte.mapeo_columnas).map(([col, campo]) => (
                  <Badge key={col} tone="silver">
                    <span>{col}</span>
                    <ArrowRight size={12} />
                    <span>{campo}</span>
                  </Badge>
                ))}
              </div>
              {selectedReporte.columnas_detectadas && selectedReporte.columnas_detectadas.length > 0 && (
                <span className="text-xs text-muted">
                  Columnas detectadas: {selectedReporte.columnas_detectadas.join(", ")}
                </span>
              )}
            </div>
          )}

          {selectedReporte.resumen_ia && (
            <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-lg border border-brand-tint bg-brand-tint px-3.5 py-2.5 text-[13px] text-brand-dark">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>{selectedReporte.resumen_ia}</span>
            </div>
          )}

          {loadingLineas ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted">Cargando líneas extraídas…</div>
          ) : selectedReporte.tipo === "venta_interna" ? (
            <VentasTabla lineas={lineasVenta} onVerCrudo={(titulo, datos) => setRawModal({ titulo, datos })} />
          ) : selectedReporte.tipo === "bono_contingencia" ? (
            <BonoResumenTabla bono={bonoResumen} />
          ) : selectedReporte.tipo === "actualizacion_abb" ? (
            <div className="px-5 py-8 text-center text-[13px] text-muted">
              Este archivo actualiza el Active Business Book directamente (clientes y pólizas): no genera líneas de
              comisión para revisar acá. Mirá el resumen de arriba para ver cuántas pólizas se crearon o
              actualizaron.
            </div>
          ) : (
            <ComisionTabla lineas={lineasComision} onVerCrudo={(titulo, datos) => setRawModal({ titulo, datos })} />
          )}
        </Card>
      )}

      {/* CONFLICTOS DE REASIGNACIÓN */}
      {selectedReporte && selectedReporte.tipo === "venta_interna" && conflictosVenta.length > 0 && (
        <Card className="flex flex-col">
          <CardHead
            title={`Conflictos de reasignación — ${selectedReporte.nombre_archivo}`}
            action={<Badge tone="warn">{conflictosVenta.length} conflicto{conflictosVenta.length === 1 ? "" : "s"}</Badge>}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-background">
                  {["Agente reportado", "Oficina", "Cliente", "Póliza", "Aseguradora", "Fecha", "Prima", "Conflicto"].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {conflictosVenta.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-b-0">
                    <td className="px-3.5 py-2 font-medium text-foreground">{l.agente_nombre_crudo ?? "—"}</td>
                    <td className="px-3.5 py-2 text-muted">{l.oficina_nombre_crudo ?? "—"}</td>
                    <td className="px-3.5 py-2">{l.cliente_nombre_crudo ?? "—"}</td>
                    <td className="px-3.5 py-2">{l.numero_poliza ?? "—"}</td>
                    <td className="px-3.5 py-2 text-muted">{l.aseguradora_nombre_crudo ?? "—"}</td>
                    <td className="px-3.5 py-2 text-muted">{fechaHora(l.fecha_venta)}</td>
                    <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
                    <td className="px-3.5 py-2">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="text-xs text-muted">
                          Esta póliza ya figura asignada a otro agente en el Active Business Book.
                        </span>
                        <Button href="/comisiones/conciliacion" variant="secondary" size="sm">
                          Resolver en Conciliación
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {rawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setRawModal(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <h3 className="truncate text-[15px] font-semibold text-foreground">{rawModal.titulo}</h3>
              <button
                type="button"
                onClick={() => setRawModal(null)}
                aria-label="Cerrar"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-background"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
                {rawModal.datos ? JSON.stringify(rawModal.datos, null, 2) : "Sin datos crudos adicionales para esta fila."}
              </pre>
            </div>
          </div>
        </div>
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
        "flex flex-col gap-2 rounded-xl border-[1.5px] border-dashed bg-brand-tint p-4 transition",
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
  onFiles,
}: {
  zone: ZoneKey;
  hint: string | null;
  msg: ZoneMsg | undefined;
  tipo: TipoReporte;
  aseguradoraId: string | null;
  onFiles: (zone: ZoneKey, files: FileList | null, tipo: TipoReporte, aseguradoraId: string | null) => void;
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
          onFiles(zone, e.target.files, tipo, aseguradoraId);
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

function BonoResumenTabla({ bono }: { bono: BonoResumen | null }) {
  if (!bono) {
    return <div className="px-5 py-8 text-center text-[13px] text-muted">Todavía no hay un bono registrado para este archivo.</div>;
  }
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-semibold text-foreground">{money(bono.monto_total)}</span>
        <Badge tone="silver">{bono.estado}</Badge>
        {bono.periodo && <span className="text-muted">{bono.periodo}</span>}
      </div>
      {bono.reparto.length === 0 ? (
        <div className="text-[13px] text-muted">
          Este statement no traía detalle por productor: el monto total quedó cargado sin repartir por agente.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-background">
                {["Agente", "Monto", "Motivo", "Pagado"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bono.reparto.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-3.5 py-2 font-medium text-foreground">{r.agente ?? "—"}</td>
                  <td className="px-3.5 py-2 text-right tabular-nums">{money(r.monto)}</td>
                  <td className="px-3.5 py-2 text-muted">{r.motivo ?? "—"}</td>
                  <td className="px-3.5 py-2">
                    <Badge tone={r.pagado ? "ok" : "neutral"}>{r.pagado ? "Pagado" : "Pendiente"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ComisionTabla({
  lineas,
  onVerCrudo,
}: {
  lineas: LineaComision[];
  onVerCrudo: (titulo: string, datos: Record<string, unknown> | null) => void;
}) {
  if (lineas.length === 0) {
    return <div className="px-5 py-8 text-center text-[13px] text-muted">Todavía no hay líneas extraídas de este archivo.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="mt-1.5 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background">
            {["Fila", "Póliza", "Asegurado", "Tipo", "Prima", "Tasa", "Comisión", "Vigencia", "Productor (crudo)", "Confianza", "Estado"].map(
              (h) => (
                <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const estado = ESTADOS_LINEA[l.estado] ?? { label: l.estado, tone: "neutral" as Tone };
            return (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="px-3.5 py-2 font-medium text-foreground">Fila {l.fila ?? "—"}</td>
                <td className="px-3.5 py-2">{l.numero_poliza_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.nombre_asegurado_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.tipo_transaccion}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.tasa != null ? `${l.tasa}%` : "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.monto}</td>
                <td className="px-3.5 py-2 text-muted">{l.fecha_vigencia ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.productor_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.confianza != null ? pct(l.confianza) : "—"}</td>
                <td className="px-3.5 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    <button
                      type="button"
                      onClick={() => onVerCrudo(`Fila ${l.fila ?? "—"} — datos crudos`, l.campos_extra)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
                    >
                      <Eye size={12} />
                      Ver datos crudos completos de esta fila
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VentasTabla({
  lineas,
  onVerCrudo,
}: {
  lineas: LineaVenta[];
  onVerCrudo: (titulo: string, datos: Record<string, unknown> | null) => void;
}) {
  if (lineas.length === 0) {
    return <div className="px-5 py-8 text-center text-[13px] text-muted">Todavía no hay líneas extraídas de este archivo.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="mt-1.5 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background">
            {["Fila", "Agente", "Oficina", "Cliente", "Póliza", "Aseguradora", "Prima", "Confianza", "Estado"].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const estado = ESTADOS_VENTA_ABB[l.estado_en_abb] ?? { label: l.estado_en_abb, tone: "neutral" as Tone };
            return (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="px-3.5 py-2 font-medium text-foreground">Fila {l.fila ?? "—"}</td>
                <td className="px-3.5 py-2">{l.agente_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.oficina_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.cliente_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.numero_poliza ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.aseguradora_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.confianza != null ? pct(l.confianza) : "—"}</td>
                <td className="px-3.5 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    <button
                      type="button"
                      onClick={() => onVerCrudo(`Fila ${l.fila ?? "—"} — datos crudos`, l.campos_extra)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
                    >
                      <Eye size={12} />
                      Ver datos crudos completos de esta fila
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

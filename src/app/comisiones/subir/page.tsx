"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, AlertTriangle, RefreshCw, Ban, CheckCircle2, X, Inbox, GitCompare, Wallet, ChevronDown, Download } from "lucide-react";
import SubirReporteModal from "@/components/reportes/SubirReporteModal";
import clsx from "clsx";
import { Badge, Card, CardHead, EmptyState, Select, type Tone } from "@/components/ui";
import { fechaHora, money, TIPOS_REPORTE } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ClaveTexto, Idioma } from "@/lib/i18n/textos";
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

// El estado que ve el usuario, dicho en plata y no en jerga del sistema. Decía "Matcheado · 40
// pend." o "Extraído · revisar mapeo": palabras del motor, no de la agencia. Lo que hay que saber
// mirando la lista es una sola cosa — ¿este statement ya lo puedo pagar o todavía me falta algo?
//
// El número de pendientes salió de acá porque ya tiene su propia columna al lado: repetirlo hacía
// leer el mismo dato dos veces sin que la segunda agregara nada.
type Traducir = (c: ClaveTexto, v?: Record<string, string | number>) => string;

function estadoReporteBadge(r: Reporte, t: Traducir): { tone: Tone; label: string; icon?: ReactNode } {
  const pend = r.pendientes_reales ?? r.total_excepciones ?? 0;
  switch (r.estado) {
    case "subido":
    case "extrayendo":
      return { tone: "info", label: t("status.reading"), icon: <RefreshCw size={12} className="animate-spin" /> };
    case "extraido":
    case "matcheado":
      return pend > 0
        ? { tone: "warn", label: t("status.needsWork"), icon: <AlertTriangle size={12} /> }
        : { tone: "ok", label: t("status.readyToPay"), icon: <CheckCircle2 size={12} /> };
    case "cerrado":
      return { tone: "ok", label: t("status.closed"), icon: <CheckCircle2 size={12} /> };
    case "error":
      return { tone: "bad", label: t("status.failed"), icon: <AlertTriangle size={12} /> };
    case "bloqueado":
      return { tone: "bad", label: t("status.blocked"), icon: <Ban size={12} /> };
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

// El mes en palabras. Se arma con UTC a propósito: mes_statement viene como "2026-08-01" y si se
// interpreta en la zona horaria de Miami, esa fecha cae el 31 de julio a las 8 de la noche y el
// statement de agosto aparece etiquetado como julio.
function mesLabel(iso: string, idioma: Idioma = "en"): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const raw = d.toLocaleDateString(idioma === "es" ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Agrupa por el mes del statement, no por el texto del período: ese texto lo escribe la IA
// distinto cada vez ("Agosto 2026", "2026-08", "JULY 2026") y dos statements del mismo mes caían
// en encabezados separados. mes_statement ya viene interpretado por la base.
function agruparReportesPorPeriodo(
  lista: Reporte[],
  idioma: Idioma,
  sinMes: string
): { clave: string; reportes: Reporte[] }[] {
  const grupos = new Map<string, Reporte[]>();
  for (const r of lista) {
    const clave = r.mes_statement ? mesLabel(r.mes_statement, idioma) : sinMes;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(r);
  }
  return Array.from(grupos.entries()).map(([clave, reportes]) => ({ clave, reportes }));
}

export default function SubirPage() {
  const router = useRouter();
  const { t, idioma } = useI18n();
  const [aseguradoras, setAseguradoras] = useState<Aseguradora[]>([]);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [loadingReportes, setLoadingReportes] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroAseguradora, setFiltroAseguradora] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  // El mes es el filtro que de verdad se usa: "cuánto me pagaron en agosto". Los otros tres son
  // para buscar algo puntual. Por eso va primero y es el único que arranca con un valor puesto.
  const [filtroMes, setFiltroMes] = useState("");

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
          // El Active Business Book no es un statement: es el padrón de pólizas de la agencia. Vive
          // en Book of Business, que es donde se lo mira. Acá solo estorbaba — el usuario veía
          // "Septiembre 2026 · 2 archivos" y los dos eran el Book.
          familia: "statements",
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

  // Baja lo que se está viendo, con los mismos números de la pantalla. El contador lo exporta ya
  // resuelto (no el crudo de la fila) para que el Excel no contradiga lo que el usuario vio.
  function exportarCsv() {
    const encabezado = ["Carrier", "Statement", "Amount", "Lines", "Resolved", "Missing", "Status"];
    const filas = reportesVisibles.map((r) =>
      [
        r.aseguradora?.nombre ?? "",
        r.mes_statement ? mesLabel(r.mes_statement, idioma) : "",
        Number(r.monto_total ?? 0).toFixed(2),
        r.lineas_reales ?? 0,
        r.ok_reales ?? 0,
        r.pendientes_reales ?? 0,
        estadoReporteBadge(r, t).label,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [encabezado.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `statements-${filtroMes || "todos"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
  // Los filtros se arman con lo que de verdad hay cargado, no con el catálogo completo. El
  // desplegable ofrecía diez tipos de reporte — producción, cancelaciones, renovaciones, resumen
  // anual — cuando en la base solo existen statements de comisiones. Elegir uno de esos y no ver
  // nada no enseña nada; además esa lista se desactualiza sola cada vez que se agrega un tipo.
  const tipoFiltroOptions = useMemo(() => {
    const vistos = new Set(reportes.map((r) => r.tipo));
    return Array.from(vistos)
      .map((t) => ({ value: t, label: TIPOS_REPORTE[t] ?? t }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [reportes]);

  const estadoFiltroOptions = useMemo(() => {
    const vistos = new Set(reportes.map((r) => r.estado));
    return Array.from(vistos)
      .map((e) => ({ value: e, label: ESTADOS_REPORTE[e] ?? e }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [reportes]);
  // Los meses que de verdad tienen statements. Ofrecer meses vacíos del calendario hace que el
  // usuario elija uno, no vea nada, y no sepa si es que no hay o si algo se rompió.
  const mesesOptions = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const r of reportes) {
      if (r.mes_statement) vistos.set(r.mes_statement.slice(0, 10), mesLabel(r.mes_statement, idioma));
    }
    return Array.from(vistos, ([value, label]) => ({ value, label })).sort((a, b) =>
      b.value.localeCompare(a.value)
    );
  }, [reportes, idioma]);

  const reportesVisibles = useMemo(
    () => (filtroMes ? reportes.filter((r) => r.mes_statement?.slice(0, 10) === filtroMes) : reportes),
    [reportes, filtroMes]
  );

  // El total de arriba sigue al filtro. Un total que no cambia cuando cambiás el mes es un total
  // en el que no se puede confiar — pasó con el dashboard y no se repite acá.
  const resumen = useMemo(() => {
    let monto = 0;
    let faltan = 0;
    for (const r of reportesVisibles) {
      monto += Number(r.monto_total ?? 0);
      faltan += r.pendientes_reales ?? 0;
    }
    return { monto, faltan, n: reportesVisibles.length };
  }, [reportesVisibles]);

  const etiquetaMesActual = filtroMes
    ? mesesOptions.find((m) => m.value === filtroMes)?.label ?? ""
    : t("statements.allMonths").toLowerCase();

  const gruposReportes = agruparReportesPorPeriodo(reportesVisibles, idioma, t("statements.noMonth"));

  return (
    <div className="flex flex-col gap-4">
      {/* Conciliación y Liquidación salieron del menú lateral porque son pasos DE un statement, no
          secciones aparte. Se entra desde acá, que es donde el usuario ya está cuando las necesita:
          primero sube el statement, después resuelve lo que quedó sin identificar, y al final mira
          cuánto le toca a cada agente. El subtítulo dice para qué sirve cada una, porque los
          nombres solos no se lo dicen a alguien que no armó el sistema. */}
      {/* Los tres arrancan algo, así que van juntos en una fila. Subir estaba solo abajo, en una
          franja gris vacía que no hacía más que empujar la tabla fuera de la pantalla. Va tercero
          y en azul: es el único de los tres que crea algo nuevo. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link
          href="/comisiones/conciliacion/"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 transition-colors hover:bg-brand-tint/50"
        >
          <GitCompare className="h-5 w-5 flex-shrink-0 text-brand" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-foreground">{t("reconciliation.title")}</span>
            <span className="text-xs text-muted">{t("reconciliation.hint")}</span>
          </span>
        </Link>
        <Link
          href="/comisiones/liquidacion/"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 transition-colors hover:bg-brand-tint/50"
        >
          <Wallet className="h-5 w-5 flex-shrink-0 text-brand" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-foreground">{t("payout.title")}</span>
            <span className="text-xs text-muted">{t("payout.hint")}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setModalAbierto(true)}
          className="flex items-center gap-3 rounded-2xl bg-brand px-5 py-4 text-left transition-colors hover:bg-brand-dark"
        >
          <UploadCloud className="h-5 w-5 flex-shrink-0 text-white" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-white">{t("statements.upload")}</span>
            <span className="text-xs text-white/75">{t("statements.uploadHint")}</span>
          </span>
        </button>
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


      {/* CATÁLOGO: es documentación, no una herramienta — si un archivo no sirve, la ventana de
          subida lo avisa al elegirlo. Va plegado para no ocupar lugar en la vista principal. */}
      <details className="group/detalle">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-foreground">
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="underline decoration-dotted underline-offset-2">{t("statements.whatFiles")}</span>
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
        <CardHead title={t("statements.title")} subtitle={t("statements.subtitle")} />

        {/* El total va arriba de todo y en grande, como en Nextere: es lo primero que se busca y
            hasta ahora había que entrar archivo por archivo para saberlo. Sigue al filtro de mes,
            porque un total que no cambia cuando cambiás el mes no se puede usar para nada. */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">
              {t("statements.totalLabel", { mes: etiquetaMesActual })}
            </span>
            <span className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              {money(resumen.monto)}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[13px] text-muted">
              {t("statements.countLabel", { n: resumen.n, mes: etiquetaMesActual })}
            </span>
            {resumen.faltan > 0 && (
              <span className="text-[13px] font-medium text-warn-fg">
                {t("statements.missingLabel", { n: resumen.faltan })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3">
          <Select
            options={mesesOptions}
            placeholder={t("statements.allMonths")}
            value={filtroMes}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroMes(e.target.value)}
            className="w-44"
          />
          <Select
            options={tipoFiltroOptions}
            placeholder={t("statements.filterType")}
            value={filtroTipo}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroTipo(e.target.value)}
            className="w-44"
          />
          <Select
            options={aseguradoraOptions}
            placeholder={t("statements.allCarriers")}
            value={filtroAseguradora}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroAseguradora(e.target.value)}
            className="w-40"
          />
          <Select
            options={estadoFiltroOptions}
            placeholder={t("statements.filterStatus")}
            value={filtroEstado}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFiltroEstado(e.target.value)}
            className="w-44"
          />
          {/* Exportar vive con los filtros y no arriba a la derecha: es una acción sobre lo que
              estás mirando en este momento, no una acción principal. Al lado de "Subir statement"
              competía con él y no se distinguía cuál era cuál. */}
          <button
            type="button"
            onClick={exportarCsv}
            disabled={reportesVisibles.length === 0}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-background disabled:opacity-40"
          >
            <Download size={14} />
            {t("statements.export")}
          </button>
        </div>

        {loadingReportes ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">Cargando archivos…</div>
        ) : reportes.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={t("statements.empty")}
            description="Subí un statement de aseguradora o un reporte de ventas usando las zonas de arriba."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-background">
                  {/* El nombre del archivo salió de la tabla. "DetailedStatement20260924 (1).xlsx"
                      no le dice nada a nadie, y peor: dos statements de meses distintos se llaman
                      casi igual. Lo que identifica a un statement es de qué compañía es y de qué
                      mes. El nombre del archivo sigue estando en el panel de detalle. */}
                  {/* Cada columna dice de qué lado va en vez de que el código cuente posiciones.
                      Con el conteo, agregar Amount corrió todo: los encabezados seguían marcando
                      como numéricas las columnas 4 a 6 cuando ya eran la 2 a la 5, y los títulos
                      quedaron alineados al revés que sus propios números. */}
                  {[
                    { texto: t("col.carrier"), numerica: false },
                    { texto: t("col.statement"), numerica: false },
                    { texto: t("col.amount"), numerica: true },
                    { texto: t("col.missing"), numerica: true },
                    { texto: t("col.status"), numerica: false },
                  ].map(
                    ({ texto: h, numerica }) => (
                      <th
                        key={h}
                        className={clsx(
                          "whitespace-nowrap border-b border-border px-5 py-3 font-medium text-muted",
                          numerica ? "text-right" : "text-left"
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
                        colSpan={5}
                        className="border-t border-border px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted"
                      >
                        {grupo.clave} ·{" "}
                        {t("statements.groupCount", {
                          n: grupo.reportes.length,
                          s: grupo.reportes.length === 1 ? "" : "s",
                        })}
                      </td>
                    </tr>
                    {grupo.reportes.map((r) => {
                      const badge = estadoReporteBadge(r, t);
                      const clickable = isPreviewable(r.estado);
                      // Mientras se está leyendo el archivo los contadores no significan nada.
                      const leyendo = r.estado === "subido" || r.estado === "extrayendo";
                      const sinCuadrar =
                        r.lineas_reales - r.ok_reales - r.pendientes_reales - r.fuera_reales;
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
                          {/* La compañía es lo primero que se busca con el ojo al barrer la lista,
                              así que va primera y en negrita. Debajo, el tipo de papel, que casi
                              siempre dice "Statement de comisiones" y por eso no merece una columna
                              propia — solo importa cuando NO es eso. */}
                          <td className="px-5 py-2.5">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">{r.aseguradora?.nombre ?? "Sin compañía"}</span>
                              {r.tipo !== "comision_aseguradora" && (
                                <span className="text-[11px] text-muted">{TIPOS_REPORTE[r.tipo] ?? r.tipo}</span>
                              )}
                            </div>
                          </td>
                          {/* De qué mes es el statement. Cuando la IA no pudo leerle el período al
                              archivo se dice, en vez de inventar un mes: sin eso, el statement se
                              suma al mes equivocado y el total del dashboard deja de cuadrar. */}
                          <td className="px-5 py-2.5">
                            {r.mes_statement ? (
                              <span className="text-foreground">{mesLabel(r.mes_statement, idioma)}</span>
                            ) : (
                              <span className="text-warn-fg">Sin mes</span>
                            )}
                          </td>
                          {/* El monto es lo que se viene a buscar, así que va en negrita y alineado
                              a la derecha con los demás números: leer una columna de plata
                              desalineada obliga a comparar dígito por dígito. El nombre del archivo
                              y la fecha de subida quedan en el tooltip — existen, pero no ocupan
                              una columna que se mira todos los días. */}
                          <td
                            className="px-5 py-2.5 text-right font-medium tabular-nums text-foreground"
                            title={`${r.nombre_archivo} · ${fechaHora(r.created_at)}`}
                          >
                            {leyendo ? "—" : money(Number(r.monto_total ?? 0))}
                          </td>
                          {/* Los contadores salen de v_reportes, que los cuenta en el momento. Los
                              guardados en la fila envejecen: un statement resuelto seguía diciendo
                              "38 OK · 14 excepciones" cuando ya eran 52 OK y nada pendiente. */}
                          {/* Cuántas líneas trae y cuántas ya están resueltas salieron de acá: son
                              detalle de adentro del statement. Desde afuera lo único que hace falta
                              decidir es si hay trabajo pendiente o no, y eso lo dice "Missing". */}
                          <td className="px-5 py-2.5 text-right tabular-nums">
                            {leyendo ? (
                              "—"
                            ) : (r.pendientes_reales ?? 0) > 0 ? (
                              <span className="rounded-md bg-warn-bg px-2 py-0.5 font-medium text-warn-fg">
                                {r.pendientes_reales}
                              </span>
                            ) : (
                              <span className="text-muted">0</span>
                            )}
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex flex-col items-start gap-1">
                              <Badge tone={badge.tone} icon={badge.icon}>
                                {badge.label}
                              </Badge>
                              {/* El aviso de "sin cuadrar" desaparece solo: con los contadores
                                  calculados, OK + pendientes + fuera del statement siempre suma el
                                  total. Queda igual como red de seguridad por si algún día no. */}
                              {sinCuadrar > 0 && (
                                <span className="text-xs font-medium text-bad-fg">
                                  ⚠ {sinCuadrar} fila{sinCuadrar === 1 ? "" : "s"} sin cuadrar (ni OK ni pendiente)
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


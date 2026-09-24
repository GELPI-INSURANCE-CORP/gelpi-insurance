"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Check, ChevronDown, Download, Info, Pencil, RotateCcw } from "lucide-react";
import {
  Banner,
  Badge,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Input,
  Kpi,
  Loading,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@/components/agentes/ui";
import { money, fechaHora, TIPOS_REPORTE, TIPOS_TRANSACCION, ESTADOS_LINEA } from "@/lib/format";
import {
  getStatementDetalle,
  finalizarStatement,
  reabrirStatement,
  reasignarLinea,
  marcarLineaComoAjuste,
  CATEGORIAS_AJUSTE,
  type GrupoLinea,
  type LineaStatement,
  type StatementDetalle,
} from "@/lib/queries/statement";
import { listAgentes, resolverExcepcion, type AgenteSimple } from "@/lib/queries/conciliacion";
import { actualizarPeriodoReporte, reprocesarReporte, type Reporte } from "@/lib/queries/subir";

function StatementContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reporteId = searchParams.get("id");

  const [data, setData] = useState<StatementDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agentes, setAgentes] = useState<AgenteSimple[]>([]);

  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<"todas" | GrupoLinea>("todas");
  const [agenteFiltro, setAgenteFiltro] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<Record<string, string>>({});
  const [accionEnCursoId, setAccionEnCursoId] = useState<string | null>(null);

  const [asignandoLote, setAsignandoLote] = useState(false);
  const [bulkAgenteId, setBulkAgenteId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [cerrando, setCerrando] = useState(false);
  const [reprocesando, setReprocesando] = useState(false);

  // Corrección manual de una línea ya conciliada (ver reasignarLinea en queries/statement.ts)
  const [lineaACorregir, setLineaACorregir] = useState<LineaStatement | null>(null);
  const [correccionAgenteId, setCorreccionAgenteId] = useState("");
  const [correccionMotivo, setCorreccionMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);

  // Líneas que no son comisión de nadie: ajustes que la aseguradora le cobra a la agencia
  const [lineaAjuste, setLineaAjuste] = useState<LineaStatement | null>(null);
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [marcandoAjuste, setMarcandoAjuste] = useState(false);
  const [categoriaAjuste, setCategoriaAjuste] = useState("mvr");

  const cargar = useCallback(() => {
    if (!reporteId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getStatementDetalle(reporteId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el statement."))
      .finally(() => setLoading(false));
  }, [reporteId]);

  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    listAgentes()
      .then(setAgentes)
      .catch(() => setAgentes([]));
  }, []);

  // Lo que el usuario está mirando ahora mismo: el agente elegido y la búsqueda. Los tres números
  // de arriba y los contadores de los chips salen de acá y no del statement completo — si filtra
  // por Nadira, arriba tiene que decir lo de Nadira. Los chips de grupo quedan fuera a propósito:
  // esos eligen cuál de los tres números se está listando, así que no pueden además cambiarlos.
  const lineasDelAgente = useMemo(() => {
    if (!data) return [];
    let out = data.lineas;
    if (agenteFiltro) out = out.filter((l) => l.agenteId === agenteFiltro);
    const term = busqueda.trim().toLowerCase();
    if (term) {
      out = out.filter((l) => {
        const cliente = (l.cliente ?? l.clienteBook ?? "").toLowerCase();
        const poliza = (l.numeroPoliza ?? l.polizaBook ?? "").toLowerCase();
        return cliente.includes(term) || poliza.includes(term);
      });
    }
    return out;
  }, [data, agenteFiltro, busqueda]);

  const totales = useMemo(() => {
    const suma = (g: GrupoLinea) => lineasDelAgente.filter((l) => l.grupo === g).reduce((s, l) => s + l.monto, 0);
    const cuenta = (g: GrupoLinea) => lineasDelAgente.filter((l) => l.grupo === g).length;
    return {
      montoAprobado: suma("aprobado"),
      montoPendiente: suma("pendiente"),
      montoSinAsignar: suma("sin_asignar"),
      countAprobado: cuenta("aprobado"),
      countPendiente: cuenta("pendiente"),
      countSinAsignar: cuenta("sin_asignar"),
    };
  }, [lineasDelAgente]);

  const lineasFiltradas = useMemo(
    () => (filtro === "todas" ? lineasDelAgente : lineasDelAgente.filter((l) => l.grupo === filtro)),
    [lineasDelAgente, filtro]
  );

  const seleccionables = useMemo(() => lineasFiltradas.filter((l) => l.excepcionId), [lineasFiltradas]);

  // Solo los agentes que aparecen en este statement: ofrecer los 12 de la agencia cuando apenas 9
  // tienen líneas hace que elegir uno y no ver nada parezca un error de la pantalla.
  const agentesDelStatement = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, string>();
    for (const l of data.lineas) if (l.agenteId) m.set(l.agenteId, l.agente ?? "(sin nombre)");
    return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const nombreAgenteFiltro = agentesDelStatement.find((a) => a.value === agenteFiltro)?.label ?? "";

  const puedeConfirmarLote = useMemo(
    () => (data ? data.lineas.some((l) => selectedIds.has(l.id) && l.excepcionId && l.agenteSugeridoId) : false),
    [data, selectedIds]
  );

  const agentesOptions = agentes.map((a) => ({ value: a.id, label: a.nombre }));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === seleccionables.length && seleccionables.length > 0 ? new Set() : new Set(seleccionables.map((l) => l.id))
    );
  }

  async function confirmarLinea(l: LineaStatement) {
    if (!l.excepcionId) return;
    setAccionEnCursoId(l.excepcionId);
    try {
      await resolverExcepcion({ excepcionId: l.excepcionId, accion: "confirmar" });
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar la sugerencia.");
    } finally {
      setAccionEnCursoId(null);
    }
  }

  async function asignarLinea(l: LineaStatement, agenteId: string) {
    if (!l.excepcionId || !agenteId) return;
    setAccionEnCursoId(l.excepcionId);
    try {
      await resolverExcepcion({ excepcionId: l.excepcionId, accion: "asignar", agenteId });
      setAgenteSeleccionado((prev) => {
        const next = { ...prev };
        delete next[l.id];
        return next;
      });
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar el agente.");
    } finally {
      setAccionEnCursoId(null);
    }
  }

  async function confirmarSeleccionadas() {
    if (!data) return;
    const objetivo = data.lineas.filter((l) => selectedIds.has(l.id) && l.excepcionId && l.agenteSugeridoId);
    if (objetivo.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const l of objetivo) {
      try {
        await resolverExcepcion({ excepcionId: l.excepcionId!, accion: "confirmar" });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setError(fail > 0 ? `${ok} confirmada(s), ${fail} fallaron.` : null);
    cargar();
  }

  async function asignarSeleccionadas() {
    if (!data || !bulkAgenteId) return;
    const objetivo = data.lineas.filter((l) => selectedIds.has(l.id) && l.excepcionId);
    if (objetivo.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const l of objetivo) {
      try {
        await resolverExcepcion({ excepcionId: l.excepcionId!, accion: "asignar", agenteId: bulkAgenteId });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setAsignandoLote(false);
    setBulkAgenteId("");
    setSelectedIds(new Set());
    setError(fail > 0 ? `${ok} asignada(s), ${fail} fallaron.` : null);
    cargar();
  }

  function abrirAjuste(l: LineaStatement) {
    setLineaAjuste(l);
    // Se propone lo que el propio statement dice de esa fila: en el caso real venía como
    // "Unsold Adjustment", que es exactamente la explicación que hay que dejar anotada.
    setMotivoAjuste(l.cliente?.trim() || l.explicacion?.trim() || "");
    // Se propone la categoría leyendo lo que el propio statement dice de la fila: "Unsold
    // Adjustment" y "MVR" son cargos por correr reportes de vehículo de cotizaciones que no se
    // vendieron. Es una propuesta, no una decisión: el desplegable queda abierto para cambiarla.
    const texto = `${l.cliente ?? ""} ${l.explicacion ?? ""}`.toLowerCase();
    setCategoriaAjuste(/mvr|unsold|motor vehicle/.test(texto) ? "mvr" : "ajuste_aseguradora");
  }

  async function guardarAjuste() {
    if (!lineaAjuste?.excepcionId) return;
    setMarcandoAjuste(true);
    try {
      await marcarLineaComoAjuste({
        excepcionId: lineaAjuste.excepcionId,
        lineaId: lineaAjuste.id,
        categoria: categoriaAjuste,
        nota: motivoAjuste,
      });
      setLineaAjuste(null);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar la línea como ajuste de la agencia.");
    } finally {
      setMarcandoAjuste(false);
    }
  }

  function abrirCorreccion(l: LineaStatement) {
    setLineaACorregir(l);
    setCorreccionAgenteId(l.agenteId ?? "");
    setCorreccionMotivo("");
  }

  async function guardarCorreccion() {
    if (!lineaACorregir || !correccionAgenteId || !correccionMotivo.trim()) return;
    setCorrigiendo(true);
    try {
      await reasignarLinea({
        lineaId: lineaACorregir.id,
        polizaId: lineaACorregir.polizaId,
        agenteIdNuevo: correccionAgenteId,
        agenteAnterior: lineaACorregir.agente,
        agenteNuevo: agentes.find((a) => a.id === correccionAgenteId)?.nombre ?? "",
        motivo: correccionMotivo,
      });
      setLineaACorregir(null);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el agente.");
    } finally {
      setCorrigiendo(false);
    }
  }

  async function onFinalizar() {
    if (!data) return;
    setCerrando(true);
    try {
      await finalizarStatement(data.reporte.id);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo finalizar el statement.");
    } finally {
      setCerrando(false);
    }
  }

  async function onReabrir() {
    if (!data) return;
    setCerrando(true);
    try {
      await reabrirStatement(data.reporte.id);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reabrir el statement.");
    } finally {
      setCerrando(false);
    }
  }

  async function onReprocesar() {
    if (!data) return;
    const ok = window.confirm(
      `Esto borra las ${data.reporte.total_lineas || 0} línea(s) ya extraídas de "${data.reporte.nombre_archivo}" y vuelve a leer el archivo desde cero. ¿Continuar?`
    );
    if (!ok) return;
    setReprocesando(true);
    try {
      await reprocesarReporte(data.reporte.id);
      router.push("/comisiones/subir/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reprocesar el reporte.");
      setReprocesando(false);
    }
  }

  function exportarCsv() {
    if (!data) return;
    const header = ["Fila", "Póliza", "Cliente", "Tipo", "Prima", "Tasa", "Comisión", "Agente", "Estado"];
    const filas = lineasFiltradas.map((l) =>
      [
        l.fila ?? "",
        l.numeroPoliza ?? l.polizaBook ?? "",
        l.cliente ?? l.clienteBook ?? "",
        l.tipoTransaccion,
        l.prima ?? "",
        l.tasa ?? "",
        l.monto.toFixed(2),
        l.agente ?? "",
        ESTADOS_LINEA[l.estadoLinea]?.label ?? l.estadoLinea,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    const nombreBase = (data.reporte.periodo ?? data.reporte.nombre_archivo).replace(/[^A-Za-z0-9._-]+/g, "-");
    a.download = `statement-${nombreBase}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!reporteId) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState title="Falta el statement" subtitle="Volvé a Comisiones y hacé clic en un archivo para ver su detalle." />
      </div>
    );
  }

  if (loading && !data) {
    return <Loading />;
  }

  if (error && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="bad">{error}</Banner>
      </div>
    );
  }

  if (!data) return null;

  const { reporte } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/comisiones/subir/"
            title="Volver a Comisiones"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:bg-background hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">Detalle del statement</h1>
            <p className="text-xs text-muted truncate">{reporte.nombre_archivo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {reporte.estado === "cerrado" ? (
            <Button variant="secondary" onClick={onReabrir} disabled={cerrando}>
              {cerrando ? "Reabriendo…" : "Reabrir"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onFinalizar}
              disabled={cerrando || data.countPendiente > 0 || data.countSinAsignar > 0}
              title={
                data.countPendiente > 0 || data.countSinAsignar > 0
                  ? "Resolvé las líneas pendientes y sin asignar antes de finalizar."
                  : undefined
              }
            >
              <Check className="w-3.5 h-3.5" />
              {cerrando ? "Finalizando…" : "Finalizar"}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onReprocesar}
            disabled={reprocesando}
            title="Borra las líneas ya extraídas y vuelve a leer el archivo desde cero"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {reprocesando ? "Reprocesando…" : "Reprocesar"}
          </Button>
        </div>
      </div>

      {error && (
        <Banner tone="bad" action={<button type="button" className="text-xs underline" onClick={() => setError(null)}>Cerrar</button>}>
          {error}
        </Banner>
      )}

      {/* Cuando hay un agente elegido los tres números de abajo dejan de ser los del statement, así
          que se dice explícitamente: un total que cambia sin avisar por qué es un total en el que no
          se puede confiar. */}
      {agenteFiltro && (
        <Banner
          tone="info"
          action={
            <button type="button" className="text-xs underline" onClick={() => setAgenteFiltro("")}>
              Ver el statement completo
            </button>
          }
        >
          Mostrando solo las líneas de <strong>{nombreAgenteFiltro}</strong>. Los tres totales son de este agente.
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi
          label="Aprobado"
          value={money(totales.montoAprobado)}
          sub={`${totales.countAprobado} línea${totales.countAprobado === 1 ? "" : "s"} · ya tienen agente`}
          tone="ok"
          destacado
        />
        <Kpi
          label="Pendiente"
          value={money(totales.montoPendiente)}
          sub={`${totales.countPendiente} línea${totales.countPendiente === 1 ? "" : "s"} · necesitan una decisión`}
          tone="warn"
          destacado
        />
        <Kpi
          label="Sin asignar"
          value={money(totales.montoSinAsignar)}
          sub={`${totales.countSinAsignar} línea${totales.countSinAsignar === 1 ? "" : "s"} · el sistema no las reconoció`}
          tone="bad"
          destacado
        />
      </div>

      <Card className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Aseguradora:</span>
            <span className="font-medium text-foreground">{reporte.aseguradora?.nombre ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Período:</span>
            <PeriodoInline
              reporte={reporte}
              onActualizado={(periodo) =>
                setData((prev) => (prev ? { ...prev, reporte: { ...prev.reporte, periodo } } : prev))
              }
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Tipo:</span>
            <span className="font-medium text-foreground">{TIPOS_REPORTE[reporte.tipo] ?? reporte.tipo}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Fecha:</span>
            <span className="font-medium text-foreground">{fechaHora(reporte.created_at)}</span>
          </div>
          {/* El total del statement no es ninguno de los tres números de arriba: es lo que la
              aseguradora pagó en total. Sirve para cuadrar contra el cheque que llegó. */}
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Total del statement:</span>
            <span className="font-semibold tabular-nums text-foreground">
              {money(data.lineas.reduce((s, l) => s + l.monto, 0))}
            </span>
            <span className="text-muted">· {data.lineas.length} líneas</span>
          </div>
        </div>
        {/* El resumen de la IA es un párrafo largo que describe el archivo. Es útil una vez, cuando
            uno quiere entender qué leyó el sistema, pero ocupaba media pantalla arriba de las
            líneas — que es lo que uno viene a mirar todos los meses. Va plegado. Las advertencias
            (las que empiezan con ⚠) son la excepción: esas avisan que puede faltar algo, así que
            se muestran siempre y no se dejan esconder. */}
        {reporte.resumen_ia &&
          (reporte.resumen_ia.trim().startsWith("⚠") ? (
            <Banner tone="warn">{reporte.resumen_ia}</Banner>
          ) : (
            <details className="group/detalle">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-foreground">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="underline decoration-dotted underline-offset-2">Qué leyó el sistema de este archivo</span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/detalle:rotate-180" />
              </summary>
              <p className="mt-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted">
                {reporte.resumen_ia}
              </p>
            </details>
          ))}
      </Card>

      <Card className="flex flex-col">
        <CardHead
          title="Líneas del statement"
          subtitle={`${lineasFiltradas.length} de ${data.lineas.length} línea(s)${
            selectedIds.size > 0 ? ` · ${selectedIds.size} seleccionada(s)` : ""
          }`}
          actions={
            <>
              <Button size="sm" variant="secondary" disabled={!puedeConfirmarLote || bulkBusy} onClick={confirmarSeleccionadas}>
                Confirmar sugeridas
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={() => setAsignandoLote((v) => !v)}
              >
                Asignar agente a seleccionadas
              </Button>
              <Button size="sm" variant="ghost" onClick={exportarCsv} disabled={lineasFiltradas.length === 0}>
                <Download className="w-3.5 h-3.5" />
                Exportar a CSV
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
          <Input value={busqueda} onChange={setBusqueda} placeholder="Buscar por cliente o póliza…" className="w-64" />
          <Chip active={filtro === "todas"} onClick={() => setFiltro("todas")}>
            Todas ({lineasDelAgente.length})
          </Chip>
          <Chip active={filtro === "aprobado"} onClick={() => setFiltro("aprobado")}>
            Aprobadas ({totales.countAprobado})
          </Chip>
          <Chip active={filtro === "pendiente"} onClick={() => setFiltro("pendiente")}>
            Pendientes ({totales.countPendiente})
          </Chip>
          <Chip active={filtro === "sin_asignar"} onClick={() => setFiltro("sin_asignar")}>
            Sin asignar ({totales.countSinAsignar})
          </Chip>
          <div className="flex-1" />
          <span className="text-xs text-muted">Filtrar por agente:</span>
          <Select
            value={agenteFiltro}
            onChange={setAgenteFiltro}
            options={[{ value: "", label: "Todos los agentes" }, ...agentesDelStatement]}
            className="w-52"
          />
        </div>

        {asignandoLote && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/60 px-4 py-2.5">
            <span className="text-xs text-muted">Asignar a {selectedIds.size} seleccionada(s):</span>
            <Select
              value={bulkAgenteId}
              onChange={setBulkAgenteId}
              options={[{ value: "", label: "Elegí un agente" }, ...agentesOptions]}
              className="w-56"
            />
            <Button size="sm" variant="primary" disabled={!bulkAgenteId || bulkBusy} onClick={asignarSeleccionadas}>
              Aplicar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsignandoLote(false);
                setBulkAgenteId("");
              }}
            >
              Cancelar
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 w-9">
                  <input
                    type="checkbox"
                    checked={seleccionables.length > 0 && selectedIds.size === seleccionables.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-2.5 font-medium">Fila</th>
                <th className="px-4 py-2.5 font-medium">Póliza</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium text-right">Prima</th>
                <th className="px-4 py-2.5 font-medium text-right">%</th>
                <th className="px-4 py-2.5 font-medium text-right">Comisión</th>
                <th className="px-4 py-2.5 font-medium min-w-[160px]">Agente</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium min-w-[300px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lineasFiltradas.map((l) => (
                <FilaLinea
                  key={l.id}
                  l={l}
                  selected={selectedIds.has(l.id)}
                  onToggleSelected={toggleSelected}
                  agentesOptions={agentesOptions}
                  valorAsignar={agenteSeleccionado[l.id] ?? ""}
                  onCambiarAsignar={(id, v) => setAgenteSeleccionado((prev) => ({ ...prev, [id]: v }))}
                  enCurso={l.excepcionId != null && l.excepcionId === accionEnCursoId}
                  onConfirmar={confirmarLinea}
                  onAsignar={asignarLinea}
                  onCorregir={abrirCorreccion}
                  onMarcarAjuste={abrirAjuste}
                />
              ))}
            </tbody>
          </table>
          {loading && <Loading />}
          {!loading && lineasFiltradas.length === 0 && (
            <EmptyState title="Sin líneas" subtitle="No hay líneas que coincidan con estos filtros." />
          )}
        </div>
      </Card>

      <Modal
        open={lineaAjuste !== null}
        onClose={() => setLineaAjuste(null)}
        title="Marcar como ajuste de la agencia"
      >
        {lineaAjuste && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="rounded-lg bg-background px-3 py-2">
              <div className="font-medium text-foreground">{lineaAjuste.cliente ?? "(sin cliente)"}</div>
              <div className="text-muted">
                {lineaAjuste.numeroPoliza ?? "sin número de póliza"} · {money(lineaAjuste.monto)}
              </div>
            </div>
            <p className="text-muted">
              Esta línea deja de buscar agente y pasa a la <strong>cuenta de la agencia</strong>. Es para los
              ajustes que la aseguradora te cobra o te devuelve a vos, no a un agente. La línea{" "}
              <strong>no se borra</strong>: queda en el statement, con su monto, y suma en el total como plata de
              la casa.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-muted">¿Qué es este cargo?</span>
              <Select
                value={categoriaAjuste}
                onChange={setCategoriaAjuste}
                options={CATEGORIAS_AJUSTE.map((c) => ({ value: c.value, label: c.label }))}
              />
              <span className="text-xs text-muted">
                {CATEGORIAS_AJUSTE.find((c) => c.value === categoriaAjuste)?.ayuda}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Nota (opcional)</span>
              <TextArea
                value={motivoAjuste}
                onChange={(e) => setMotivoAjuste(e.target.value)}
                rows={2}
                placeholder="Ej: Unsold Adjustment"
              />
            </label>
            <p className="text-xs text-muted">
              La categoría queda guardada con la línea, no solo como texto: así se puede sacar después cuánto se
              pagó de MVR en el año, sumando por concepto.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setLineaAjuste(null)} disabled={marcandoAjuste}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={guardarAjuste} disabled={marcandoAjuste}>
                {marcandoAjuste ? "Guardando…" : "Marcar como ajuste"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={lineaACorregir !== null}
        onClose={() => setLineaACorregir(null)}
        title="Cambiar el agente de esta línea"
      >
        {lineaACorregir && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="rounded-lg bg-background px-3 py-2">
              <div className="font-medium text-foreground">
                {lineaACorregir.cliente ?? lineaACorregir.clienteBook ?? "—"}
              </div>
              <div className="text-muted">
                {lineaACorregir.numeroPoliza ?? lineaACorregir.polizaBook ?? "—"} · {money(lineaACorregir.monto)} ·
                hoy cobra <strong>{lineaACorregir.agente ?? "nadie"}</strong>
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Nuevo agente</span>
              <Select
                value={correccionAgenteId}
                onChange={setCorreccionAgenteId}
                options={[{ value: "", label: "Elegí un agente" }, ...agentesOptions]}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Motivo del cambio</span>
              <TextArea
                value={correccionMotivo}
                onChange={(e) => setCorreccionMotivo(e.target.value)}
                rows={2}
                placeholder="Ej: el cliente pasó a Marleny en julio"
              />
            </label>
            <p className="text-xs text-muted">
              El cambio también se guarda en el Book, así el mes que viene esta póliza ya sale con el agente
              correcto. Queda registrado quién lo cambió y por qué.
            </p>
            {lineaACorregir.polizaId === null && (
              <Banner tone="warn">
                Esta línea no está atada a una póliza del Book, así que la corrección vale solo para este mes.
              </Banner>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setLineaACorregir(null)} disabled={corrigiendo}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={guardarCorreccion}
                disabled={corrigiendo || !correccionAgenteId || !correccionMotivo.trim()}
              >
                {corrigiendo ? "Guardando…" : "Guardar cambio"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PeriodoInline({ reporte, onActualizado }: { reporte: Reporte; onActualizado: (periodo: string | null) => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(reporte.periodo ?? "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const nuevo = valor.trim() || null;
      await actualizarPeriodoReporte(reporte.id, nuevo);
      onActualizado(nuevo);
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => {
          setValor(reporte.periodo ?? "");
          setEditando(true);
        }}
        className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-brand"
      >
        {reporte.periodo ?? "Sin período"}
        <Pencil className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <TextInput
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder='Ej: "Agosto 2026"'
        className="h-8 w-40"
        autoFocus
      />
      <Button size="sm" variant="primary" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEditando(false)} disabled={guardando}>
        Cancelar
      </Button>
    </div>
  );
}

function FilaLinea({
  l,
  selected,
  onToggleSelected,
  agentesOptions,
  valorAsignar,
  onCambiarAsignar,
  enCurso,
  onConfirmar,
  onAsignar,
  onCorregir,
  onMarcarAjuste,
}: {
  l: LineaStatement;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  agentesOptions: { value: string; label: string }[];
  valorAsignar: string;
  onCambiarAsignar: (id: string, v: string) => void;
  enCurso: boolean;
  onConfirmar: (l: LineaStatement) => void;
  onAsignar: (l: LineaStatement, agenteId: string) => void;
  onCorregir: (l: LineaStatement) => void;
  onMarcarAjuste: (l: LineaStatement) => void;
}) {
  const estado = ESTADOS_LINEA[l.estadoLinea] ?? { label: l.estadoLinea, tone: "neutral" as const };
  return (
    <tr className={clsx("border-t border-border", selected && "bg-brand-tint/40")}>
      <td className="px-4 py-2.5">
        {l.excepcionId && <input type="checkbox" checked={selected} onChange={() => onToggleSelected(l.id)} />}
      </td>
      <td className="px-4 py-2.5 text-muted">{l.fila ?? "—"}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{l.numeroPoliza ?? l.polizaBook ?? "—"}</span>
          {l.polizaBook && l.numeroPoliza && l.polizaBook !== l.numeroPoliza && (
            <span className="text-[11px] text-muted">Book: {l.polizaBook}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">{l.cliente ?? l.clienteBook ?? "—"}</span>
          {l.clienteBook && l.cliente && l.clienteBook !== l.cliente && (
            <span className="text-[11px] text-muted">Book: {l.clienteBook}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-muted">{TIPOS_TRANSACCION[l.tipoTransaccion] ?? l.tipoTransaccion}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.prima != null ? money(l.prima) : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.tasa != null ? `${l.tasa}%` : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(l.monto)}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap text-foreground">{l.agente ?? "—"}</span>
          {l.oficina && <span className="text-[11px] text-muted">{l.oficina}</span>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Badge tone={estado.tone}>{estado.label}</Badge>
      </td>
      <td className="px-4 py-2.5">
        {l.excepcionId ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {l.agenteSugeridoId && (
              <Button
                size="sm"
                variant="primary"
                disabled={enCurso}
                onClick={() => onConfirmar(l)}
                title={`Confirmar a ${l.agenteSugerido ?? "agente sugerido"}`}
              >
                Confirmar
              </Button>
            )}
            <Select
              value={valorAsignar}
              onChange={(v) => onCambiarAsignar(l.id, v)}
              options={[{ value: "", label: "Asignar a…" }, ...agentesOptions]}
              className="h-8 w-44 text-xs"
            />
            <Button size="sm" variant="secondary" disabled={enCurso || !valorAsignar} onClick={() => onAsignar(l, valorAsignar)}>
              Asignar
            </Button>
            {/* Hay líneas que no son comisión de nadie: ajustes que la aseguradora le cobra a la
                agencia ("Unsold Adjustment"), cargos, devoluciones. Sin esta salida quedaban
                trabando el Finalizar para siempre, porque no hay agente a quien asignárselas. */}
            <Button
              size="sm"
              variant="ghost"
              disabled={enCurso}
              onClick={() => onMarcarAjuste(l)}
              title="No es comisión de ningún agente: va a la cuenta de la agencia"
            >
              No es de nadie
            </Button>
          </div>
        ) : (
          // Una línea ya conciliada también se puede corregir: el sistema acierta 3 de cada 4, y
          // en el resto a veces cree que acertó. Esa plata va al cheque de alguien.
          <Button size="sm" variant="ghost" onClick={() => onCorregir(l)} title="Cambiar el agente de esta línea">
            <Pencil className="w-3 h-3" />
            Cambiar
          </Button>
        )}
      </td>
    </tr>
  );
}

export default function StatementPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StatementContent />
    </Suspense>
  );
}

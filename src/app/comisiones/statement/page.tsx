"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Check, Download, Info, Pencil, RotateCcw } from "lucide-react";
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
  Select,
  TextInput,
} from "@/components/agentes/ui";
import { money, fechaHora, TIPOS_REPORTE, ESTADOS_LINEA } from "@/lib/format";
import {
  getStatementDetalle,
  finalizarStatement,
  reabrirStatement,
  type GrupoLinea,
  type LineaStatement,
  type StatementDetalle,
} from "@/lib/queries/statement";
import { listAgentes, resolverExcepcion, type AgenteSimple } from "@/lib/queries/conciliacion";
import { actualizarPeriodoReporte, reprocesarReporte, type Reporte } from "@/lib/queries/subir";

interface GrupoAgenteVista {
  agenteId: string;
  nombre: string;
  monto: number;
  lineas: number;
  filas: LineaStatement[];
}

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
  const [agrupar, setAgrupar] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<Record<string, string>>({});
  const [accionEnCursoId, setAccionEnCursoId] = useState<string | null>(null);

  const [asignandoLote, setAsignandoLote] = useState(false);
  const [bulkAgenteId, setBulkAgenteId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [cerrando, setCerrando] = useState(false);
  const [reprocesando, setReprocesando] = useState(false);

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

  const lineasFiltradas = useMemo(() => {
    if (!data) return [];
    let out = data.lineas;
    if (filtro !== "todas") out = out.filter((l) => l.grupo === filtro);
    const term = busqueda.trim().toLowerCase();
    if (term) {
      out = out.filter((l) => {
        const cliente = (l.cliente ?? l.clienteBook ?? "").toLowerCase();
        const poliza = (l.numeroPoliza ?? l.polizaBook ?? "").toLowerCase();
        return cliente.includes(term) || poliza.includes(term);
      });
    }
    return out;
  }, [data, filtro, busqueda]);

  const seleccionables = useMemo(() => lineasFiltradas.filter((l) => l.excepcionId), [lineasFiltradas]);

  const gruposAgente = useMemo<GrupoAgenteVista[]>(() => {
    if (!data) return [];
    const porAgenteLineas = new Map<string, LineaStatement[]>();
    const sinAgente: LineaStatement[] = [];
    for (const l of lineasFiltradas) {
      if (l.grupo === "aprobado" && l.agenteId) {
        const arr = porAgenteLineas.get(l.agenteId) ?? [];
        arr.push(l);
        porAgenteLineas.set(l.agenteId, arr);
      } else {
        sinAgente.push(l);
      }
    }
    // Los subtotales salen de las filas visibles, no de data.porAgente: con una búsqueda o un filtro
    // activo, un subtotal que no cuadre con las líneas que se ven debajo hace dudar de todos los
    // números de la pantalla.
    const grupos: GrupoAgenteVista[] = data.porAgente
      .filter((a) => porAgenteLineas.has(a.agenteId))
      .map((a) => {
        const filas = porAgenteLineas.get(a.agenteId) ?? [];
        return {
          agenteId: a.agenteId,
          nombre: a.nombre,
          monto: filas.reduce((s, l) => s + l.monto, 0),
          lineas: filas.length,
          filas,
        };
      });
    if (sinAgente.length > 0) {
      grupos.push({
        agenteId: "__sin_agente__",
        nombre: "Sin agente",
        monto: sinAgente.reduce((s, l) => s + l.monto, 0),
        lineas: sinAgente.length,
        filas: sinAgente,
      });
    }
    return grupos;
  }, [data, lineasFiltradas]);

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi
          label="Aprobado"
          value={money(data.montoAprobado)}
          sub={`${data.countAprobado} línea${data.countAprobado === 1 ? "" : "s"} · ya tienen agente`}
          tone="ok"
        />
        <Kpi
          label="Pendiente"
          value={money(data.montoPendiente)}
          sub={`${data.countPendiente} línea${data.countPendiente === 1 ? "" : "s"} · necesitan una decisión`}
          tone="warn"
        />
        <Kpi
          label="Sin asignar"
          value={money(data.montoSinAsignar)}
          sub={`${data.countSinAsignar} línea${data.countSinAsignar === 1 ? "" : "s"} · el sistema no las reconoció`}
          tone="bad"
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
        </div>
        {reporte.resumen_ia &&
          (reporte.resumen_ia.trim().startsWith("⚠") ? (
            <Banner tone="warn">{reporte.resumen_ia}</Banner>
          ) : (
            <div className="flex items-start gap-2 text-[13px] text-muted">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{reporte.resumen_ia}</span>
            </div>
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
            Todas ({data.lineas.length})
          </Chip>
          <Chip active={filtro === "aprobado"} onClick={() => setFiltro("aprobado")}>
            Aprobadas ({data.countAprobado})
          </Chip>
          <Chip active={filtro === "pendiente"} onClick={() => setFiltro("pendiente")}>
            Pendientes ({data.countPendiente})
          </Chip>
          <Chip active={filtro === "sin_asignar"} onClick={() => setFiltro("sin_asignar")}>
            Sin asignar ({data.countSinAsignar})
          </Chip>
          <div className="flex-1" />
          <Chip active={agrupar} onClick={() => setAgrupar((v) => !v)}>
            Agrupar por agente
          </Chip>
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
          <table className="w-full min-w-[1100px] text-[13px]">
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
                <th className="px-4 py-2.5 font-medium text-right">Tasa</th>
                <th className="px-4 py-2.5 font-medium text-right">Comisión</th>
                <th className="px-4 py-2.5 font-medium">Agente</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {agrupar
                ? gruposAgente.map((g) => (
                    <Fragment key={g.agenteId}>
                      <tr className="border-t border-border bg-background/60">
                        <td colSpan={11} className="px-4 py-2 text-xs font-semibold text-foreground">
                          {g.nombre} · {g.lineas} línea{g.lineas === 1 ? "" : "s"} · {money(g.monto)}
                        </td>
                      </tr>
                      {g.filas.map((l) => (
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
                        />
                      ))}
                    </Fragment>
                  ))
                : lineasFiltradas.map((l) => (
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
      <td className="px-4 py-2.5 text-muted capitalize">{l.tipoTransaccion}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.prima != null ? money(l.prima) : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.tasa != null ? `${l.tasa}%` : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(l.monto)}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">{l.agente ?? "—"}</span>
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
              className="h-8 text-xs w-32"
            />
            <Button size="sm" variant="secondary" disabled={enCurso || !valorAsignar} onClick={() => onAsignar(l, valorAsignar)}>
              Asignar
            </Button>
          </div>
        ) : (
          <span className="text-muted">—</span>
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

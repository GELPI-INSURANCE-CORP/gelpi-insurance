"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Search as SearchIcon,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Input,
  Kpi,
  Select,
  Tabs,
  type TabItem,
} from "@/components/ui";
import { money, fecha, pct, RAMOS } from "@/lib/format";
import {
  buscarPolizas,
  candidatosComoConflicto,
  countsByTipo,
  exportExcepcionesCsv,
  getExcepcionDetalle,
  listAgentes,
  listAseguradoras,
  listExcepciones,
  listOficinas,
  resolverExcepcion,
  resumenKpisExcepciones,
  type AgenteSimple,
  type AseguradoraSimple,
  type ConteosPorTipo,
  type ExcepcionDetalle,
  type ExcepcionRow,
  type FiltrosExcepciones,
  type OficinaSimple,
  type PolizaCandidata,
  type ResumenKpis,
  type TipoExcepcion,
} from "@/lib/queries/conciliacion";

const RAMO_KEYS = Object.keys(RAMOS).filter((k) => k !== "otro");

const TIPO_BADGE: Record<TipoExcepcion, { label: string; tone: "warn" | "bad" | "silver" | "info" }> = {
  mismatch: { label: "Mismatch", tone: "warn" },
  sin_identificar: { label: "Sin identificar", tone: "bad" },
  duplicado: { label: "Duplicado sospechoso", tone: "silver" },
  conflicto_venta: { label: "Conflicto de venta", tone: "info" },
};

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// =========================================================
// Textarea sencillo (no hay componente Textarea en la ui-kit)
// =========================================================
function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground outline-none placeholder:text-muted focus:border-brand"
    />
  );
}

function AiNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-brand/20 bg-brand-tint px-3 py-2.5 text-[12px] leading-relaxed text-brand-dark">
      <Bot size={15} className="mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-[12px]">
      <span className="text-muted">{label}: </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function ConciliacionContent() {
  const searchParams = useSearchParams();
  const agenteUrl = searchParams.get("agente") ?? "";
  const oficinaUrl = searchParams.get("oficina") ?? "";
  const buscarUrl = searchParams.get("buscar") ?? "";
  const excepcionUrl = searchParams.get("excepcion");

  // ----- datos base -----
  const [rows, setRows] = useState<ExcepcionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<ConteosPorTipo>({ todas: 0, mismatch: 0, sin_identificar: 0, duplicado: 0, conflicto_venta: 0 });
  const [kpis, setKpis] = useState<ResumenKpis>({
    sin_identificar: { monto: 0, n: 0 },
    mismatch: { monto: 0, n: 0 },
    duplicado: { monto: 0, n: 0 },
    total: { monto: 0, n: 0 },
  });
  const [agentes, setAgentes] = useState<AgenteSimple[]>([]);
  const [oficinas, setOficinas] = useState<OficinaSimple[]>([]);
  const [aseguradoras, setAseguradoras] = useState<AseguradoraSimple[]>([]);
  const [catalogosError, setCatalogosError] = useState<string | null>(null);
  const [kpisError, setKpisError] = useState<string | null>(null);

  // ----- filtros (inicializados desde el deep-link: ?agente=, ?oficina=, ?buscar=) -----
  const [tab, setTab] = useState<"todas" | TipoExcepcion>("todas");
  const [buscarTexto, setBuscarTexto] = useState(buscarUrl);
  const [buscarDebounced, setBuscarDebounced] = useState(buscarUrl);
  const [aseguradoraId, setAseguradoraId] = useState("");
  const [oficinaId, setOficinaId] = useState(oficinaUrl);
  const [agenteId, setAgenteId] = useState(agenteUrl);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [montoMin, setMontoMin] = useState("");
  const [soloAtrasadas, setSoloAtrasadas] = useState(false);
  const [ramo, setRamo] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(() => Boolean(agenteUrl || oficinaUrl || buscarUrl));
  const filtrosActivos = [buscarTexto, aseguradoraId, oficinaId, agenteId, desde, hasta, montoMin, ramo].filter(Boolean).length + (soloAtrasadas ? 1 : 0);
  const limpiarFiltros = () => {
    setBuscarTexto(""); setAseguradoraId(""); setOficinaId(""); setAgenteId("");
    setDesde(""); setHasta(""); setMontoMin(""); setSoloAtrasadas(false); setRamo("");
  };

  const debouncedSetBuscar = useMemo(() => debounce((v: string) => setBuscarDebounced(v), 350), []);
  useEffect(() => {
    debouncedSetBuscar(buscarTexto);
  }, [buscarTexto, debouncedSetBuscar]);

  // ----- mini box flotante (posición anclada a la fila que se clickeó) -----
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // ----- selección -----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [asignandoLote, setAsignandoLote] = useState(false);
  const [agenteLote, setAgenteLote] = useState("");
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExcepcionDetalle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ----- panel: estado de formularios de acción -----
  const [motivo, setMotivo] = useState("");
  const [showReasignar, setShowReasignar] = useState(false);
  const [reasignarAgente, setReasignarAgente] = useState("");
  const [reasignarOficina, setReasignarOficina] = useState("");
  const [candidatoElegido, setCandidatoElegido] = useState(0);
  const [busquedaPoliza, setBusquedaPoliza] = useState("");
  const [resultadosPoliza, setResultadosPoliza] = useState<PolizaCandidata[]>([]);
  const [buscandoPoliza, setBuscandoPoliza] = useState(false);
  const [polizaElegida, setPolizaElegida] = useState<PolizaCandidata | null>(null);
  const [agenteParaPoliza, setAgenteParaPoliza] = useState("");
  const [showCrearPoliza, setShowCrearPoliza] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ nombre: "", telefono: "", email: "", numero_poliza: "", ramo: "auto" });
  const [agenteNuevaPoliza, setAgenteNuevaPoliza] = useState("");
  const [agenteDirecto, setAgenteDirecto] = useState("");
  const [accionEnCurso, setAccionEnCurso] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  // ----- buscador de póliza: descarta respuestas fuera de orden / de una excepción ya no activa -----
  const busquedaPolizaRef = useRef<string>("");

  // ----- toast -----
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ----- catálogos -----
  const cargarCatalogos = useCallback(() => {
    setCatalogosError(null);
    Promise.all([listAgentes(), listOficinas(), listAseguradoras()])
      .then(([a, o, s]) => {
        setAgentes(a);
        setOficinas(o);
        setAseguradoras(s);
      })
      .catch((e: unknown) =>
        setCatalogosError(e instanceof Error ? e.message : "No se pudieron cargar agentes/oficinas/aseguradoras.")
      );
  }, []);

  useEffect(() => {
    cargarCatalogos();
  }, [cargarCatalogos]);

  const refreshCountsYKpis = useCallback(() => {
    setKpisError(null);
    countsByTipo()
      .then(setCounts)
      .catch((e: unknown) => setKpisError(e instanceof Error ? e.message : "No se pudieron calcular los contadores."));
    resumenKpisExcepciones()
      .then(setKpis)
      .catch((e: unknown) => setKpisError(e instanceof Error ? e.message : "No se pudieron calcular los KPI."));
  }, []);

  useEffect(() => {
    refreshCountsYKpis();
  }, [refreshCountsYKpis]);

  // ----- listado principal -----
  const filtros: FiltrosExcepciones = useMemo(
    () => ({
      tipo: tab === "todas" ? undefined : tab,
      aseguradoraId: aseguradoraId || undefined,
      oficinaId: oficinaId || undefined,
      agenteId: agenteId || undefined,
      ramo: ramo || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
      montoMin: montoMin ? Number(montoMin) : undefined,
      soloAtrasadas: soloAtrasadas || undefined,
      buscar: buscarDebounced || undefined,
    }),
    [tab, aseguradoraId, oficinaId, agenteId, ramo, desde, hasta, montoMin, soloAtrasadas, buscarDebounced]
  );

  const cargarLista = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listExcepciones(filtros)
      .then((data) => setRows(data))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "No se pudo cargar la cola de conciliación."))
      .finally(() => setLoading(false));
  }, [filtros]);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  // ----- cargar detalle al seleccionar fila -----
  const cargarDetalle = useCallback((id: string) => {
    setActiveId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setMotivo("");
    setShowReasignar(false);
    setReasignarAgente("");
    setReasignarOficina("");
    setCandidatoElegido(0);
    setBusquedaPoliza("");
    busquedaPolizaRef.current = "";
    setResultadosPoliza([]);
    setPolizaElegida(null);
    setAgenteParaPoliza("");
    setShowCrearPoliza(false);
    setNuevoCliente({ nombre: "", telefono: "", email: "", numero_poliza: "", ramo: "auto" });
    setAgenteNuevaPoliza("");
    setAgenteDirecto("");
    setAccionError(null);
    getExcepcionDetalle(id)
      .then(setDetail)
      .catch((e: unknown) => setDetailError(e instanceof Error ? e.message : "No se pudo cargar el detalle."))
      .finally(() => setDetailLoading(false));
  }, []);

  function closePanel() {
    setActiveId(null);
    setDetail(null);
    setPopoverPos(null);
  }

  const MINI_BOX_WIDTH = 420;
  const MINI_BOX_MARGIN = 16;

  // Posición fija y predecible (no pegada a la fila donde se hizo clic): con una tabla
  // larga, anclar al punto exacto del clic hacía que la caja se cortara o quedara
  // perdida cerca del borde de la pantalla cuando la fila estaba abajo del todo.
  function posicionMiniBoxFija() {
    return { top: 88, left: Math.max(MINI_BOX_MARGIN, window.innerWidth - MINI_BOX_WIDTH - MINI_BOX_MARGIN) };
  }

  function abrirMiniBox(id: string) {
    setPopoverPos(posicionMiniBoxFija());
    cargarDetalle(id);
  }

  // ----- deep-link: ?excepcion=<id> abre el panel directo (viene de AgenteFicha "Ver en Conciliación") -----
  useEffect(() => {
    if (excepcionUrl) {
      setPopoverPos(posicionMiniBoxFija());
      cargarDetalle(excepcionUrl);
    }
    // Solo al montar: es un deep-link de entrada, no debe reabrirse si excepcionUrl cambia por otra causa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  // ----- después de resolver -----
  function despuesDeResolver(idResuelta: string) {
    setRows((prev) => prev.filter((r) => r.id !== idResuelta));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(idResuelta);
      return next;
    });
    refreshCountsYKpis();
    if (activeId === idResuelta) closePanel();
  }

  async function ejecutarAccion(params: Parameters<typeof resolverExcepcion>[0], mensajeExito: string) {
    setAccionEnCurso(true);
    setAccionError(null);
    try {
      await resolverExcepcion(params);
      showToast(mensajeExito);
      despuesDeResolver(params.excepcionId);
    } catch (e) {
      setAccionError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setAccionEnCurso(false);
    }
  }

  async function resolverMasivo() {
    const idsAConfirmar = rows.filter((r) => selectedIds.has(r.id) && r.tipo === "mismatch" && r.agente_sugerido_id);
    if (idsAConfirmar.length === 0) {
      showToast("No hay mismatch con sugerencia entre las filas seleccionadas.");
      return;
    }
    setAccionEnCurso(true);
    let ok = 0;
    let fail = 0;
    for (const r of idsAConfirmar) {
      try {
        await resolverExcepcion({ excepcionId: r.id, accion: "confirmar" });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setAccionEnCurso(false);
    setRows((prev) => prev.filter((r) => !idsAConfirmar.some((x) => x.id === r.id) || fail > 0 && !idsAConfirmar.map((x) => x.id).includes(r.id)));
    cargarLista();
    refreshCountsYKpis();
    setSelectedIds(new Set());
    showToast(`${ok} confirmadas${fail > 0 ? `, ${fail} fallaron` : ""}.`);
  }

  // ----- confirmar 1 fila con un clic (mismatch con sugerencia ya calculada) -----
  function confirmarFila(id: string) {
    ejecutarAccion({ excepcionId: id, accion: "confirmar" }, "Sugerencia confirmada.");
  }

  // ----- asignar un agente elegido a todas las filas seleccionadas que lo admiten -----
  async function asignarAgenteLote() {
    if (!agenteLote) return;
    const asignables = rows.filter((r) => selectedIds.has(r.id) && (r.tipo === "mismatch" || r.tipo === "sin_identificar"));
    const omitidas = rows.filter((r) => selectedIds.has(r.id)).length - asignables.length;
    if (asignables.length === 0) {
      showToast("Ninguna de las filas seleccionadas admite asignar agente (solo mismatch o sin identificar).");
      return;
    }
    setAplicandoLote(true);
    let ok = 0;
    let fail = 0;
    for (const r of asignables) {
      try {
        await resolverExcepcion({ excepcionId: r.id, accion: "asignar", agenteId: agenteLote });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setAplicandoLote(false);
    setAsignandoLote(false);
    setAgenteLote("");
    cargarLista();
    refreshCountsYKpis();
    setSelectedIds(new Set());
    showToast(
      `${ok} asignadas${fail > 0 ? `, ${fail} fallaron` : ""}${omitidas > 0 ? `, ${omitidas} omitidas (tipo no soportado)` : ""}.`
    );
  }

  // ----- buscador de póliza (sin_identificar): debounced y descarta respuestas fuera de orden -----
  const buscarPolizaDebounced = useMemo(
    () =>
      debounce((q: string) => {
        setBuscandoPoliza(true);
        buscarPolizas(q)
          .then((data) => {
            if (busquedaPolizaRef.current === q) setResultadosPoliza(data);
          })
          .catch(() => {
            if (busquedaPolizaRef.current === q) setResultadosPoliza([]);
          })
          .finally(() => {
            if (busquedaPolizaRef.current === q) setBuscandoPoliza(false);
          });
      }, 300),
    []
  );

  function buscarPolizaAhora(q: string) {
    setBusquedaPoliza(q);
    busquedaPolizaRef.current = q; // se actualiza sincrónicamente: la respuesta se descarta si ya no coincide
    if (q.trim().length < 2) {
      setResultadosPoliza([]);
      return;
    }
    buscarPolizaDebounced(q);
  }

  // ----- KPI click → cambia tab -----
  function irATab(t: "todas" | TipoExcepcion) {
    setTab(t);
  }

  const tabItems: TabItem[] = [
    { key: "todas", label: "Todas", count: counts.todas, tone: "brand" },
    { key: "mismatch", label: "Mismatch", count: counts.mismatch, tone: "warn" },
    { key: "sin_identificar", label: "Sin identificar", count: counts.sin_identificar, tone: "bad" },
    { key: "duplicado", label: "Duplicados sospechosos", count: counts.duplicado, tone: "neutral" },
    { key: "conflicto_venta", label: "Conflictos de venta", count: counts.conflicto_venta, tone: "info" },
  ];

  const agenteOptions = agentes.map((a) => ({ value: a.id, label: a.nombre }));
  const oficinaOptions = oficinas.map((o) => ({ value: o.id, label: o.nombre }));
  const aseguradoraOptions = aseguradoras.map((a) => ({ value: a.id, label: a.nombre }));
  const ramoOptions = RAMO_KEYS.map((r) => ({ value: r, label: RAMOS[r] }));

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden p-8">
      {toast && (
        <div className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg border border-ok-fg/30 bg-ok-bg px-4 py-2.5 text-[13px] font-medium text-ok-fg shadow-lg">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}

      {(catalogosError || kpisError) && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3 rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-2.5 text-[13px] text-bad-fg">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span className="flex-1">
            {catalogosError && "No se pudieron cargar agentes/oficinas/aseguradoras. Los selectores de reasignación pueden aparecer vacíos."}
            {catalogosError && kpisError && " "}
            {kpisError && "No se pudieron calcular los contadores/KPI de excepciones (pueden mostrar 0 sin que signifique que no hay pendientes)."}
          </span>
          {catalogosError && (
            <button type="button" onClick={cargarCatalogos} className="font-semibold underline underline-offset-2">
              Reintentar catálogos
            </button>
          )}
          {kpisError && (
            <button type="button" onClick={refreshCountsYKpis} className="font-semibold underline underline-offset-2">
              Reintentar KPI
            </button>
          )}
        </div>
      )}

      {/* KPI CHIPS */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Sin identificar"
          value={money(kpis.sin_identificar.monto)}
          sub={`${kpis.sin_identificar.n} líneas`}
          subTone="bad"
          onClick={() => irATab("sin_identificar")}
          highlighted={tab === "sin_identificar"}
        />
        <Kpi
          label="Mismatch"
          value={money(kpis.mismatch.monto)}
          sub={`${kpis.mismatch.n} líneas`}
          subTone="warn"
          onClick={() => irATab("mismatch")}
        />
        <Kpi
          label="Duplicados sospechosos"
          value={money(kpis.duplicado.monto)}
          sub={`${kpis.duplicado.n} casos`}
          subTone="muted"
          onClick={() => irATab("duplicado")}
        />
        <Kpi
          label="Total en disputa"
          value={money(kpis.total.monto)}
          sub={`${kpis.total.n} casos abiertos`}
          subTone="bad"
          onClick={() => irATab("todas")}
        />
      </div>

      {/* TOOLBAR: TABS + FILTROS */}
      <Card className="flex-shrink-0">
        <Tabs
          items={tabItems}
          active={tab}
          onChange={(k) => setTab(k as typeof tab)}
          trailing={
            <>
              {filtrosActivos > 0 && (
                <button type="button" onClick={limpiarFiltros} className="text-[12px] text-muted hover:text-foreground">
                  Limpiar
                </button>
              )}
              <Button
                variant={filtrosAbiertos || filtrosActivos > 0 ? "primary" : "secondary"}
                size="sm"
                onClick={() => setFiltrosAbiertos((v) => !v)}
              >
                <SlidersHorizontal size={14} />
                Filtros
                {filtrosActivos > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-semibold">
                    {filtrosActivos}
                  </span>
                )}
              </Button>
            </>
          }
        />
        {filtrosAbiertos && (
        <div className="flex flex-col gap-2.5 border-b border-border bg-background/60 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              icon={<SearchIcon size={14} className="flex-shrink-0 text-muted" />}
              placeholder="Buscar por póliza, cliente o agente…"
              value={buscarTexto}
              onChange={(e) => setBuscarTexto(e.target.value)}
              className="w-64"
            />
            <Select
              options={aseguradoraOptions}
              placeholder="Aseguradora: Todas"
              value={aseguradoraId}
              onChange={(e) => setAseguradoraId(e.target.value)}
              className="w-44"
            />
            <Select
              options={oficinaOptions}
              placeholder="Oficina: Todas"
              value={oficinaId}
              onChange={(e) => setOficinaId(e.target.value)}
              className="w-44"
            />
            <Select
              options={agenteOptions}
              placeholder="Agente: Todos"
              value={agenteId}
              onChange={(e) => setAgenteId(e.target.value)}
              className="w-44"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none focus:border-brand"
              />
              <ArrowRight size={12} className="text-muted" />
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none focus:border-brand"
              />
            </div>
            <input
              type="number"
              min={0}
              placeholder="Monto mín."
              value={montoMin}
              onChange={(e) => setMontoMin(e.target.value)}
              className="h-9 w-28 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-brand"
            />
            <Chip active={soloAtrasadas} onClick={() => setSoloAtrasadas((v) => !v)} icon={<AlertTriangle size={13} />}>
              Solo atrasadas
            </Chip>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 flex-shrink-0 text-[12px] text-muted">Ramo:</span>
            <Chip active={ramo === ""} onClick={() => setRamo("")}>
              Todos
            </Chip>
            {ramoOptions.map((r) => (
              <Chip key={r.value} active={ramo === r.value} onClick={() => setRamo(r.value)}>
                {r.label}
              </Chip>
            ))}
          </div>
        </div>
        )}
      </Card>

      {/* TABLA — a todo el ancho; el detalle se abre como caja flotante anclada a la fila */}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CardHead
            title="Excepciones abiertas"
            action={
              <>
                <span className="text-xs text-muted">{selectedIds.size} seleccionadas</span>
                <Button variant="secondary" size="sm" disabled={selectedIds.size === 0 || accionEnCurso} onClick={resolverMasivo}>
                  Confirmar sugeridas
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedIds.size === 0 || aplicandoLote}
                  onClick={() => setAsignandoLote((v) => !v)}
                >
                  Asignar agente…
                </Button>
                <Button variant="ghost" size="sm" onClick={() => exportExcepcionesCsv(rows)} disabled={rows.length === 0}>
                  <Download size={14} />
                  Exportar cola a Excel
                </Button>
              </>
            }
          />
          {asignandoLote && (
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-background/60 px-5 py-3">
              <span className="text-[12px] text-muted">Asignar a {selectedIds.size} seleccionadas:</span>
              <Select
                options={agenteOptions}
                placeholder="Elegí un agente"
                value={agenteLote}
                onChange={(e) => setAgenteLote(e.target.value)}
                className="w-56"
              />
              <Button variant="primary" size="sm" disabled={!agenteLote || aplicandoLote} onClick={asignarAgenteLote}>
                Aplicar a {selectedIds.size} seleccionadas
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setAsignandoLote(false); setAgenteLote(""); }}>
                Cancelar
              </Button>
              <span className="text-[11px] text-muted">Solo aplica a mismatch y sin identificar; el resto se omite.</span>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center py-16">
                <Loader2 className="animate-spin text-brand" size={22} />
              </div>
            ) : loadError ? (
              <div className="p-6 text-[13px] text-bad-fg">{loadError}</div>
            ) : rows.length === 0 ? (
              <EmptyState
                title="No hay excepciones pendientes"
                description="No quedan casos que coincidan con estos filtros. Probá con otro tab o limpiá los filtros."
              />
            ) : (
              <table className="w-full min-w-[1200px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="w-9 px-3 py-2.5">
                      <input type="checkbox" checked={selectedIds.size === rows.length && rows.length > 0} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-2 py-2.5">Tipo</th>
                    <th className="px-2 py-2.5">Aseguradora</th>
                    <th className="px-2 py-2.5">N° póliza</th>
                    <th className="px-2 py-2.5">Nombre en el reporte</th>
                    <th className="px-2 py-2.5">Monto</th>
                    <th className="px-2 py-2.5">Oficina sugerida (score)</th>
                    <th className="px-2 py-2.5">Agente sugerido (score)</th>
                    <th className="px-2 py-2.5">Fecha statement</th>
                    <th className="px-2 py-2.5">Antigüedad</th>
                    <th className="px-2 py-2.5">Estado</th>
                    <th className="px-2 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const badge = TIPO_BADGE[r.tipo];
                    const nota =
                      r.regla_match === "fuzzy" && r.score != null
                        ? "coincidencia parcial"
                        : r.regla_match === "sin_candidato"
                          ? "no está en el ABB"
                          : null;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => abrirMiniBox(r.id)}
                        className={`cursor-pointer border-b border-border last:border-0 hover:bg-background ${
                          activeId === r.id ? "bg-brand-tint" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
                        </td>
                        <td className="px-2 py-2.5">
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{r.aseguradora ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{r.numero_poliza_crudo ?? "—"}</span>
                            {nota && <span className="text-[11px] text-muted">{nota}</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{r.nombre_asegurado_crudo ?? "—"}</span>
                            {r.productor_crudo && <span className="text-[11px] text-muted">Productor: {r.productor_crudo}</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 font-medium text-foreground">{money(r.monto)}</td>
                        <td className="px-2 py-2.5">
                          {r.oficina_sugerida ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-foreground">{r.oficina_sugerida}</span>
                              <span className="text-[11px] text-muted">{pct(r.score)}</span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          {r.agente_sugerido ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-foreground">{r.agente_sugerido}</span>
                              <span className="text-[11px] text-muted">{pct(r.score)}</span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-muted">{fecha(r.fecha_statement)}</td>
                        <td className="px-2 py-2.5 text-muted">{r.antiguedad_dias ?? 0} días</td>
                        <td className="px-2 py-2.5">
                          {r.atrasada ? (
                            <Badge tone="bad" icon={<AlertTriangle size={11} />}>
                              Atrasada
                            </Badge>
                          ) : (
                            <Badge tone="neutral">Pendiente</Badge>
                          )}
                        </td>
                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {r.tipo === "mismatch" && r.agente_sugerido_id ? (
                            <button
                              type="button"
                              title={`Confirmar a ${r.agente_sugerido ?? "agente sugerido"}`}
                              onClick={() => confirmarFila(r.id)}
                              disabled={accionEnCurso}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-ok-fg/30 bg-ok-bg text-ok-fg hover:opacity-80 disabled:opacity-50"
                            >
                              <Check size={14} />
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {/* MINI BOX flotante — anclada a la fila que se clickeó, en vez de un panel fijo */}
      {popoverPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={closePanel} />
          <div
            className="fixed z-50 flex w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            style={{ top: popoverPos.top, left: popoverPos.left, maxHeight: `calc(100vh - ${popoverPos.top + 16}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="flex items-center justify-center p-10">
                <Loader2 className="animate-spin text-brand" size={22} />
              </div>
            ) : detailError ? (
              <div className="p-5 text-center text-[13px] text-bad-fg">{detailError}</div>
            ) : detail ? (
              <PanelResolucion
                detail={detail}
                agentes={agentes}
                oficinas={oficinas}
                motivo={motivo}
                setMotivo={setMotivo}
                showReasignar={showReasignar}
                setShowReasignar={setShowReasignar}
                reasignarAgente={reasignarAgente}
                setReasignarAgente={setReasignarAgente}
                reasignarOficina={reasignarOficina}
                setReasignarOficina={setReasignarOficina}
                candidatoElegido={candidatoElegido}
                setCandidatoElegido={setCandidatoElegido}
                busquedaPoliza={busquedaPoliza}
                onBuscarPoliza={buscarPolizaAhora}
                resultadosPoliza={resultadosPoliza}
                buscandoPoliza={buscandoPoliza}
                polizaElegida={polizaElegida}
                setPolizaElegida={setPolizaElegida}
                agenteParaPoliza={agenteParaPoliza}
                setAgenteParaPoliza={setAgenteParaPoliza}
                showCrearPoliza={showCrearPoliza}
                setShowCrearPoliza={setShowCrearPoliza}
                nuevoCliente={nuevoCliente}
                setNuevoCliente={setNuevoCliente}
                agenteNuevaPoliza={agenteNuevaPoliza}
                setAgenteNuevaPoliza={setAgenteNuevaPoliza}
                agenteDirecto={agenteDirecto}
                setAgenteDirecto={setAgenteDirecto}
                accionEnCurso={accionEnCurso}
                accionError={accionError}
                ejecutarAccion={ejecutarAccion}
                onClose={closePanel}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function ConciliacionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="animate-spin text-brand" size={22} />
        </div>
      }
    >
      <ConciliacionContent />
    </Suspense>
  );
}

// =========================================================
// Panel de resolución
// =========================================================

interface PanelProps {
  detail: ExcepcionDetalle;
  agentes: AgenteSimple[];
  oficinas: OficinaSimple[];
  motivo: string;
  setMotivo: (v: string) => void;
  showReasignar: boolean;
  setShowReasignar: (v: boolean) => void;
  reasignarAgente: string;
  setReasignarAgente: (v: string) => void;
  reasignarOficina: string;
  setReasignarOficina: (v: string) => void;
  candidatoElegido: number;
  setCandidatoElegido: (v: number) => void;
  busquedaPoliza: string;
  onBuscarPoliza: (q: string) => void;
  resultadosPoliza: PolizaCandidata[];
  buscandoPoliza: boolean;
  polizaElegida: PolizaCandidata | null;
  setPolizaElegida: (p: PolizaCandidata | null) => void;
  agenteParaPoliza: string;
  setAgenteParaPoliza: (v: string) => void;
  showCrearPoliza: boolean;
  setShowCrearPoliza: (v: boolean) => void;
  nuevoCliente: { nombre: string; telefono: string; email: string; numero_poliza: string; ramo: string };
  setNuevoCliente: (v: { nombre: string; telefono: string; email: string; numero_poliza: string; ramo: string }) => void;
  agenteNuevaPoliza: string;
  setAgenteNuevaPoliza: (v: string) => void;
  agenteDirecto: string;
  setAgenteDirecto: (v: string) => void;
  accionEnCurso: boolean;
  accionError: string | null;
  ejecutarAccion: (params: Parameters<typeof resolverExcepcion>[0], mensaje: string) => Promise<void>;
  onClose: () => void;
}

function PanelResolucion(p: PanelProps) {
  const { excepcion, lineaComision, candidatos, polizaCandidata, lineaRelacionada, agenteActualNombre, agenteReclamadoNombre } = p.detail;
  const badge = TIPO_BADGE[excepcion.tipo];
  const agenteOptions = p.agentes.map((a) => ({ value: a.id, label: a.nombre }));
  const oficinaOptions = p.oficinas.map((o) => ({ value: o.id, label: o.nombre }));
  const ramoOptions = RAMO_KEYS.map((r) => ({ value: r, label: RAMOS[r] }));

  const candidatoActivo = candidatos[p.candidatoElegido] ?? candidatos[0] ?? null;
  // "Confirmar sugerencia" solo es válido si lineas_comision.agente_id ya quedó persistido (auto-match, score>=90 y un solo
  // candidato) — eso es exactamente excepcion.agente_sugerido_id. Si no, aunque el candidato #0 esté preseleccionado en el
  // JSON, hay que ir por la rama "asignar" (igual que "Usar este candidato"), o resolver_excepcion revienta con
  // "No hay sugerencia para confirmar".
  const esCandidatoSugerido = p.candidatoElegido === 0 && Boolean(excepcion.agente_sugerido_id);

  const footer = (
    <div className="flex flex-col gap-2">
      {p.accionError && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[12px] text-bad-fg">{p.accionError}</div>}

      {excepcion.tipo === "mismatch" && !p.showReasignar && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={p.accionEnCurso || !candidatoActivo}
            onClick={() =>
              esCandidatoSugerido
                ? p.ejecutarAccion({ excepcionId: excepcion.id, accion: "confirmar" }, "Sugerencia confirmada.")
                : p.ejecutarAccion(
                    {
                      excepcionId: excepcion.id,
                      accion: "asignar",
                      agenteId: candidatoActivo?.agente_id ?? null,
                      oficinaId: candidatoActivo?.oficina_id ?? null,
                      polizaId: candidatoActivo?.poliza_id ?? null,
                      motivo: p.motivo || null,
                    },
                    "Candidato asignado."
                  )
            }
          >
            {esCandidatoSugerido ? "Confirmar sugerencia" : "Usar este candidato"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => p.setShowReasignar(true)}>
            Reasignar a otro agente/oficina
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={p.accionEnCurso}
            onClick={() => p.ejecutarAccion({ excepcionId: excepcion.id, accion: "cuenta_casa" }, "Marcada como cuenta de la casa.")}
          >
            Marcar como cuenta de la casa (Jose)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={p.accionEnCurso}
            onClick={() => p.ejecutarAccion({ excepcionId: excepcion.id, accion: "pendiente", motivo: p.motivo || null }, "Guardada como pendiente.")}
          >
            Descartar / Investigar más tarde
          </Button>
        </div>
      )}

      {excepcion.tipo === "mismatch" && p.showReasignar && (
        <div className="flex flex-col gap-2">
          <Select options={agenteOptions} placeholder="Agente" value={p.reasignarAgente} onChange={(e) => p.setReasignarAgente(e.target.value)} />
          <Select options={oficinaOptions} placeholder="Oficina (opcional)" value={p.reasignarOficina} onChange={(e) => p.setReasignarOficina(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={p.accionEnCurso || !p.reasignarAgente || !p.motivo.trim()}
              onClick={() =>
                p.ejecutarAccion(
                  {
                    excepcionId: excepcion.id,
                    accion: "reasignar",
                    agenteId: p.reasignarAgente,
                    oficinaId: p.reasignarOficina || null,
                    motivo: p.motivo,
                  },
                  "Línea reasignada."
                )
              }
            >
              Confirmar reasignación
            </Button>
            <Button variant="ghost" size="sm" onClick={() => p.setShowReasignar(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {excepcion.tipo === "sin_identificar" && (
        <SinIdentificarAcciones p={p} agenteOptions={agenteOptions} ramoOptions={ramoOptions} />
      )}

      {excepcion.tipo === "duplicado" && (
        <div className="grid grid-cols-1 gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={p.accionEnCurso}
            onClick={() => p.ejecutarAccion({ excepcionId: excepcion.id, accion: "descartar_duplicado" }, "Duplicado descartado.")}
          >
            Descartar duplicado
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={p.accionEnCurso}
            onClick={() => p.ejecutarAccion({ excepcionId: excepcion.id, accion: "mantener_ambas" }, "Se mantienen ambas líneas.")}
          >
            Mantener ambas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={p.accionEnCurso}
            onClick={() => p.ejecutarAccion({ excepcionId: excepcion.id, accion: "reclasificar_ajuste" }, "Reclasificada como ajuste.")}
          >
            Es un ajuste
          </Button>
        </div>
      )}

      {excepcion.tipo === "conflicto_venta" && (
        <div className="grid grid-cols-1 gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={p.accionEnCurso || !candidatosComoConflicto(excepcion.candidatos).agente_actual}
            onClick={() =>
              p.ejecutarAccion(
                { excepcionId: excepcion.id, accion: "elegir_dueno", agenteId: candidatosComoConflicto(excepcion.candidatos).agente_actual },
                "Dueño confirmado: el agente actual del ABB."
              )
            }
          >
            Elegir a {agenteActualNombre ?? "agente actual del ABB"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={p.accionEnCurso || !candidatosComoConflicto(excepcion.candidatos).agente_reclamado}
            onClick={() =>
              p.ejecutarAccion(
                { excepcionId: excepcion.id, accion: "elegir_dueno", agenteId: candidatosComoConflicto(excepcion.candidatos).agente_reclamado },
                "Dueño confirmado: el agente reclamado por la venta."
              )
            }
          >
            Elegir a {agenteReclamadoNombre ?? "agente reclamado"}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-[14px] font-semibold text-foreground">Resolver excepción — {badge.label}</h3>
        <button type="button" onClick={p.onClose} className="rounded p-1 text-muted hover:bg-background hover:text-foreground">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
      <div className="flex flex-col gap-3.5">
        <div className="text-[13px] text-muted">
          {excepcion.aseguradora ?? "Sin aseguradora"} · Póliza {excepcion.numero_poliza_crudo ?? excepcion.venta_poliza ?? "—"} · {money(excepcion.monto)} · Statement{" "}
          {fecha(excepcion.fecha_statement)}
        </div>
        <div className="h-px bg-border" />

        {excepcion.tipo !== "conflicto_venta" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-semibold text-foreground">En el reporte de la aseguradora</div>
              <FieldRow label="Productor del reporte" value={excepcion.productor_crudo ?? "—"} />
              <FieldRow label="Monto" value={money(excepcion.monto)} />
              <FieldRow label="Prima" value={lineaComision?.prima != null ? money(lineaComision.prima) : "—"} />
              <FieldRow label="Tasa" value={lineaComision?.tasa != null ? `${lineaComision.tasa}%` : "—"} />
              <FieldRow label="Vigencia" value={fecha(lineaComision?.fecha_vigencia)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                Candidato en el ABB
                {excepcion.score != null && <Badge tone="brand">{pct(excepcion.score)}</Badge>}
              </div>
              {polizaCandidata ? (
                <>
                  <FieldRow label="Cliente" value={polizaCandidata.cliente ?? "—"} />
                  <FieldRow label="Agente" value={polizaCandidata.agente ?? "Sin agente"} />
                  <FieldRow label="Oficina" value={polizaCandidata.oficina ?? "Sin oficina"} />
                  <FieldRow label="Vigencia" value={fecha(polizaCandidata.fecha_vigencia)} />
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="text-muted">Estado:</span>
                    <Badge tone={polizaCandidata.estado === "activa" ? "ok" : "neutral"}>{polizaCandidata.estado}</Badge>
                  </div>
                </>
              ) : (
                <span className="text-[12px] text-muted">No hay candidato en el ABB.</span>
              )}
            </div>
          </div>
        )}

        {excepcion.tipo === "conflicto_venta" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-semibold text-foreground">Agente actual en el ABB</div>
              <span className="text-[13px] font-medium text-foreground">{agenteActualNombre ?? "—"}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-semibold text-foreground">Agente reclamado por la venta</div>
              <span className="text-[13px] font-medium text-foreground">{agenteReclamadoNombre ?? excepcion.venta_agente ?? "—"}</span>
              <span className="text-[11px] text-muted">Cliente: {excepcion.venta_cliente ?? "—"}</span>
            </div>
          </div>
        )}

        {excepcion.tipo === "duplicado" && lineaComision && (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <div className="text-[13px] font-medium text-foreground">
              {lineaComision.nombre_asegurado_crudo ?? "Asegurado sin nombre"} · Póliza {lineaComision.numero_poliza_crudo ?? "—"}
            </div>
            <div className="text-[12px] text-muted">
              Statement {fecha(lineaComision.fecha_statement)} · {lineaComision.tipo_transaccion ?? "—"} — aparece 2 veces con el mismo monto:
            </div>
            <div className="mt-1 flex items-center gap-5 text-[13px]">
              <span className="font-medium text-foreground">Línea A: {money(lineaComision.monto)}</span>
              <span className="font-medium text-foreground">
                Línea B: {lineaRelacionada ? money(lineaRelacionada.monto) : "sin línea relacionada"}
              </span>
            </div>
          </div>
        )}

        {excepcion.explicacion && <AiNote>{excepcion.explicacion}</AiNote>}

        {candidatos.length > 1 && excepcion.tipo === "mismatch" && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-semibold text-foreground">Otros candidatos</div>
            {candidatos.map((c, idx) => (
              <label key={idx} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[12px] has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <input type="radio" name="candidato" checked={p.candidatoElegido === idx} onChange={() => p.setCandidatoElegido(idx)} />
                <span className="font-medium text-foreground">{c.numero_poliza ?? c.poliza_id}</span>
                <span className="text-muted">{c.cliente ?? ""}</span>
                <span className="ml-auto text-muted">{pct(c.score)}</span>
              </label>
            ))}
          </div>
        )}

        {(excepcion.tipo === "mismatch" || excepcion.tipo === "duplicado") && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-muted">
              Motivo {excepcion.tipo === "mismatch" && p.showReasignar ? "(obligatorio al reasignar)" : "(opcional)"}
            </label>
            <Textarea value={p.motivo} onChange={p.setMotivo} placeholder="Ej.: Cliente se cambió de agente en agosto, ABB no estaba actualizado" />
          </div>
        )}
      </div>
      </div>
      <div className="flex-shrink-0 border-t border-border p-4">{footer}</div>
    </>
  );
}

// =========================================================
// Acciones para "sin_identificar"
// =========================================================

function SinIdentificarAcciones({
  p,
  agenteOptions,
  ramoOptions,
}: {
  p: PanelProps;
  agenteOptions: { value: string; label: string }[];
  ramoOptions: { value: string; label: string }[];
}) {
  const excepcionId = p.detail.excepcion.id;
  const candidatos = p.detail.candidatos;

  return (
    <div className="flex flex-col gap-3">
      {candidatos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold text-foreground">Candidato sugerido</label>
          {candidatos.map((c, idx) => (
            <div
              key={c.poliza_id ?? idx}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              <div className="flex flex-col gap-0.5 text-[12px]">
                <span className="font-medium text-foreground">{c.cliente ?? c.numero_poliza ?? "Candidato"}</span>
                <span className="text-muted">
                  Póliza {c.numero_poliza ?? "—"} {c.score != null && `· ${pct(c.score)} de parecido`}
                </span>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={p.accionEnCurso || !c.agente_id}
                onClick={() =>
                  p.ejecutarAccion(
                    { excepcionId, accion: "asignar", agenteId: c.agente_id ?? null, polizaId: c.poliza_id ?? null },
                    "Candidato asignado."
                  )
                }
              >
                Asignar
              </Button>
            </div>
          ))}
          <div className="h-px bg-border" />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-semibold text-foreground">Buscar póliza en el ABB</label>
        <Input placeholder="N° de póliza o nombre de cliente…" value={p.busquedaPoliza} onChange={(e) => p.onBuscarPoliza(e.target.value)} />
        {p.buscandoPoliza && <span className="text-[11px] text-muted">Buscando…</span>}
        {p.resultadosPoliza.length > 0 && (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {p.resultadosPoliza.map((res) => (
              <button
                key={res.id}
                type="button"
                onClick={() => {
                  p.setPolizaElegida(res);
                  p.setAgenteParaPoliza(res.agente_id ?? "");
                }}
                className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left text-[12px] hover:bg-background ${
                  p.polizaElegida?.id === res.id ? "border-brand bg-brand-tint" : "border-border"
                }`}
              >
                <span className="font-medium text-foreground">
                  {res.numero_poliza} · {res.cliente ?? "Sin cliente"}
                </span>
                <span className="text-muted">{res.agente ?? "Sin agente asignado"}</span>
              </button>
            ))}
          </div>
        )}
        {p.polizaElegida && !p.polizaElegida.agente_id && (
          <Select options={agenteOptions} placeholder="Elegí un agente para esta póliza" value={p.agenteParaPoliza} onChange={(e) => p.setAgenteParaPoliza(e.target.value)} />
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={p.accionEnCurso || !p.polizaElegida || !(p.polizaElegida.agente_id || p.agenteParaPoliza)}
          onClick={() =>
            p.ejecutarAccion(
              {
                excepcionId,
                accion: "asignar",
                agenteId: p.polizaElegida?.agente_id ?? p.agenteParaPoliza,
                polizaId: p.polizaElegida?.id ?? null,
              },
              "Póliza asignada."
            )
          }
        >
          Asignar a esta póliza
        </Button>
      </div>

      <div className="h-px bg-border" />

      {!p.showCrearPoliza ? (
        <Button variant="secondary" size="sm" onClick={() => p.setShowCrearPoliza(true)}>
          Crear cliente y póliza
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="text-[12px] font-semibold text-foreground">Crear cliente y póliza</div>
          <Input placeholder="Nombre del cliente" value={p.nuevoCliente.nombre} onChange={(e) => p.setNuevoCliente({ ...p.nuevoCliente, nombre: e.target.value })} />
          <Input placeholder="Teléfono" value={p.nuevoCliente.telefono} onChange={(e) => p.setNuevoCliente({ ...p.nuevoCliente, telefono: e.target.value })} />
          <Input placeholder="Email" value={p.nuevoCliente.email} onChange={(e) => p.setNuevoCliente({ ...p.nuevoCliente, email: e.target.value })} />
          <Input placeholder="N° de póliza" value={p.nuevoCliente.numero_poliza} onChange={(e) => p.setNuevoCliente({ ...p.nuevoCliente, numero_poliza: e.target.value })} />
          <Select options={ramoOptions} value={p.nuevoCliente.ramo} onChange={(e) => p.setNuevoCliente({ ...p.nuevoCliente, ramo: e.target.value })} />
          <Select options={agenteOptions} placeholder="Agente" value={p.agenteNuevaPoliza} onChange={(e) => p.setAgenteNuevaPoliza(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={p.accionEnCurso || !p.nuevoCliente.nombre || !p.nuevoCliente.numero_poliza || !p.agenteNuevaPoliza}
              onClick={() =>
                p.ejecutarAccion(
                  {
                    excepcionId,
                    accion: "crear_poliza",
                    agenteId: p.agenteNuevaPoliza,
                    cliente: {
                      nombre: p.nuevoCliente.nombre,
                      telefono: p.nuevoCliente.telefono || undefined,
                      email: p.nuevoCliente.email || undefined,
                      numero_poliza: p.nuevoCliente.numero_poliza,
                      ramo: p.nuevoCliente.ramo,
                    },
                  },
                  "Cliente y póliza creados."
                )
              }
            >
              Crear
            </Button>
            <Button variant="ghost" size="sm" onClick={() => p.setShowCrearPoliza(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-semibold text-foreground">Asignar agente directo</label>
        <Select options={agenteOptions} placeholder="Agente" value={p.agenteDirecto} onChange={(e) => p.setAgenteDirecto(e.target.value)} />
        <Button
          variant="secondary"
          size="sm"
          disabled={p.accionEnCurso || !p.agenteDirecto}
          onClick={() => p.ejecutarAccion({ excepcionId, accion: "asignar", agenteId: p.agenteDirecto }, "Agente asignado.")}
        >
          Asignar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={p.accionEnCurso}
          onClick={() => p.ejecutarAccion({ excepcionId, accion: "cuenta_casa" }, "Marcada como cuenta de la casa.")}
        >
          Cuenta de la casa
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={p.accionEnCurso}
          onClick={() => p.ejecutarAccion({ excepcionId, accion: "pendiente", motivo: p.motivo || null }, "Guardada como pendiente.")}
        >
          Dejar pendiente
        </Button>
      </div>
    </div>
  );
}

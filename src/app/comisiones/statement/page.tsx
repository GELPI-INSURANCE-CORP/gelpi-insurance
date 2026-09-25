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
  Pagination,
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
  asignarLineaCreandoPoliza,
  marcarLineaComoAjuste,
  CATEGORIAS_AJUSTE,
  type GrupoLinea,
  type LineaStatement,
  type StatementDetalle,
} from "@/lib/queries/statement";
import { listAgentes, resolverExcepcion, type AgenteSimple } from "@/lib/queries/conciliacion";
import { actualizarPeriodoReporte, reprocesarReporte, type Reporte } from "@/lib/queries/subir";

// "Todas" no es un número de filas, así que el estado se guarda como string y se resuelve más
// abajo (ver pageSizeEfectivo) contra la cantidad real de líneas filtradas.
const FILAS_POR_PAGINA_OPCIONES = [
  { value: "100", label: "100" },
  { value: "500", label: "500" },
  { value: "1000", label: "1000" },
  { value: "todas", label: "Todas" },
];

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
  const [oficinaFiltro, setOficinaFiltro] = useState("");

  const [filasPorPagina, setFilasPorPagina] = useState("100");
  const [pagina, setPagina] = useState(1);

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
  const [lineaAjuste, setLineaAjuste] = useState<LineaStatement[] | null>(null);
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
    // La oficina va antes que el agente: elegir Miami Lakes y después una persona de ahí adentro
    // es el camino natural. Al revés no tiene sentido, y por eso cambiar de oficina limpia el agente.
    if (oficinaFiltro) out = out.filter((l) => l.oficinaId === oficinaFiltro);
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
  }, [data, agenteFiltro, oficinaFiltro, busqueda]);

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
      countExcluida: cuenta("excluida"),
    };
  }, [lineasDelAgente]);

  const lineasFiltradas = useMemo(
    () => (filtro === "todas" ? lineasDelAgente : lineasDelAgente.filter((l) => l.grupo === filtro)),
    [lineasDelAgente, filtro]
  );

  // Al tocar la búsqueda, un filtro o cuántas filas se ven por página, se vuelve a la página 1.
  // Si no, alguien filtra a 3 resultados estando en la página 2 y se encuentra con una tabla
  // vacía, pensando que no quedó nada.
  useEffect(() => {
    setPagina(1);
  }, [busqueda, filtro, agenteFiltro, oficinaFiltro, filasPorPagina]);

  const pageSizeEfectivo = filasPorPagina === "todas" ? Math.max(lineasFiltradas.length, 1) : Number(filasPorPagina);
  const totalPaginas = Math.max(1, Math.ceil(lineasFiltradas.length / pageSizeEfectivo));
  // Si los datos cambian (por ejemplo se resuelve una excepción) y la página en la que estábamos
  // ya no existe más, se recorta a la última válida en vez de mostrar una tabla vacía.
  const paginaActual = Math.max(1, Math.min(pagina, totalPaginas));

  const lineasPaginadas = useMemo(() => {
    const inicio = (paginaActual - 1) * pageSizeEfectivo;
    return lineasFiltradas.slice(inicio, inicio + pageSizeEfectivo);
  }, [lineasFiltradas, paginaActual, pageSizeEfectivo]);

  // El check del encabezado marca o quita lo seleccionable de ESTA página. Con la tabla paginada,
  // "seleccionar todo" ya no puede significar a la vez "todo lo que se ve" y "todo lo filtrado":
  // se eligió lo primero, que es lo que el ojo ve al tocar el check, y se ofrece por separado
  // extender la selección a todo lo filtrado (aviso arriba de la tabla, junto a la paginación).
  // Seleccionable = todo lo que falta resolver, tenga o no excepcion interna abierta. Las
  // cancelaciones sin original no tienen excepcion y son justamente las que hay que asignar.
  const faltaResolver = (l: LineaStatement) => l.grupo !== "aprobado" && l.grupo !== "excluida";
  const seleccionablesPagina = useMemo(() => lineasPaginadas.filter(faltaResolver), [lineasPaginadas]);
  const seleccionablesFiltradas = useMemo(() => lineasFiltradas.filter(faltaResolver), [lineasFiltradas]);
  const paginaCompletaSeleccionada =
    seleccionablesPagina.length > 0 && seleccionablesPagina.every((l) => selectedIds.has(l.id));
  const todoElFiltroSeleccionado =
    seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => selectedIds.has(l.id));
  const haySeleccionablesFueraDeLaPagina = seleccionablesFiltradas.length > seleccionablesPagina.length;

  // Solo las oficinas que aparecen en este statement, por lo mismo que los agentes: una oficina
  // que no cobró nada este mes no tiene por qué estar en la lista.
  const oficinasDelStatement = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, string>();
    for (const l of data.lineas) if (l.oficinaId) m.set(l.oficinaId, l.oficina ?? "(sin nombre)");
    return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  // Solo los agentes que aparecen en este statement: ofrecer los 12 de la agencia cuando apenas 9
  // tienen líneas hace que elegir uno y no ver nada parezca un error de la pantalla. Con una
  // oficina elegida, además, solo los de esa oficina.
  const agentesDelStatement = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, string>();
    for (const l of data.lineas) {
      if (!l.agenteId) continue;
      if (oficinaFiltro && l.oficinaId !== oficinaFiltro) continue;
      m.set(l.agenteId, l.agente ?? "(sin nombre)");
    }
    return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data, oficinaFiltro]);

  const nombreAgenteFiltro = agentesDelStatement.find((a) => a.value === agenteFiltro)?.label ?? "";
  const nombreOficinaFiltro = oficinasDelStatement.find((o) => o.value === oficinaFiltro)?.label ?? "";
  const descripcionFiltro = [nombreOficinaFiltro, nombreAgenteFiltro].filter(Boolean).join(" · ");

  const puedeConfirmarLote = useMemo(
    () => (data ? data.lineas.some((l) => selectedIds.has(l.id) && l.excepcionId && l.agenteSugeridoId) : false),
    [data, selectedIds]
  );

  // Solo las seleccionadas que todavia tienen una excepcion abierta: sobre una linea ya resuelta
  // no hay nada que marcar, y contarlas haria que el boton prometa mas de lo que hace.
  const seleccionadasConExcepcion = useMemo(
    () => (data ? data.lineas.filter((l) => selectedIds.has(l.id) && l.grupo !== "aprobado" && l.grupo !== "excluida") : []),
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

  function toggleSelectAllPagina() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (paginaCompletaSeleccionada) {
        for (const l of seleccionablesPagina) next.delete(l.id);
      } else {
        for (const l of seleccionablesPagina) next.add(l.id);
      }
      return next;
    });
  }

  // Suma a la selección todo lo que cumple el filtro, no solo lo de esta página. Es un paso
  // aparte y a pedido (el aviso que aparece cuando ya está todo marcado en esta página) para que
  // nadie termine actuando sobre 219 líneas pensando que eran las 20 que tenía a la vista.
  function seleccionarTodoElFiltro() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const l of seleccionablesFiltradas) next.add(l.id);
      return next;
    });
  }

  function deseleccionarTodo() {
    setSelectedIds(new Set());
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
    if (!agenteId) return;
    setAccionEnCursoId(l.excepcionId ?? l.id);
    try {
      // Además de asignar, deja la póliza guardada en el Book: la línea se borra al reprocesar, la
      // póliza no. Es lo que evita volver a asignar lo mismo todos los meses.
      await asignarLineaCreandoPoliza(l.id, agenteId);
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
    const objetivo = data.lineas.filter((l) => selectedIds.has(l.id) && l.grupo !== "aprobado" && l.grupo !== "excluida");
    if (objetivo.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const l of objetivo) {
      try {
        await asignarLineaCreandoPoliza(l.id, bulkAgenteId);
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

  // Abre el diálogo para una línea o para todas las seleccionadas. La categoría y la nota se
  // proponen leyendo lo que el statement dice de la primera fila: "Unsold Adjustment" y "MVR" son
  // cargos por correr reportes de vehículo de cotizaciones que no se vendieron. Es una propuesta,
  // no una decisión — el desplegable queda abierto para cambiarla.
  function abrirAjuste(lineas: LineaStatement[]) {
    const conExcepcion = lineas.filter(faltaResolver);
    if (conExcepcion.length === 0) return;
    setLineaAjuste(conExcepcion);
    const primera = conExcepcion[0];
    setMotivoAjuste(conExcepcion.length === 1 ? primera.cliente?.trim() || primera.explicacion?.trim() || "" : "");
    const texto = conExcepcion.map((l) => `${l.cliente ?? ""} ${l.explicacion ?? ""}`).join(" ").toLowerCase();
    setCategoriaAjuste(/mvr|unsold|motor vehicle/.test(texto) ? "mvr" : "ajuste_aseguradora");
  }

  async function guardarAjuste() {
    if (!lineaAjuste || lineaAjuste.length === 0) return;
    setMarcandoAjuste(true);
    let ok = 0;
    const fallidas: string[] = [];
    for (const l of lineaAjuste) {
      try {
        await marcarLineaComoAjuste({
          excepcionId: l.excepcionId!,
          lineaId: l.id,
          categoria: categoriaAjuste,
          nota: motivoAjuste,
        });
        ok += 1;
      } catch {
        fallidas.push(l.cliente ?? l.numeroPoliza ?? `fila ${l.fila ?? "?"}`);
      }
    }
    setMarcandoAjuste(false);
    setLineaAjuste(null);
    setSelectedIds(new Set());
    // Si alguna falló se dice cuál: un "se marcaron 4 de 5" sin decir cuál quedó afuera obliga a
    // revisar las cinco a mano para encontrarla.
    setError(fallidas.length > 0 ? `Se marcaron ${ok}. No se pudo con: ${fallidas.join(", ")}.` : null);
    cargar();
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
    const header = ["Fila", "Póliza", "Cliente", "Tipo", "Prima", "Tasa", "Comisión", "Agente", "Oficina", "Estado"];
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
        l.oficina ?? "",
        l.categoriaAjuste ? (CATEGORIAS_AJUSTE.find((c) => c.value === l.categoriaAjuste)?.label ?? l.categoriaAjuste) : (ESTADOS_LINEA[l.estadoLinea]?.label ?? l.estadoLinea),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    // El nombre lleva la oficina o el agente filtrado: si el CSV es para mandárselo a Miami Lakes,
    // el archivo tiene que decirlo solo, sin que haya que renombrarlo a mano.
    const nombreBase = [data.reporte.periodo ?? data.reporte.nombre_archivo, descripcionFiltro]
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9._-]+/g, "-");
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

  // Selector de "filas por página" + controles de paginación (Anterior/Siguiente, número de
  // página y el texto "Mostrando X–Y de Z"). Se arma una sola vez y se ubica arriba y abajo de la
  // tabla, para no obligar a subir cuando se quiere cambiar de página estando al final.
  const barraPaginacion = (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted">
        <span>Filas por página:</span>
        <Select
          value={filasPorPagina}
          onChange={setFilasPorPagina}
          options={FILAS_POR_PAGINA_OPCIONES}
          className="w-24"
        />
      </div>
      <Pagination page={paginaActual} pageSize={pageSizeEfectivo} total={lineasFiltradas.length} onChange={setPagina} />
    </>
  );

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
          {/* El título "Detalle del statement" ya lo pone la barra superior (TITLES en
              Topbar.tsx) para toda esta sección — repetirlo acá era la misma frase dos veces
              antes de llegar a la primera línea de la tabla. Lo único que cambia de un statement
              a otro es el archivo, así que es lo único que queda en esta fila. */}
          <p className="min-w-0 truncate text-sm font-medium text-foreground" title={reporte.nombre_archivo}>
            {reporte.nombre_archivo}
          </p>
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

      {/* Cuando hay una oficina o un agente elegido, los tres números de abajo dejan de ser los del
          statement, así que se dice explícitamente: un total que cambia sin avisar por qué es un
          total en el que no se puede confiar. */}
      {(agenteFiltro || oficinaFiltro) && (
        <Banner
          tone="info"
          action={
            <button
              type="button"
              className="text-xs underline"
              onClick={() => {
                setAgenteFiltro("");
                setOficinaFiltro("");
              }}
            >
              Ver el statement completo
            </button>
          }
        >
          Mostrando solo las líneas de <strong>{descripcionFiltro}</strong>. Los tres totales, la tabla y
          el CSV que bajes son de esa selección.
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi
          label="Aprobado"
          value={money(totales.montoAprobado)}
          sub={`${totales.countAprobado} línea${totales.countAprobado === 1 ? "" : "s"} · ya tienen agente`}
          tone="ok"
          destacado
          compact
        />
        <Kpi
          label="Pendiente"
          value={money(totales.montoPendiente)}
          sub={`${totales.countPendiente} línea${totales.countPendiente === 1 ? "" : "s"} · necesitan una decisión`}
          tone="warn"
          destacado
          compact
        />
        <Kpi
          label="Sin asignar"
          value={money(totales.montoSinAsignar)}
          sub={`${totales.countSinAsignar} línea${totales.countSinAsignar === 1 ? "" : "s"} · el sistema no las reconoció`}
          tone="bad"
          destacado
          compact
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
            {/* Las líneas excluidas quedan fuera: son las que el statement menciona pero que no son
                plata de este mes — el caso real es United, que arriba de todo pone cuánto pagó el
                mes pasado. Contándola, un statement de $13,611.70 se mostraba como $9,111.38 y no
                cuadraba contra el depósito. */}
            <span className="font-semibold tabular-nums text-foreground">
              {money(data.lineas.filter((l) => l.grupo !== "excluida").reduce((s, l) => s + l.monto, 0))}
            </span>
            <span className="text-muted">
              · {data.lineas.filter((l) => l.grupo !== "excluida").length} líneas
              {data.countExcluida > 0 && ` · ${data.countExcluida} fuera del statement`}
            </span>
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
              {/* Arriba y no solo en la fila: la columna de acciones es la última de una tabla más
                  ancha que la pantalla, así que el botón quedaba fuera del borde y había que
                  desplazarse de lado para encontrarlo. Acá además sirve para varias de una vez —
                  los cargos de MVR suelen venir en tanda. */}
              <Button
                size="sm"
                variant="secondary"
                disabled={seleccionadasConExcepcion.length === 0 || bulkBusy}
                onClick={() => abrirAjuste(seleccionadasConExcepcion)}
                title="Marcar las seleccionadas como cargo de la agencia (MVR, ajustes, fees)"
              >
                No es de nadie / MVR
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
          {/* El chip de excluidas solo aparece si hay alguna: es un caso poco frecuente y un chip
              en cero al lado de los otros tres hace pensar que falta hacer algo con él. */}
          {totales.countExcluida > 0 && (
            <Chip active={filtro === "excluida"} onClick={() => setFiltro("excluida")}>
              Fuera del statement ({totales.countExcluida})
            </Chip>
          )}
          <div className="flex-1" />
          <span className="text-xs text-muted">Filtrar por:</span>
          {oficinasDelStatement.length > 1 && (
            <Select
              value={oficinaFiltro}
              onChange={(v) => {
                setOficinaFiltro(v);
                setAgenteFiltro("");
              }}
              options={[{ value: "", label: "Todas las oficinas" }, ...oficinasDelStatement]}
              className="w-52"
            />
          )}
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

        {paginaCompletaSeleccionada && haySeleccionablesFueraDeLaPagina && !todoElFiltroSeleccionado && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/60 px-4 py-2.5 text-xs text-muted">
            <span>
              Seleccionaste las {seleccionablesPagina.length} línea{seleccionablesPagina.length === 1 ? "" : "s"} de esta
              página.
            </span>
            <button type="button" className="font-medium text-brand hover:underline" onClick={seleccionarTodoElFiltro}>
              Seleccionar las {seleccionablesFiltradas.length} que cumplen el filtro
            </button>
          </div>
        )}
        {todoElFiltroSeleccionado && haySeleccionablesFueraDeLaPagina && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/60 px-4 py-2.5 text-xs text-muted">
            <span>
              Están seleccionadas las {seleccionablesFiltradas.length} líneas que cumplen el filtro, no solo las de esta
              página.
            </span>
            <button type="button" className="font-medium text-brand hover:underline" onClick={deseleccionarTodo}>
              Deseleccionar todas
            </button>
          </div>
        )}

        {/* Paginación arriba de la tabla además de abajo: con 100+ filas, obligar a subir para
            cambiar de página o de cuántas filas ver sería muy incómodo. */}
        {barraPaginacion}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 w-9">
                  <input
                    type="checkbox"
                    checked={paginaCompletaSeleccionada}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = !paginaCompletaSeleccionada && seleccionablesPagina.some((l) => selectedIds.has(l.id));
                      }
                    }}
                    onChange={toggleSelectAllPagina}
                    title="Selecciona o quita todas las líneas de esta página"
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
              {lineasPaginadas.map((l) => (
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
                />
              ))}
            </tbody>
          </table>
          {loading && <Loading />}
          {!loading && lineasFiltradas.length === 0 && (
            <EmptyState title="Sin líneas" subtitle="No hay líneas que coincidan con estos filtros." />
          )}
        </div>

        {barraPaginacion}
      </Card>

      <Modal
        open={lineaAjuste !== null && lineaAjuste.length > 0}
        onClose={() => setLineaAjuste(null)}
        title="Marcar como ajuste de la agencia"
      >
        {lineaAjuste && lineaAjuste.length > 0 && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg bg-background px-3 py-2">
              {lineaAjuste.map((l) => (
                <div key={l.id}>
                  <span className="font-medium text-foreground">{l.cliente ?? "(sin cliente)"}</span>{" "}
                  <span className="text-muted">
                    · {l.numeroPoliza ?? "sin número de póliza"} · {money(l.monto)}
                  </span>
                </div>
              ))}
              {lineaAjuste.length > 1 && (
                <div className="mt-1 border-t border-border pt-1 font-semibold tabular-nums text-foreground">
                  {lineaAjuste.length} líneas · {money(lineaAjuste.reduce((s, l) => s + l.monto, 0))}
                </div>
              )}
            </div>
            <p className="text-muted">
              {lineaAjuste.length === 1 ? "Esta línea deja" : "Estas líneas dejan"} de buscar agente y{" "}
              {lineaAjuste.length === 1 ? "pasa" : "pasan"} a la <strong>cuenta de la agencia</strong>. Es para los
              ajustes que la aseguradora te cobra o te devuelve a vos, no a un agente.{" "}
              {lineaAjuste.length === 1 ? "La línea" : "Las líneas"} <strong>no se borra{lineaAjuste.length === 1 ? "" : "n"}</strong>:
              queda{lineaAjuste.length === 1 ? "" : "n"} en el statement, con su monto, y suma
              {lineaAjuste.length === 1 ? "" : "n"} en el total como plata de la casa.
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
                {marcandoAjuste ? "Guardando…" : lineaAjuste.length === 1 ? "Marcar como ajuste" : `Marcar ${lineaAjuste.length} líneas`}
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
}) {
  const estado = ESTADOS_LINEA[l.estadoLinea] ?? { label: l.estadoLinea, tone: "neutral" as const };
  // Si la linea se marco como gasto de la agencia, su categoria manda sobre las etiquetas genericas
  const etiquetaAjuste = l.categoriaAjuste
    ? CATEGORIAS_AJUSTE.find((c) => c.value === l.categoriaAjuste)?.label ?? l.categoriaAjuste
    : null;
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
      {/* Una línea marcada como gasto de la agencia se muestra por lo que es. "Other" y "Cuenta de
          la casa" no dicen nada, y el nombre del agente de la casa es peor que nada: hace parecer
          que Arturo se ganó -$180 personalmente. Lo que se eligió al marcarla (MVR, fee, ajuste)
          es el dato verdadero, y es el que hay que ver para poder desglosarlo después. */}
      <td className="px-4 py-2.5 text-muted">
        {etiquetaAjuste ?? TIPOS_TRANSACCION[l.tipoTransaccion] ?? l.tipoTransaccion}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.prima != null ? money(l.prima) : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{l.tasa != null ? `${l.tasa}%` : "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(l.monto)}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          {etiquetaAjuste ? (
            <>
              <span className="whitespace-nowrap text-muted italic">No es de un agente</span>
              <span className="text-[11px] text-muted">Gasto de la agencia</span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap text-foreground">{l.agente ?? "—"}</span>
              {l.oficina && <span className="text-[11px] text-muted">{l.oficina}</span>}
            </>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Badge tone={etiquetaAjuste ? "brand" : estado.tone}>{etiquetaAjuste ?? estado.label}</Badge>
      </td>
      <td className="px-4 py-2.5">
        {/* Los controles se muestran por lo que le FALTA a la línea, no por si tiene una excepción
            interna abierta. Las cancelaciones sin original quedan en 'en_espera' sin excepción, así
            que antes solo mostraban "Cambiar" y no había forma de asignarles agente — que es
            justamente lo único que hace falta para resolverlas. */}
        {l.grupo !== "aprobado" && l.grupo !== "excluida" ? (
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

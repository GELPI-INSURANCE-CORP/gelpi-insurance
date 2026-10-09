"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Home, Download, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Input,
  Kpi,
  Loading,
  Pagination,
  Select,
} from "@/components/agentes/ui";
import { money, etiquetaPeriodo } from "@/lib/format";
import {
  getMvrDetalle,
  getMvrDelMes,
  listMesesConMvr,
  type MesConMvr,
  asignarCargos,
  cargosACuentaCasa,
  releerArchivoMvr,
  type MvrDetalle,
  type CargoMvr,
} from "@/lib/queries/mvr";
import { listAgentes, type AgenteSimple } from "@/lib/queries/conciliacion";

// Esta pantalla se trabaja igual que un statement, y a propósito: es el mismo trabajo. Arturo
// filtra por oficina, revisa renglón por renglón, asigna lo que falta y exporta la lista para
// mandársela a esa oficina — "necesito mandar los nombres de todos los clientes que le están
// cobrando". Lo único distinto son las columnas: un cargo de MVR no tiene póliza ni prima, tiene
// asegurado, conductor, estado de la licencia y fecha de orden.

type Filtro = "todos" | "sin_dueno" | "identificados" | "casa";

const SIN_OFICINA = "Falta decidir la oficina";
const SIN_AGENTE = "Falta decidir el agente";

const FILAS_POR_PAGINA_OPCIONES = [
  { value: "100", label: "100" },
  { value: "500", label: "500" },
  { value: "1000", label: "1000" },
  { value: "todas", label: "Todas" },
];

function oficinaDe(c: CargoMvr): string {
  return c.estado === "cuenta_casa" ? "Cuenta de la casa" : (c.oficina ?? SIN_OFICINA);
}

function clienteDe(c: CargoMvr): string {
  return (c.asegurado_crudo ?? "").trim() || (c.conductor_crudo ?? "").trim() || "(sin nombre)";
}

// Esta plata no es comisión que entra: es gasto que sale, y sale de una oficina concreta. El
// reparto se calcula con los mismos cargos que se ven en la tabla -- y no con un resumen aparte --
// para que el total de arriba y los renglones de abajo no puedan contar cosas distintas. Lo que
// todavía no tiene dueño aparece en la misma lista: un gasto que no se ve es un gasto que alguien
// termina pagando sin saberlo.
function repartir(cargos: CargoMvr[]) {
  const m = new Map<string, { oficina: string; cargos: number; monto: number; pendiente: boolean }>();
  for (const c of cargos) {
    if (c.estado === "descartado") continue;
    const nombre = oficinaDe(c);
    const prev = m.get(nombre) ?? {
      oficina: nombre,
      cargos: 0,
      monto: 0,
      pendiente: nombre === SIN_OFICINA,
    };
    prev.cargos += 1;
    prev.monto += Number(c.monto ?? 0);
    m.set(nombre, prev);
  }
  return [...m.values()].sort((a, b) => Number(a.pendiente) - Number(b.pendiente) || b.monto - a.monto);
}

function enPalabras(c: CargoMvr): string {
  const conDueno = c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado";
  if (conDueno) {
    if (c.regla_match === "manual") return "Lo asignaste vos";
    if (c.regla_match === "productor_del_archivo") return "Lo dice el archivo de la compañía";
    if (c.regla_match === "book") return "El cliente es del Book";
    if (c.regla_match === "misma_cotizacion") return "Otro cargo de la misma cotización";
    return "Pegó contra las cotizaciones";
  }
  if (c.estado === "cuenta_casa") return "Se lo come la agencia";
  switch (c.regla_match) {
    case "sin_nombre":
      return "El archivo no trae ningún nombre";
    case "comercial_sin_asegurado":
      return "La compañía lo manda sin asegurado";
    case "productor_compartido":
      return "El archivo lo pone bajo el usuario compartido";
    case "sin_candidato":
      return "No aparece en las cotizaciones";
    case "score_bajo":
      return `Parecido bajo (${c.score ?? 0}%)`;
    default:
      return c.regla_match ?? "—";
  }
}

// El archivo que Arturo le manda a la oficina. Por eso lleva arriba de quién es y cuánto suma —
// eso es el mensaje — y debajo los clientes uno por uno, que es lo que la oficina va a querer
// mirar para discutirlo. El nombre del archivo dice la oficina solo, sin tener que renombrarlo.
function bajarCsv(datos: MvrDetalle, filas: CargoMvr[], paraQuien: string) {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linea = (xs: unknown[]) => xs.map(esc).join(",");
  const total = filas.reduce((s, c) => s + Number(c.monto ?? 0), 0);

  const out: string[] = [];
  out.push(linea([`Cargos por MVR - ${datos.aseguradora ?? "sin compañía"}`]));
  out.push(linea([etiquetaPeriodo(datos.periodo) ?? "sin período"]));
  if (paraQuien) out.push(linea([paraQuien]));
  out.push(linea([`${filas.length} cargos`, `TOTAL`, total.toFixed(2)]));
  out.push("");

  // Si se está exportando todo, el reparto por oficina va primero: es la foto completa.
  // Filtrado a una sola oficina sobra, porque el total de arriba ya es el suyo.
  if (!paraQuien) {
    out.push(linea(["OFICINA", "CARGOS", "MONTO"]));
    for (const o of repartir(filas)) out.push(linea([o.oficina, o.cargos, o.monto.toFixed(2)]));
    out.push("");
  }

  // Y siempre el desglose por compañía: es lo que la oficina pregunta cuando ve el total.
  // Arturo: "para que vean por compañía cuánto se están gastando".
  const porCompania = new Map<string, { n: number; monto: number }>();
  for (const c of filas) {
    const k = c.aseguradora ?? "Sin compañía";
    const p = porCompania.get(k) ?? { n: 0, monto: 0 };
    p.n += 1;
    p.monto += Number(c.monto ?? 0);
    porCompania.set(k, p);
  }
  if (porCompania.size > 0) {
    out.push(linea(["COMPAÑÍA", "CARGOS", "MONTO"]));
    for (const [k, v] of [...porCompania.entries()].sort((a, b) => b[1].monto - a[1].monto)) {
      out.push(linea([k, v.n, v.monto.toFixed(2)]));
    }
    out.push("");
  }

  out.push(linea(["Cliente", "Conductor", "Lic.", "Fecha", "Compañía", "Agente", "Oficina", "Monto", "Situación"]));
  for (const c of filas) {
    out.push(
      linea([
        clienteDe(c),
        c.conductor_crudo ?? "",
        c.estado_us ?? "",
        c.fecha_orden ?? "",
        c.aseguradora ?? "",
        c.agente ?? SIN_AGENTE,
        oficinaDe(c),
        Number(c.monto ?? 0).toFixed(2),
        c.estado === "cuenta_casa" ? "Cuenta de la casa" : c.agente ? "Repartido" : "Falta decidir",
      ])
    );
  }
  out.push("");
  out.push(linea(["", "", "", "", "", "", "TOTAL", total.toFixed(2)]));

  // El BOM va adelante o Excel abre "Martínez" como "MartÃ­nez".
  const blob = new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    ["MVR", etiquetaPeriodo(datos.periodo) ?? "", datos.aseguradora ?? "", paraQuien]
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function MvrContenido() {
  const params = useSearchParams();
  const reporteId = params.get("id") ?? "";
  // Sin id en la URL, la pantalla muestra TODOS los MVR del mes juntos. Es la misma pantalla a
  // proposito: lo que se hace con un archivo -- filtrar por oficina, asignar lo que falta,
  // exportar la lista para mandarsela -- es exactamente lo que se hace con el mes entero, y a la
  // oficina no le importa de cual de los dos archivos salio cada cargo.
  const consolidado = reporteId === "";
  const [meses, setMeses] = useState<MesConMvr[]>([]);
  const [mesSel, setMesSel] = useState("");

  const [datos, setDatos] = useState<MvrDetalle | null>(null);
  const [agentes, setAgentes] = useState<AgenteSimple[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [oficinaSel, setOficinaSel] = useState("");
  const [agenteSel, setAgenteSel] = useState("");
  const [companiaSel, setCompaniaSel] = useState("");
  const [filasPorPagina, setFilasPorPagina] = useState("100");
  const [pagina, setPagina] = useState(1);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [agenteLote, setAgenteLote] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [releyendo, setReleyendo] = useState(false);

  const cargar = useCallback(async () => {
    if (!consolidado && !reporteId) return;
    if (consolidado && !mesSel) return;
    setCargando(true);
    try {
      const d = consolidado ? await getMvrDelMes(mesSel) : await getMvrDetalle(reporteId);
      setDatos(d);
      setElegidos(new Set());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el reporte.");
    } finally {
      setCargando(false);
    }
  }, [reporteId, consolidado, mesSel]);

  // Los meses que tienen MVR cargado. El mas reciente queda elegido solo: es el que se esta
  // trabajando, y hacer un clic para ver lo de este mes es un clic de mas.
  useEffect(() => {
    if (!consolidado) return;
    listMesesConMvr()
      .then((ms) => {
        setMeses(ms);
        setMesSel((actual) => actual || ms[0]?.mes || "");
      })
      .catch(() => {});
  }, [consolidado]);

  useEffect(() => {
    void cargar();
    listAgentes().then(setAgentes).catch(() => {});
  }, [cargar]);

  const todos = useMemo(() => datos?.cargos ?? [], [datos]);
  const reparto = useMemo(() => repartir(todos), [todos]);

  const cuenta = useMemo(
    () => ({
      todos: todos.length,
      sinDueno: todos.filter((c) => c.estado === "sin_identificar" || c.estado === "pendiente").length,
      conDueno: todos.filter((c) => c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado").length,
      casa: todos.filter((c) => c.estado === "cuenta_casa").length,
    }),
    [todos]
  );

  // Las listas salen de los cargos que hay, no del catálogo entero: si en este archivo no aparece
  // Palmetto Bay, no tiene sentido ofrecerla y que el filtro devuelva vacío.
  const oficinas = useMemo(() => [...new Set(todos.map(oficinaDe))].sort(), [todos]);
  const companias = useMemo(
    () => [...new Set(todos.map((c) => c.aseguradora ?? "Sin compañía"))].sort(),
    [todos]
  );
  const agentesEnArchivo = useMemo(
    () => [...new Set(todos.map((c) => c.agente ?? SIN_AGENTE))].sort(),
    [todos]
  );

  const filtradas = useMemo(() => {
    let xs = todos;
    if (filtro === "sin_dueno") xs = xs.filter((c) => c.estado === "sin_identificar" || c.estado === "pendiente");
    else if (filtro === "identificados")
      xs = xs.filter((c) => c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado");
    else if (filtro === "casa") xs = xs.filter((c) => c.estado === "cuenta_casa");
    if (oficinaSel) xs = xs.filter((c) => oficinaDe(c) === oficinaSel);
    if (agenteSel) xs = xs.filter((c) => (c.agente ?? SIN_AGENTE) === agenteSel);
    if (companiaSel) xs = xs.filter((c) => (c.aseguradora ?? "Sin compañía") === companiaSel);
    const q = busqueda.trim().toLowerCase();
    if (q) {
      xs = xs.filter((c) =>
        [c.asegurado_crudo, c.conductor_crudo, c.agente, c.oficina]
          .some((v) => (v ?? "").toLowerCase().includes(q))
      );
    }
    return xs;
  }, [todos, filtro, oficinaSel, agenteSel, companiaSel, busqueda]);

  // Cambiar un filtro estando en la página 7 dejaba la tabla vacía, como si no hubiera resultados.
  useEffect(() => {
    setPagina(1);
  }, [busqueda, filtro, oficinaSel, agenteSel, companiaSel, filasPorPagina]);

  const pageSize = filasPorPagina === "todas" ? Math.max(filtradas.length, 1) : Number(filasPorPagina);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const paginaActual = Math.max(1, Math.min(pagina, totalPaginas));
  const visibles = useMemo(
    () => filtradas.slice((paginaActual - 1) * pageSize, (paginaActual - 1) * pageSize + pageSize),
    [filtradas, paginaActual, pageSize]
  );

  // Lo que suman TODOS los renglones del filtro, no los de esta página. Con la oficina filtrada,
  // este es el número que va al mensaje de esa oficina.
  const montoFiltrado = useMemo(() => filtradas.reduce((s, c) => s + Number(c.monto ?? 0), 0), [filtradas]);
  const montoElegido = useMemo(
    () => todos.filter((c) => elegidos.has(c.id)).reduce((s, c) => s + Number(c.monto ?? 0), 0),
    [todos, elegidos]
  );
  const descripcionFiltro = [oficinaSel, agenteSel].filter(Boolean).join(" · ");

  function alternar(id: string) {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Marca TODO lo filtrado, no sólo esta página: el trabajo real es "todos los de esta oficina a
  // este agente", y obligar a pasar página por página para eso sería pedirle al usuario que haga
  // de contador.
  function alternarTodos() {
    setElegidos((prev) => (prev.size >= filtradas.length ? new Set() : new Set(filtradas.map((c) => c.id))));
  }

  async function asignar() {
    if (!agenteLote) return setError("Elegí el agente.");
    if (elegidos.size === 0) return setError("No marcaste ningún cargo.");
    setGuardando(true);
    setError(null);
    try {
      await asignarCargos([...elegidos], agenteLote, "Asignado a mano desde la pantalla de MVR");
      setAgenteLote("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setGuardando(false);
    }
  }

  async function aLaCasa() {
    if (elegidos.size === 0) return setError("No marcaste ningún cargo.");
    if (!window.confirm(`Mandar ${elegidos.size} cargo(s) a cuenta de la casa? No se le descuentan a ninguna oficina.`))
      return;
    setGuardando(true);
    setError(null);
    try {
      await cargosACuentaCasa([...elegidos], "Nadie lo pidió: se lo come la agencia");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.");
    } finally {
      setGuardando(false);
    }
  }

  // Volver a leer el archivo guardado con la función de extracción de hoy. Existe porque un MVR
  // mal leído no se arregla cruzando de nuevo: si los nombres no entraron, no están en la base
  // para recuperarlos. Antes la única salida era borrar el reporte y subirlo otra vez.
  async function releer() {
    if (!window.confirm("Volver a leer el archivo con la versión de hoy? Los cargos actuales se reemplazan por los que salgan de esta lectura.")) return;
    setReleyendo(true);
    setError(null);
    try {
      await releerArchivoMvr(reporteId);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo volver a leer el archivo.");
    } finally {
      setReleyendo(false);
    }
  }

  if (!consolidado && !reporteId)
    return <EmptyState title="Falta el reporte" subtitle="Entrá desde la lista de archivos subidos." />;
  if (consolidado && meses.length === 0 && !cargando)
    return (
      <EmptyState
        title="Todavía no hay cargos por MVR"
        subtitle="Subí el MVR de una compañía desde Subir statement o MVR y acá vas a ver cuánto gastó cada oficina."
      />
    );
  if (cargando && !datos) return <Loading />;
  if (!datos) return <Loading />;

  const r = datos.resumen;
  const opcionesAgente = agentes.map((a) => ({ value: a.id, label: a.nombre }));

  const barraPaginacion = (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted">
        <span>Filas por página:</span>
        <Select value={filasPorPagina} onChange={setFilasPorPagina} options={FILAS_POR_PAGINA_OPCIONES} className="w-24" />
      </div>
      <Pagination page={paginaActual} pageSize={pageSize} total={filtradas.length} onChange={setPagina} />
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* En el consolidado no hay "los archivos" a los que volver: se entra desde el menú. */}
      {!consolidado && (
        <Link
          href="/comisiones/subir/"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Volver a los archivos
        </Link>
      )}

      <Card>
        <CardHead
          title={
            consolidado
              ? "Cargos por MVR · todas las compañías"
              : `Cargos por MVR · ${datos.aseguradora ?? "Sin compañía"}`
          }
          subtitle={
            consolidado
              ? `${datos.aseguradora ?? "sin archivos"} · ${datos.nombreArchivo ?? ""}`
              : `${etiquetaPeriodo(datos.periodo) ?? "Sin período"} · ${datos.nombreArchivo ?? ""}`
          }
          actions={
            consolidado ? (
              <Select
                value={mesSel}
                onChange={setMesSel}
                options={meses.map((m) => ({
                  value: m.mes,
                  label: `${etiquetaPeriodo(m.etiqueta) ?? m.mes} · ${m.reportes} archivo${m.reportes === 1 ? "" : "s"}`,
                }))}
                className="w-64"
              />
            ) : (
              <Button variant="ghost" onClick={releer} disabled={releyendo}>
                <RefreshCw size={14} />
                {releyendo ? "Leyendo…" : "Volver a leer el archivo"}
              </Button>
            )
          }
        />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4">
          {/* Los cargos en cero van aparte: 100 de los 389 de agosto vinieron sin costo porque la
              compañía no los cobró, y contarlos juntos hace parecer mucha más plata de la que es. */}
          <Kpi label="Total cobrado" value={money(r.monto ?? 0)} />
          <Kpi label="Cargos" value={`${r.total ?? 0}`} sub={`${r.con_cargo ?? 0} con costo`} />
          <Kpi label="Con dueño" value={`${cuenta.conDueno}`} />
          <Kpi label="Sin identificar" value={`${cuenta.sinDueno}`} tone={cuenta.sinDueno > 0 ? "warn" : "ok"} />
        </div>

        {/* El reparto, siempre visible y cliqueable. Cada chip es la oficina a la que hay que
            mandarle su lista: un clic la filtra entera y el botón de exportar sale con su nombre. */}
        <div className="border-t border-border px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Cómo se reparte · clic para filtrar y exportar
          </div>
          <div className="flex flex-wrap gap-2">
            {reparto.map((o) => (
              <button
                key={o.oficina}
                type="button"
                onClick={() => {
                  setOficinaSel(oficinaSel === o.oficina ? "" : o.oficina);
                  setAgenteSel("");
                  setFiltro("todos");
                  setElegidos(new Set());
                }}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors",
                  oficinaSel === o.oficina
                    ? "border-brand bg-brand-tint"
                    : o.pendiente
                      ? "border-warn-fg/30 bg-warn-tint"
                      : "border-border bg-background hover:border-brand/50"
                )}
              >
                {o.oficina} · <span className="font-medium tabular-nums">{money(o.monto)}</span>{" "}
                <span className="text-muted">({o.cargos})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Contra qué se cruzó. El QuoteReport ya no sale en la lista de archivos — no es un
            statement, es el padrón — pero tiene que poder verse cuál se usó: si quedó mucho sin
            dueño, lo primero a mirar es si el padrón es del mes que corresponde. */}
        <div className="border-t border-border px-5 py-3 text-[12px] text-muted">
          {datos.padron ? (
            <>
              Cruzado contra el QuoteReport de{" "}
              <span className="text-foreground">{etiquetaPeriodo(datos.padron.periodo) ?? "sin período"}</span> ·{" "}
              {datos.padron.total.toLocaleString("es")} cotizaciones,{" "}
              {datos.padron.conAgente.toLocaleString("es")} con agente
              {datos.padron.nombreArchivo ? ` · ${datos.padron.nombreArchivo}` : ""}
            </>
          ) : (
            <>
              No hay QuoteReport de este mes cargado todavía, así que estos cargos sólo se pueden
              identificar por el Book o por el productor del archivo. Subí el QuoteReport desde{" "}
              <Link href="/comisiones/subir/" className="text-brand underline">
                Subir statement o MVR
              </Link>
              : se engancha solo con el MVR del mismo mes.
            </>
          )}
        </div>
      </Card>

      <Card className="flex flex-col">
        <CardHead
          title={descripcionFiltro || "Todos los cargos"}
          subtitle={`${filtradas.length} cargo${filtradas.length === 1 ? "" : "s"} · ${money(montoFiltrado)}`}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => bajarCsv(datos, filtradas, descripcionFiltro)}
              disabled={filtradas.length === 0}
            >
              <Download size={14} />
              {oficinaSel ? `Exportar lo de ${oficinaSel}` : "Exportar a CSV"}
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-y border-border p-3">
          <Input value={busqueda} onChange={setBusqueda} placeholder="Buscar por cliente, conductor o agente…" className="w-72" />
          <Chip active={filtro === "todos"} onClick={() => setFiltro("todos")}>
            Todos ({cuenta.todos})
          </Chip>
          <Chip active={filtro === "identificados"} onClick={() => setFiltro("identificados")}>
            Con dueño ({cuenta.conDueno})
          </Chip>
          <Chip active={filtro === "sin_dueno"} onClick={() => setFiltro("sin_dueno")}>
            Sin identificar ({cuenta.sinDueno})
          </Chip>
          {cuenta.casa > 0 && (
            <Chip active={filtro === "casa"} onClick={() => setFiltro("casa")}>
              En la casa ({cuenta.casa})
            </Chip>
          )}
          <div className="flex-1" />
          <span className="text-xs text-muted">Filtrar por:</span>
          {/* Sólo en el consolidado: con un archivo solo, la compañía es una y el filtro sobra.
              Juntos, "por compañía cuánto se están gastando" es la pregunta que hay que poder
              contestar. */}
          {consolidado && companias.length > 1 && (
            <Select
              value={companiaSel}
              onChange={(v) => {
                setCompaniaSel(v);
                setElegidos(new Set());
              }}
              options={[
                { value: "", label: "Todas las compañías" },
                ...companias.map((c) => ({ value: c, label: c })),
              ]}
              className="w-48"
            />
          )}
          <Select
            value={oficinaSel}
            onChange={(v) => {
              setOficinaSel(v);
              setAgenteSel("");
              setElegidos(new Set());
            }}
            options={[{ value: "", label: "Todas las oficinas" }, ...oficinas.map((o) => ({ value: o, label: o }))]}
            className="w-52"
          />
          <Select
            value={agenteSel}
            onChange={(v) => {
              setAgenteSel(v);
              setElegidos(new Set());
            }}
            options={[{ value: "", label: "Todos los agentes" }, ...agentesEnArchivo.map((a) => ({ value: a, label: a }))]}
            className="w-52"
          />
        </div>

        {/* La barra de acciones aparece sólo con algo marcado: ocupando espacio siempre, sería una
            fila de controles apagados arriba de la tabla todos los días. */}
        {elegidos.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-brand-tint/40 px-4 py-2.5">
            <span className="text-[13px] font-medium text-foreground">
              {elegidos.size} marcado{elegidos.size === 1 ? "" : "s"} · {money(montoElegido)}
            </span>
            <Select
              value={agenteLote}
              onChange={setAgenteLote}
              options={[{ value: "", label: "Asignar a…" }, ...opcionesAgente]}
              className="w-56"
            />
            <Button size="sm" variant="primary" onClick={asignar} disabled={guardando || !agenteLote}>
              Asignar
            </Button>
            <Button size="sm" variant="ghost" onClick={aLaCasa} disabled={guardando}>
              <Home size={14} />
              A cuenta de la casa
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setElegidos(new Set())}>
              Quitar la marca
            </Button>
          </div>
        )}

        {error && <div className="border-b border-border bg-bad-tint px-5 py-2.5 text-[13px] text-bad-fg">{error}</div>}

        {filtradas.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">
            {busqueda || oficinaSel || agenteSel
              ? "No hay cargos con esos filtros."
              : "No hay cargos en este filtro."}
          </div>
        ) : (
          <>
            {barraPaginacion}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-[13px]">
                <thead>
                  <tr className="bg-background">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={elegidos.size > 0 && elegidos.size >= filtradas.length}
                        onChange={alternarTodos}
                        aria-label="Marcar todo lo filtrado"
                        title="Marca los cargos de todo el filtro, no sólo los de esta página"
                      />
                    </th>
                    {["Oficina", "Agente", "Compañía", "Cliente", "Conductor", "Lic.", "Fecha", "Monto", "Por qué"].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap border-b border-border px-3.5 py-2.5 text-left font-medium text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c) => (
                    <FilaCargo key={c.id} c={c} marcado={elegidos.has(c.id)} onMarcar={() => alternar(c.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            {barraPaginacion}
          </>
        )}
      </Card>
    </div>
  );
}

function FilaCargo({ c, marcado, onMarcar }: { c: CargoMvr; marcado: boolean; onMarcar: () => void }) {
  const conDueno = c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado";
  return (
    <tr className={clsx("border-b border-border last:border-b-0", marcado && "bg-brand-tint/30")}>
      <td className="px-4 py-2">
        <input type="checkbox" checked={marcado} onChange={onMarcar} aria-label={`Marcar ${clienteDe(c)}`} />
      </td>
      {/* La oficina va primera: es la que decide a quién se le descuenta, así que es lo primero
          que hay que poder leer de corrido por toda la tabla. */}
      <td className="px-3.5 py-2">
        {c.estado === "cuenta_casa" ? (
          <Badge tone="neutral">La casa</Badge>
        ) : c.oficina ? (
          <span className="font-medium">{c.oficina}</span>
        ) : (
          <Badge tone="warn">Falta decidir</Badge>
        )}
      </td>
      <td className="px-3.5 py-2">{conDueno && c.agente ? c.agente : <span className="text-muted">—</span>}</td>
      <td className="px-3.5 py-2 text-muted">{c.aseguradora ?? "—"}</td>
      <td className="px-3.5 py-2">
        {c.asegurado_crudo ?? <span className="text-muted">(sin asegurado)</span>}
      </td>
      <td className="px-3.5 py-2 text-muted">{c.conductor_crudo ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.estado_us ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.fecha_orden ?? "—"}</td>
      <td className="px-3.5 py-2 text-right font-medium tabular-nums">{money(Number(c.monto ?? 0))}</td>
      {/* El motivo en palabras, no el código de la regla. "score_bajo" no le dice nada a nadie un
          martes a la mañana. */}
      <td className="px-3.5 py-2 text-[11px] text-muted">{enPalabras(c)}</td>
    </tr>
  );
}

export default function MvrPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MvrContenido />
    </Suspense>
  );
}

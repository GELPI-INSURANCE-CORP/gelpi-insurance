"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Home, Download, RefreshCw } from "lucide-react";
import { Card, CardHead, Kpi, Button, Badge, Select, Loading, EmptyState } from "@/components/agentes/ui";
import { money, etiquetaPeriodo } from "@/lib/format";
import {
  getMvrDetalle,
  asignarCargos,
  cargosACuentaCasa,
  releerArchivoMvr,
  type MvrDetalle,
  type CargoMvr,
} from "@/lib/queries/mvr";
import { listAgentes, type AgenteSimple } from "@/lib/queries/conciliacion";

// Un cargo de MVR no tiene póliza ni prima: tiene asegurado, conductor, estado de la licencia y
// fecha de orden. Por eso esta pantalla existe en vez de reusar la de statements, que son 1279
// líneas atadas a lineas_comision. Lo que sí se copia es la forma: encabezado con los números
// arriba, tabla abajo, acciones en lote.

type Filtro = "todos" | "sin_dueno" | "identificados" | "casa";

const SIN_OFICINA = "Falta decidir la oficina";
const SIN_AGENTE = "Falta decidir el agente";

// Esta plata no es comisión que entra: es gasto que sale, y sale de una oficina concreta. El
// reparto se calcula acá con los mismos cargos que se ven en la tabla -- y no con un resumen
// aparte -- para que el total de arriba y los renglones de abajo no puedan contar cosas
// distintas. Lo que todavía no tiene dueño aparece en la misma lista, con su nombre feo, porque
// un gasto que no se ve es un gasto que alguien termina pagando sin saberlo.
function repartir(cargos: CargoMvr[]) {
  const m = new Map<string, { oficina: string; cargos: number; monto: number; pendiente: boolean }>();
  for (const c of cargos) {
    if (c.estado === "descartado") continue;
    const casa = c.estado === "cuenta_casa";
    const nombre = casa ? "Cuenta de la casa" : (c.oficina ?? SIN_OFICINA);
    const prev = m.get(nombre) ?? { oficina: nombre, cargos: 0, monto: 0, pendiente: !casa && !c.oficina };
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

function bajarCsv(datos: MvrDetalle, filas: CargoMvr[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linea = (xs: unknown[]) => xs.map(esc).join(",");

  // El resumen primero, porque es lo que se mira: cuánto le toca a cada oficina. El detalle
  // abajo, en el mismo archivo, para poder auditar de dónde salió cada número.
  const out: string[] = [];
  out.push(linea([`Cargos por MVR - ${datos.aseguradora ?? "sin compañía"}`]));
  out.push(linea([etiquetaPeriodo(datos.periodo) ?? "sin período", datos.nombreArchivo ?? ""]));
  out.push("");
  out.push(linea(["OFICINA", "CARGOS", "MONTO"]));
  for (const o of repartir(datos.cargos)) out.push(linea([o.oficina, o.cargos, o.monto.toFixed(2)]));
  out.push("");
  out.push(linea(["DETALLE"]));
  out.push(linea(["Oficina", "Agente", "Asegurado", "Conductor", "Lic.", "Fecha", "Monto", "Situación", "Por qué"]));
  for (const c of filas) {
    out.push(
      linea([
        c.estado === "cuenta_casa" ? "Cuenta de la casa" : (c.oficina ?? SIN_OFICINA),
        c.agente ?? SIN_AGENTE,
        c.es_comercial ? "(sin asegurado)" : (c.asegurado_crudo ?? ""),
        c.conductor_crudo ?? "",
        c.estado_us ?? "",
        c.fecha_orden ?? "",
        Number(c.monto ?? 0).toFixed(2),
        c.estado === "cuenta_casa"
          ? "Cuenta de la casa"
          : c.agente
            ? "Repartido"
            : "Falta decidir",
        enPalabras(c),
      ])
    );
  }

  // El BOM va adelante o Excel abre "Martínez" como "MartÃ­nez".
  const blob = new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `MVR ${datos.aseguradora ?? ""} ${etiquetaPeriodo(datos.periodo) ?? ""}`.trim().replace(/\s+/g, " ") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function MvrContenido() {
  const params = useSearchParams();
  const reporteId = params.get("id") ?? "";

  const [datos, setDatos] = useState<MvrDetalle | null>(null);
  const [agentes, setAgentes] = useState<AgenteSimple[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("sin_dueno");
  const [oficinaSel, setOficinaSel] = useState("");
  const [agenteSel, setAgenteSel] = useState("");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [agenteLote, setAgenteLote] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [releyendo, setReleyendo] = useState(false);

  const cargar = useCallback(async () => {
    if (!reporteId) return;
    setCargando(true);
    try {
      const d = await getMvrDetalle(reporteId);
      setDatos(d);
      setElegidos(new Set());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el reporte.");
    } finally {
      setCargando(false);
    }
  }, [reporteId]);

  useEffect(() => {
    void cargar();
    listAgentes().then(setAgentes).catch(() => {});
  }, [cargar]);

  const todos = useMemo(() => datos?.cargos ?? [], [datos]);
  const reparto = useMemo(() => repartir(todos), [todos]);

  // Las listas salen de los cargos que hay, no del catálogo entero: si en este archivo no
  // aparece Palmetto Bay, no tiene sentido ofrecerla y que el filtro devuelva vacío.
  const oficinas = useMemo(
    () => [...new Set(todos.map((c) => c.oficina ?? SIN_OFICINA))].sort(),
    [todos]
  );
  const agentesEnArchivo = useMemo(
    () => [...new Set(todos.map((c) => c.agente ?? SIN_AGENTE))].sort(),
    [todos]
  );

  const visibles = useMemo(() => {
    let xs = todos;
    if (filtro === "sin_dueno") xs = xs.filter((c) => c.estado === "sin_identificar" || c.estado === "pendiente");
    else if (filtro === "identificados")
      xs = xs.filter((c) => c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado");
    else if (filtro === "casa") xs = xs.filter((c) => c.estado === "cuenta_casa");
    if (oficinaSel) xs = xs.filter((c) => (c.oficina ?? SIN_OFICINA) === oficinaSel);
    if (agenteSel) xs = xs.filter((c) => (c.agente ?? SIN_AGENTE) === agenteSel);
    return xs;
  }, [todos, filtro, oficinaSel, agenteSel]);

  // Lo que suman los renglones que se están viendo. Con un filtro de oficina puesto, este es
  // justo el número que hay que descontarle a esa oficina.
  const montoVisible = useMemo(
    () => visibles.reduce((s, c) => s + Number(c.monto ?? 0), 0),
    [visibles]
  );

  // Sobre los elegidos, no sobre todo: es el número que dice cuánta plata mueve la decisión que
  // está por tomar.
  const montoElegido = useMemo(
    () => todos.filter((c) => elegidos.has(c.id)).reduce((s, c) => s + Number(c.monto ?? 0), 0),
    [todos, elegidos]
  );

  function alternar(id: string) {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function alternarTodos() {
    setElegidos((prev) => (prev.size === visibles.length ? new Set() : new Set(visibles.map((c) => c.id))));
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

  // Volver a leer el archivo guardado con la funcion de extraccion de hoy. Existe porque un MVR
  // mal leido no se arregla cruzando de nuevo: si los nombres no entraron, no estan en la base
  // para recuperarlos. Antes la unica salida era borrar el reporte y subir el archivo otra vez.
  async function releer() {
    if (!window.confirm("Volver a leer el archivo con la version de hoy? Los cargos actuales se reemplazan por los que salgan de esta lectura.")) return;
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

  if (!reporteId) return <EmptyState title="Falta el reporte" subtitle="Entrá desde la lista de archivos subidos." />;
  if (cargando && !datos) return <Loading />;
  if (!datos) return <EmptyState title="No se encontró el reporte" />;

  const r = datos.resumen;
  const opcionesAgente = agentes.map((a) => ({ value: a.id, label: a.nombre }));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/comisiones/subir/" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={14} />
        Volver a los archivos
      </Link>

      <Card>
        <CardHead
          title={`Cargos por MVR · ${datos.aseguradora ?? "Sin compañía"}`}
          subtitle={`${etiquetaPeriodo(datos.periodo) ?? "Sin período"} · ${datos.nombreArchivo ?? ""}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={releer} disabled={releyendo}>
                <RefreshCw size={14} />
                {releyendo ? "Leyendo…" : "Volver a leer el archivo"}
              </Button>
              <Button variant="ghost" onClick={() => bajarCsv(datos, visibles)}>
                <Download size={14} />
                Bajar a Excel
              </Button>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4">
          {/* Los cargos en cero van aparte: 100 de los 389 de agosto vinieron sin costo porque la
              compañía no los cobró, y contarlos juntos hace parecer mucha más plata de la que es. */}
          <Kpi label="Total cobrado" value={money(r.monto ?? 0)} />
          <Kpi label="Cargos" value={`${r.total ?? 0}`} sub={`${r.con_cargo ?? 0} con costo`} />
          <Kpi label="Con dueño" value={`${r.identificados ?? 0}`} />
          <Kpi label="Sin identificar" value={`${r.sin_dueno ?? 0}`} tone={(r.sin_dueno ?? 0) > 0 ? "warn" : "ok"} />
        </div>

        {/* Siempre visible, tenga dueño o no. Antes aparecía sólo si había algo repartido, así
            que con todo sin identificar la pantalla no mostraba reparto ninguno y parecía que el
            sistema no supiera hacerlo. Lo que falta decidir también es un renglón acá, y se le
            puede hacer clic igual para ir a verlo. */}
        <div className="border-t border-border px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Cómo se reparte · clic para filtrar
          </div>
          <div className="flex flex-wrap gap-2">
            {reparto.map((o) => (
              <button
                key={o.oficina}
                type="button"
                onClick={() => {
                  setOficinaSel(oficinaSel === o.oficina ? "" : o.oficina);
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
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {([
            ["sin_dueno", `Sin identificar (${r.sin_dueno ?? 0})`],
            ["identificados", `Con dueño (${r.identificados ?? 0})`],
            ["casa", `En la casa (${r.en_la_casa ?? 0})`],
            ["todos", `Todos (${r.total ?? 0})`],
          ] as [Filtro, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setFiltro(v);
                setElegidos(new Set());
              }}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                filtro === v ? "bg-brand text-white" : "text-muted hover:bg-background hover:text-foreground"
              )}
            >
              {l}
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="min-w-[190px]">
              <Select
                value={oficinaSel}
                onChange={(v) => {
                  setOficinaSel(v);
                  setElegidos(new Set());
                }}
                options={[
                  { value: "", label: "Todas las oficinas" },
                  ...oficinas.map((o) => ({ value: o, label: o })),
                ]}
              />
            </div>
            <div className="min-w-[190px]">
              <Select
                value={agenteSel}
                onChange={(v) => {
                  setAgenteSel(v);
                  setElegidos(new Set());
                }}
                options={[
                  { value: "", label: "Todos los agentes" },
                  ...agentesEnArchivo.map((a) => ({ value: a, label: a })),
                ]}
              />
            </div>
          </div>
        </div>

        {/* El total de lo que se está viendo. Con la oficina filtrada, este es el número que va
            al WhatsApp de esa oficina, así que tiene que estar a la vista y no haber que sumarlo
            a mano renglón por renglón. */}
        <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border bg-background px-5 py-2 text-[13px]">
          <span className="text-muted">
            {visibles.length} renglón{visibles.length === 1 ? "" : "es"} a la vista
            {oficinaSel ? ` · ${oficinaSel}` : ""}
            {agenteSel ? ` · ${agenteSel}` : ""}
          </span>
          <span className="font-medium tabular-nums text-foreground">{money(montoVisible)}</span>
          {(oficinaSel || agenteSel) && (
            <button
              type="button"
              onClick={() => {
                setOficinaSel("");
                setAgenteSel("");
              }}
              className="text-[12px] text-muted underline hover:text-foreground"
            >
              quitar filtros
            </button>
          )}
        </div>

        {/* La barra de acciones aparece sólo con algo marcado: ocupando espacio siempre, sería
            una fila de controles apagados arriba de la tabla todos los días. */}
        {elegidos.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand-tint/40 px-5 py-3">
            <span className="text-[13px] font-medium text-foreground">
              {elegidos.size} marcado{elegidos.size === 1 ? "" : "s"} · {money(montoElegido)}
            </span>
            <div className="min-w-[220px]">
              <Select
                value={agenteLote}
                onChange={setAgenteLote}
                options={[{ value: "", label: "Asignar a…" }, ...opcionesAgente]}
              />
            </div>
            <Button onClick={asignar} disabled={guardando || !agenteLote}>
              Asignar
            </Button>
            <Button variant="ghost" onClick={aLaCasa} disabled={guardando}>
              <Home size={14} />
              A cuenta de la casa
            </Button>
          </div>
        )}

        {error && (
          <div className="border-b border-border bg-bad-tint px-5 py-2.5 text-[13px] text-bad-fg">{error}</div>
        )}

        {visibles.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">
            {oficinaSel || agenteSel
              ? "No hay cargos con esos filtros."
              : filtro === "sin_dueno"
                ? "No queda ningún cargo sin identificar. Todo tiene dueño."
                : "No hay cargos en este filtro."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-background">
                  <th className="w-10 px-5 py-2">
                    <input
                      type="checkbox"
                      checked={elegidos.size === visibles.length && visibles.length > 0}
                      onChange={alternarTodos}
                      aria-label="Marcar todos"
                    />
                  </th>
                  {["Oficina", "Agente", "Asegurado", "Conductor", "Lic.", "Fecha", "Monto", "Por qué"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
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
        )}
      </Card>
    </div>
  );
}

function FilaCargo({ c, marcado, onMarcar }: { c: CargoMvr; marcado: boolean; onMarcar: () => void }) {
  const conDueno = c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado";
  return (
    <tr className={clsx("border-b border-border last:border-b-0", marcado && "bg-brand-tint/30")}>
      <td className="px-5 py-2">
        <input type="checkbox" checked={marcado} onChange={onMarcar} aria-label={`Marcar ${c.asegurado_crudo ?? "cargo"}`} />
      </td>
      {/* La oficina es columna propia y primera: es la que decide a quién se le descuenta, así
          que es lo primero que hay que poder leer de corrido por toda la tabla. */}
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
      <td className="px-3.5 py-2">
        {c.es_comercial ? <span className="text-muted">Comercial (sin asegurado)</span> : c.asegurado_crudo ?? "—"}
      </td>
      <td className="px-3.5 py-2 text-muted">{c.conductor_crudo ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.estado_us ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.fecha_orden ?? "—"}</td>
      <td className="px-3.5 py-2 text-right font-medium tabular-nums">{money(Number(c.monto ?? 0))}</td>
      {/* El motivo en palabras, no el código de la regla. "score_bajo" no le dice nada a nadie
          un martes a la mañana. */}
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

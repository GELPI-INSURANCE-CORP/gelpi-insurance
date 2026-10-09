"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Home } from "lucide-react";
import { Card, CardHead, Kpi, Button, Badge, Select, Loading, EmptyState } from "@/components/agentes/ui";
import { money, etiquetaPeriodo } from "@/lib/format";
import { getMvrDetalle, asignarCargos, cargosACuentaCasa, type MvrDetalle, type CargoMvr } from "@/lib/queries/mvr";
import { listAgentes, type AgenteSimple } from "@/lib/queries/conciliacion";

// Un cargo de MVR no tiene póliza ni prima: tiene asegurado, conductor, estado de la licencia y
// fecha de orden. Por eso esta pantalla existe en vez de reusar la de statements, que son 1279
// líneas atadas a lineas_comision. Lo que sí se copia es la forma: encabezado con los números
// arriba, tabla abajo, acciones en lote.

type Filtro = "todos" | "sin_dueno" | "identificados" | "casa";

function MvrContenido() {
  const params = useSearchParams();
  const reporteId = params.get("id") ?? "";

  const [datos, setDatos] = useState<MvrDetalle | null>(null);
  const [agentes, setAgentes] = useState<AgenteSimple[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("sin_dueno");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [agenteLote, setAgenteLote] = useState("");
  const [guardando, setGuardando] = useState(false);

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

  const visibles = useMemo(() => {
    const todos = datos?.cargos ?? [];
    if (filtro === "sin_dueno") return todos.filter((c) => c.estado === "sin_identificar" || c.estado === "pendiente");
    if (filtro === "identificados")
      return todos.filter((c) => c.estado === "conciliado_auto" || c.estado === "conciliado_confirmado");
    if (filtro === "casa") return todos.filter((c) => c.estado === "cuenta_casa");
    return todos;
  }, [datos, filtro]);

  // Sobre los elegidos, no sobre todo: es el número que dice cuánta plata mueve la decisión que
  // está por tomar.
  const montoElegido = useMemo(
    () => (datos?.cargos ?? []).filter((c) => elegidos.has(c.id)).reduce((s, c) => s + Number(c.monto ?? 0), 0),
    [datos, elegidos]
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
        />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4">
          {/* Los cargos en cero van aparte: 100 de los 389 de agosto vinieron sin costo porque la
              compañía no los cobró, y contarlos juntos hace parecer mucha más plata de la que es. */}
          <Kpi label="Total cobrado" value={money(r.monto ?? 0)} />
          <Kpi label="Cargos" value={`${r.total ?? 0}`} sub={`${r.con_cargo ?? 0} con costo`} />
          <Kpi label="Con dueño" value={`${r.identificados ?? 0}`} />
          <Kpi label="Sin identificar" value={`${r.sin_dueno ?? 0}`} tone={(r.sin_dueno ?? 0) > 0 ? "warn" : "ok"} />
        </div>

        {(r.por_oficina ?? []).length > 0 && (
          <div className="border-t border-border px-5 py-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Cómo se reparte
            </div>
            <div className="flex flex-wrap gap-2">
              {(r.por_oficina ?? []).map((o) => (
                <span key={o.oficina} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px]">
                  {o.oficina} · <span className="font-medium tabular-nums">{money(o.monto)}</span>{" "}
                  <span className="text-muted">({o.cargos})</span>
                </span>
              ))}
            </div>
          </div>
        )}
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
            {filtro === "sin_dueno"
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
                  {["Asegurado", "Conductor", "Est.", "Fecha", "Monto", "Agente", "Por qué"].map((h) => (
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
      <td className="px-3.5 py-2">
        {c.es_comercial ? <span className="text-muted">Comercial (sin asegurado)</span> : c.asegurado_crudo ?? "—"}
      </td>
      <td className="px-3.5 py-2 text-muted">{c.conductor_crudo ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.estado_us ?? "—"}</td>
      <td className="px-3.5 py-2 text-muted">{c.fecha_orden ?? "—"}</td>
      <td className="px-3.5 py-2 text-right font-medium tabular-nums">{money(Number(c.monto ?? 0))}</td>
      <td className="px-3.5 py-2">
        {c.agente ? (
          <span className="flex flex-col">
            <span>{c.agente}</span>
            {c.oficina && <span className="text-[11px] text-muted">{c.oficina}</span>}
          </span>
        ) : c.estado === "cuenta_casa" ? (
          <Badge tone="neutral">La casa</Badge>
        ) : (
          <Badge tone="warn">Sin identificar</Badge>
        )}
      </td>
      {/* El motivo en palabras, no el código de la regla. "score_bajo" no le dice nada a nadie
          un martes a la mañana. */}
      <td className="px-3.5 py-2 text-[11px] text-muted">
        {conDueno
          ? c.regla_match === "manual"
            ? "Lo asignaste vos"
            : "Pegó contra las cotizaciones"
          : c.regla_match === "comercial_sin_asegurado"
            ? "La compañía lo manda sin asegurado"
            : c.regla_match === "sin_candidato"
              ? "No aparece en las cotizaciones"
              : c.regla_match === "score_bajo"
                ? `Parecido bajo (${c.score ?? 0}%)`
                : c.regla_match ?? "—"}
      </td>
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

"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, X } from "lucide-react";
import { Card, CardHead, Badge, Button, Select, TextInput, Loading, EmptyState } from "@/components/agentes/ui";
import { money, fecha as fmtFecha, etiquetaPeriodo, TIPOS_TRANSACCION, ESTADOS_LINEA } from "@/lib/format";
import { getStatementsConsolidados, type StatementConsolidado, type LineaConsolidada } from "@/lib/queries/statement";

// Varios statements mirados como uno.
//
// NO se fusiona nada. Los reportes siguen existiendo enteros y por separado — es lo único que
// deja cuadrar contra el total que declaró cada compañía, y eso fue justo lo que salvó a Kemper
// cuando sus números no daban. Acá los ids viajan en la URL y la pantalla lee a través de todos.
//
// El orden de lo que se ve sale de para qué se usa: primero cuánto entró en total, después qué
// falta por resolver, y al final el detalle. Quien abre esto viene a cerrar un mes.

export default function ConsolidadoPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Contenido />
    </Suspense>
  );
}

function Contenido() {
  const router = useRouter();
  const params = useSearchParams();
  const idsUrl = (params.get("reportes") ?? "").split(",").filter(Boolean);

  const [ids, setIds] = useState<string[]>(idsUrl);
  const [datos, setDatos] = useState<StatementConsolidado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [oficina, setOficina] = useState("");
  const [agente, setAgente] = useState("");
  const [compania, setCompania] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [agruparPorOficina, setAgruparPorOficina] = useState(false);

  const cargar = useCallback(async () => {
    if (ids.length === 0) {
      setDatos(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      setDatos(await getStatementsConsolidados(ids));
    } catch (e) {
      setError(porQue(e));
    } finally {
      setCargando(false);
    }
  }, [ids]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Quitar un statement de la vista reescribe la URL: así el consolidado se puede compartir o
  // volver a abrir tal como quedó.
  function quitar(id: string) {
    const quedan = ids.filter((x) => x !== id);
    setIds(quedan);
    router.replace(quedan.length ? `/comisiones/consolidado/?reportes=${quedan.join(",")}` : "/comisiones/subir/");
  }

  const lineas = datos?.lineas ?? [];

  const opciones = useMemo(() => {
    const unicos = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
    return {
      oficinas: unicos(lineas.map((l) => l.oficina)),
      agentes: unicos(lineas.map((l) => l.agente)),
      companias: unicos(lineas.map((l) => l.compania)),
    };
  }, [lineas]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lineas.filter((l) => {
      if (oficina && l.oficina !== oficina) return false;
      if (agente && l.agente !== agente) return false;
      if (compania && l.compania !== compania) return false;
      if (soloPendientes && l.grupo === "aprobado") return false;
      if (!q) return true;
      return (
        (l.cliente ?? "").toLowerCase().includes(q) ||
        (l.numeroPoliza ?? "").toLowerCase().includes(q) ||
        (l.agente ?? "").toLowerCase().includes(q)
      );
    });
  }, [lineas, busqueda, oficina, agente, compania, soloPendientes]);

  const total = filtradas.reduce((s, l) => s + l.monto, 0);
  const pendientes = filtradas.filter((l) => l.grupo !== "aprobado" && l.grupo !== "excluida");
  const sinAgente = filtradas.filter((l) => !l.agente);

  // Por oficina, que es el corte que pidió Arturo. Se calcula sobre lo filtrado y no sobre todo,
  // para que el desglose siempre sume el total que se está viendo arriba.
  const porOficina = useMemo(() => {
    const m = new Map<string, { lineas: number; prima: number; monto: number }>();
    for (const l of filtradas) {
      const k = l.oficina ?? "Sin oficina";
      const a = m.get(k) ?? { lineas: 0, prima: 0, monto: 0 };
      a.lineas++;
      a.prima += l.prima ?? 0;
      a.monto += l.monto;
      m.set(k, a);
    }
    return [...m.entries()].sort((x, y) => y[1].monto - x[1].monto);
  }, [filtradas]);

  function exportar() {
    const cab = ["Compañía", "Statement", "Póliza", "Cliente", "Vigencia", "Tipo", "Agente", "Oficina", "Prima", "Comisión", "Estado"];
    const filas = filtradas.map((l) =>
      [l.compania, etiquetaPeriodo(l.periodo) ?? "", l.numeroPoliza ?? "", l.cliente ?? "",
       l.fechaVigencia ?? "", TIPOS_TRANSACCION[l.tipoTransaccion] ?? l.tipoTransaccion,
       l.agente ?? "", l.oficina ?? "", l.prima ?? "", l.monto.toFixed(2),
       ESTADOS_LINEA[l.estadoLinea]?.label ?? l.estadoLinea]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const url = URL.createObjectURL(new Blob([[cab.join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `consolidado-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!cargando && ids.length === 0) {
    return (
      <EmptyState
        title="No hay statements seleccionados"
        subtitle="Volvé a la lista, marcá los statements finalizados que querés ver juntos y dale a Consolidar."
        action={<Link href="/comisiones/subir/" className="text-[13px] text-brand underline">Ir a la lista</Link>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/comisiones/subir/" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
          <ArrowLeft size={15} />
          Volver a los statements
        </Link>
        <Button variant="primary" onClick={exportar} disabled={filtradas.length === 0}>
          <Download className="h-3.5 w-3.5" />
          Exportar a Excel
        </Button>
      </div>

      {error && <div className="rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-3 text-[13px] text-bad-fg">{error}</div>}
      {cargando && <Loading />}

      {datos && !cargando && (
        <>
          {/* Los statements que entraron, quitables. Sin esto no hay forma de saber qué estás
              mirando cuando el total no es el que esperabas. */}
          <div className="flex flex-wrap items-center gap-2">
            {datos.reportes.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1.5 text-[12px]"
              >
                <span className="font-medium text-foreground">{r.compania}</span>
                <span className="text-muted">{etiquetaPeriodo(r.periodo) ?? "sin mes"}</span>
                <span className="tabular-nums text-muted">{money(r.monto)}</span>
                <button
                  type="button"
                  onClick={() => quitar(r.id)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
                  aria-label={`Quitar ${r.compania}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>

          {/* Mezclar meses no se prohíbe — a veces hace falta — pero se avisa, porque los totales
              por mes son los que alimentan el royalty y un consolidado a caballo entre dos meses
              se lee igual que uno solo si nadie lo dice. */}
          {datos.periodosDistintos.length > 1 && (
            <div className="flex items-center gap-2 rounded-lg border border-warn-fg/30 bg-warn-bg px-4 py-2.5 text-[13px] text-warn-fg">
              <AlertTriangle size={15} className="flex-shrink-0" />
              Estás mezclando {datos.periodosDistintos.length} meses ({datos.periodosDistintos.map((p) => etiquetaPeriodo(p)).join(", ")}).
              El total de abajo los suma todos.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Comisión total" valor={money(total)} sub={`${filtradas.length} líneas`} />
            <Kpi
              label="Sin resolver"
              valor={money(pendientes.reduce((s, l) => s + l.monto, 0))}
              sub={`${pendientes.length} líneas`}
              tono={pendientes.length > 0 ? "warn" : undefined}
            />
            <Kpi
              label="Sin agente"
              valor={money(sinAgente.reduce((s, l) => s + l.monto, 0))}
              sub={`${sinAgente.length} líneas`}
              tono={sinAgente.length > 0 ? "bad" : undefined}
            />
          </div>

          <Card>
            <CardHead
              title="Todas las líneas juntas"
              subtitle={`${datos.reportes.length} statements · ${lineas.length} líneas en total`}
              actions={
                <Button size="sm" variant={agruparPorOficina ? "primary" : "secondary"} onClick={() => setAgruparPorOficina((v) => !v)}>
                  Agrupar por oficina
                </Button>
              }
            />

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
              <TextInput
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar cliente, póliza o agente…"
                className="h-8 w-64"
              />
              <Select value={oficina} onChange={setOficina} options={[{ value: "", label: "Todas las oficinas" }, ...opciones.oficinas.map((o) => ({ value: o, label: o }))]} className="h-8" />
              <Select value={agente} onChange={setAgente} options={[{ value: "", label: "Todos los agentes" }, ...opciones.agentes.map((a) => ({ value: a, label: a }))]} className="h-8" />
              <Select value={compania} onChange={setCompania} options={[{ value: "", label: "Todas las compañías" }, ...opciones.companias.map((c) => ({ value: c, label: c }))]} className="h-8" />
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
                Solo lo que falta resolver
              </label>
            </div>

            {agruparPorOficina ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th className="px-5 py-2.5 font-medium">Oficina</th>
                      <th className="px-5 py-2.5 text-right font-medium">Líneas</th>
                      <th className="px-5 py-2.5 text-right font-medium">Prima</th>
                      <th className="px-5 py-2.5 text-right font-medium">Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porOficina.map(([nombre, v]) => (
                      <tr key={nombre} className="border-b border-border last:border-b-0">
                        <td className="px-5 py-2.5 font-medium text-foreground">{nombre}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-muted">{v.lineas}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-muted">{money(v.prima)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-foreground">{money(v.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-background/60">
                      <td className="px-5 py-2.5 font-semibold" colSpan={3}>Total</td>
                      <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{money(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="max-h-[600px] overflow-auto">
                <table className="w-full min-w-[980px] text-[13px]">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr className="border-b border-border text-left text-muted">
                      <th className="px-4 py-2.5 font-medium">Compañía</th>
                      <th className="px-4 py-2.5 font-medium">Póliza</th>
                      <th className="px-4 py-2.5 font-medium">Cliente</th>
                      <th className="px-4 py-2.5 font-medium">Vigencia</th>
                      <th className="px-4 py-2.5 font-medium">Tipo</th>
                      <th className="px-4 py-2.5 font-medium">Agente</th>
                      <th className="px-4 py-2.5 font-medium">Oficina</th>
                      <th className="px-4 py-2.5 text-right font-medium">Prima</th>
                      <th className="px-4 py-2.5 text-right font-medium">Comisión</th>
                      <th className="px-4 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((l) => {
                      const est = ESTADOS_LINEA[l.estadoLinea];
                      return (
                        <tr key={l.id} className="border-b border-border last:border-b-0">
                          <td className="whitespace-nowrap px-4 py-2 text-muted">{l.compania}</td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums">{l.numeroPoliza ?? "—"}</td>
                          <td className="px-4 py-2">{l.cliente ?? "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted">
                            {l.fechaVigencia ? fmtFecha(l.fechaVigencia) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-muted">
                            {TIPOS_TRANSACCION[l.tipoTransaccion] ?? l.tipoTransaccion}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2">{l.agente ?? <span className="text-bad-fg">Sin agente</span>}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-muted">{l.oficina ?? "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted">{l.prima == null ? "—" : money(l.prima)}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums">{money(l.monto)}</td>
                          <td className="px-4 py-2">
                            {est ? <Badge tone={est.tone}>{est.label}</Badge> : l.estadoLinea}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtradas.length === 0 && (
                  <EmptyState title="Nada con esos filtros" subtitle="Probá quitando alguno." />
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, sub, tono }: { label: string; valor: string; sub: string; tono?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="text-[24px] font-semibold tabular-nums text-foreground">{valor}</div>
      <div className={tono === "bad" ? "text-xs text-bad-fg" : tono === "warn" ? "text-xs text-warn-fg" : "text-xs text-muted"}>
        {sub}
      </div>
    </div>
  );
}

// Los errores de Supabase no son Error: son objetos con message/hint/details. Tragarselos y
// mostrar "no se pudo" deja al usuario -y a quien lo depura- mirando una pared. Esta pantalla
// fallo la primera vez porque pedia una columna que no existe, y el mensaje generico escondio
// exactamente eso.
function porQue(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.details, o.hint].filter((x) => typeof x === "string" && x);
    if (partes.length) return partes.join(" — ");
  }
  return "No se pudo armar el consolidado.";
}
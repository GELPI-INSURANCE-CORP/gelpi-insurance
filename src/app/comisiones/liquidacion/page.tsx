"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, AlertTriangle, ChevronRight, Lock, Unlock, GitCompare } from "lucide-react";
import { Card, Select, TextInput, Button, Badge, Loading, EmptyState, Banner } from "@/components/agentes/ui";
import { money, fechaHora } from "@/lib/format";
import {
  getLiquidacion,
  actualizarPctSplit,
  actualizarPctSobrePrima,
  cerrarLiquidacion,
  reabrirLiquidacion,
  periodoActual,
  getAlertasDelLibro,
  type Liquidacion,
  type AlertaDelLibro,
} from "@/lib/queries/liquidacion";
import DetalleAgenteDrawer from "@/components/liquidacion/DetalleAgenteDrawer";
import AlertasLibroPanel from "@/components/liquidacion/AlertasLibroPanel";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function etiquetaPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombre = MESES[mes - 1] ?? periodo;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

// Últimos 18 meses hacia atrás desde el mes actual.
function periodosDisponibles(): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function LiquidacionContent() {
  const [periodo, setPeriodo] = useState(periodoActual);
  const [data, setData] = useState<Liquidacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soloActivos, setSoloActivos] = useState(true);
  // % en edición por agente (texto libre mientras escribe; se guarda al salir del campo)
  const [pctEditado, setPctEditado] = useState<Record<string, string>>({});
  // El % sobre premium, que es la base de pago buena. Va aparte del de comisión porque son dos
  // números distintos que conviven mientras se comparan los dos cálculos.
  const [pctPrimaEditado, setPctPrimaEditado] = useState<Record<string, string>>({});
  // Qué oficinas están desplegadas. Arrancan cerradas: la pantalla abre con una línea por
  // oficina y se entra a la que interese.
  const [oficinasAbiertas, setOficinasAbiertas] = useState<Set<string>>(new Set());
  // Qué agente está abierto en el panel de detalle. Se guarda el id y el nombre juntos para no
  // tener que buscarlo de nuevo en la lista cuando el panel se dibuja.
  // "foco" es en qué caja abre el panel. Desde el premium se entra a ver todo; desde la columna
  // de sin clasificar se entra directo a lo que hay que resolver, que es la diferencia entre
  // "acá hay un problema" y "acá está el problema, resolvelo".
  // Las contradicciones del Book se cargan aparte del periodo: no dependen del mes elegido, y
  // si la consulta falla la pantalla de pago tiene que seguir andando igual.
  const [alertas, setAlertas] = useState<AlertaDelLibro[]>([]);
  // Cuál de las alertas se está mirando. Avisar de un problema sin dar dónde resolverlo no es
  // una alerta, es una preocupación.
  const [verAlerta, setVerAlerta] = useState<string | null>(null);
  const [verDetalle, setVerDetalle] = useState<
    { id: string; nombre: string; foco: "todas" | "sin_clasificar" } | null
  >(null);

  useEffect(() => {
    void getAlertasDelLibro().then(setAlertas);
  }, []);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [cerrandoMes, setCerrandoMes] = useState(false);

  const cargar = useCallback(() => {
    setLoading(true);
    getLiquidacion(periodo)
      .then((d) => {
        setData(d);
        setPctEditado({});
        setPctPrimaEditado({});
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la liquidación."))
      .finally(() => setLoading(false));
  }, [periodo]);

  useEffect(() => cargar(), [cargar]);

  async function guardarPct(agenteId: string, valor: string) {
    const pct = Number(valor);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError("El porcentaje tiene que ser un número entre 0 y 100.");
      setPctEditado((prev) => {
        const next = { ...prev };
        delete next[agenteId];
        return next;
      });
      return;
    }
    const actual = data?.filas.find((f) => f.agenteId === agenteId)?.pct;
    if (actual != null && pct === actual) return;
    setGuardando(agenteId);
    try {
      await actualizarPctSplit(agenteId, pct);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el porcentaje.");
    } finally {
      setGuardando(null);
    }
  }

  // Dejar el campo vacío borra el porcentaje (queda nulo, "sin definir") en vez de ponerlo en 0.
  // No es lo mismo: uno es que todavía no se decidió y el otro es que a esa persona no se le
  // paga, y la tabla los muestra distinto.
  async function guardarPctPrima(agenteId: string, valor: string) {
    const texto = valor.trim();
    const pct = texto === "" ? null : Number(texto);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError("El porcentaje sobre premium tiene que ser un número entre 0 y 100.");
      setPctPrimaEditado((prev) => {
        const next = { ...prev };
        delete next[agenteId];
        return next;
      });
      return;
    }
    const actual = data?.filas.find((f) => f.agenteId === agenteId)?.pctPrima ?? null;
    if (pct === actual) return;
    setGuardando(agenteId);
    try {
      await actualizarPctSobrePrima(agenteId, pct);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el porcentaje sobre premium.");
    } finally {
      setGuardando(null);
    }
  }

  async function onCerrarMes() {
    if (!data) return;
    const aviso =
      data.sinAsignar !== 0
        ? `Ojo: quedan ${money(data.sinAsignar)} de comisión sin dueño que NO entran en este pago.\n\n`
        : "";
    const ok = window.confirm(
      `${aviso}Cerrar ${etiquetaPeriodo(periodo)} congela lo que se le paga a cada agente: ${money(
        data.totalAPagar
      )} en total.\n\nDespués de esto, cambiarle el % a un agente ya no va a mover este mes. ¿Continuar?`
    );
    if (!ok) return;
    setCerrandoMes(true);
    try {
      await cerrarLiquidacion(periodo);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar el período.");
    } finally {
      setCerrandoMes(false);
    }
  }

  async function onReabrirMes() {
    const ok = window.confirm(
      `Reabrir ${etiquetaPeriodo(periodo)} borra la foto guardada y el mes vuelve a calcularse con los % de hoy.\n\nSi ya le pagaste a los agentes con esos números, los que veas después pueden no coincidir con lo que pagaste. ¿Continuar?`
    );
    if (!ok) return;
    setCerrandoMes(true);
    try {
      await reabrirLiquidacion(periodo);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reabrir el período.");
    } finally {
      setCerrandoMes(false);
    }
  }

  const filas = useMemo(() => {
    const todas = data?.filas ?? [];
    return soloActivos ? todas.filter((f) => f.activo) : todas;
  }, [data, soloActivos]);

  // Agrupadas por oficina. Arturo: *"no necesito tener toda esta cantidad de gente [...] que en
  // cada oficina yo entre y vea el agente de esa oficina"*. Con cincuenta agentes en una sola
  // lista no se lee nada; así la pantalla arranca con una línea por oficina y se abre la que
  // interese. Ordenadas por premium vendido, que es lo que decide el pago.
  const grupos = useMemo(() => {
    const porOficina = new Map<string, typeof filas>();
    for (const f of filas) {
      const actual = porOficina.get(f.oficinaNombre);
      if (actual) actual.push(f);
      else porOficina.set(f.oficinaNombre, [f]);
    }
    return [...porOficina.entries()]
      .map(([oficina, agentes]) => ({
        oficina,
        agentes,
        primaNuevo: agentes.reduce((s, a) => s + a.primaNuevo, 0),
        // Las dueñas quedan fuera del total a pagar: su premium se sigue viendo, porque es
        // producción de la oficina y cuenta para el royalty, pero no hay un cheque que girarles.
        aPagarPrima: agentes.reduce((s, a) => s + (a.esDuenoOficina ? 0 : a.aPagarPrima), 0),
        comisionNuevo: agentes.reduce((s, a) => s + a.comisionNuevo, 0),
        aPagar: agentes.reduce((s, a) => s + a.aPagar, 0),
        sinClasificar: agentes.reduce((s, a) => s + a.primaSinClasificar, 0),
        sinPct: agentes.filter((a) => !a.esDuenoOficina && a.pctPrima == null && a.primaNuevo !== 0).length,
      }))
      .sort((a, b) => b.primaNuevo - a.primaNuevo);
  }, [filas]);

  const totalNuevo = filas.reduce((s, f) => s + f.comisionNuevo, 0);
  // En PRIMA y no en comisión. Esta pantalla paga sobre prima: mostrar acá la comisión sin
  // clasificar contesta una pregunta que nadie está haciendo, y hace que la columna no se pueda
  // comparar con la de al lado.
  const totalSinClasificar = filas.reduce((s, f) => s + f.primaSinClasificar, 0);
  const totalAPagar = filas.reduce((s, f) => s + f.aPagar, 0);
  const totalPrimaNuevo = filas.reduce((s, f) => s + f.primaNuevo, 0);
  const totalAPagarPrima = filas.reduce((s, f) => s + (f.esDuenoOficina ? 0 : f.aPagarPrima), 0);
  // Cuántos venden pero todavía no tienen definido el % sobre premium. Mientras ese número no
  // sea cero, el total a pagar de abajo está incompleto y hay que decirlo.
  const faltaPct = filas.filter((f) => f.pctPrima == null && f.primaNuevo !== 0).length;

  function exportarCsv() {
    const header = [
      "Agente", "Oficina",
      "New business premium", "% sobre premium", "A pagar",
      "% comisión", "Negocio nuevo", "Renovación", "Sin clasificar", "Comisión total", "A pagar (cálculo viejo)",
    ];
    const lineas = filas.map((f) =>
      [
        f.nombre, f.oficinaNombre,
        f.primaNuevo.toFixed(2), f.pctPrima == null ? "" : f.pctPrima, f.aPagarPrima.toFixed(2),
        f.pct,
        f.comisionNuevo.toFixed(2), f.comisionRenovacion.toFixed(2),
        f.esDuenoOficina ? "dueño/a" : f.primaSinClasificar.toFixed(2), f.comisionRecibida.toFixed(2), f.aPagar.toFixed(2),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lineas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `liquidacion-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-foreground">Liquidación de comisiones</h1>
        <div className="flex items-center gap-2">
          <Select
            value={periodo}
            onChange={setPeriodo}
            options={periodosDisponibles().map((p) => ({ value: p, label: etiquetaPeriodo(p) }))}
          />
          <Button size="sm" onClick={() => setSoloActivos((v) => !v)}>
            {soloActivos ? "Ver todos" : "Solo activos"}
          </Button>
          {data?.cerrada ? (
            <Button size="sm" variant="secondary" onClick={onReabrirMes} disabled={cerrandoMes}>
              <Unlock className="w-3.5 h-3.5" />
              {cerrandoMes ? "Reabriendo…" : "Reabrir mes"}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onCerrarMes} disabled={cerrandoMes || filas.length === 0}>
              <Lock className="w-3.5 h-3.5" />
              {cerrandoMes ? "Cerrando…" : "Cerrar mes"}
            </Button>
          )}
          <Link
            href="/comisiones/cruce/"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] hover:bg-background"
            title="Comparar lo que se vendió contra lo que pagaron las compañías"
          >
            <GitCompare className="h-3.5 w-3.5" />
            Cruce con ventas
          </Link>
          <Button size="sm" variant="primary" onClick={exportarCsv} disabled={filas.length === 0}>
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {error && (
        <Banner tone="bad" action={<button type="button" className="text-xs underline" onClick={() => setError(null)}>Cerrar</button>}>
          {error}
        </Banner>
      )}

      {data?.cerrada ? (
        <Banner tone="info">
          <Lock className="w-3.5 h-3.5 inline mr-1.5" />
          Mes cerrado el {fechaHora(data.cerradaEn)}. Estos son los números con los que se pagó: cambiarle el %
          a un agente de ahora en adelante no los va a mover. Para recalcularlo hay que reabrir el mes.
        </Banner>
      ) : (
        <Banner tone="info">
          El pago sale del <strong>New business premium</strong>: lo que el agente le vendió al cliente. El
          porcentaje se pone por agente adentro de cada oficina y se guarda solo. A la derecha, en gris, queda
          el cálculo viejo sobre la comisión que cobra la agencia, para poder comparar. Solo cuenta lo ya
          conciliado. Cuando le pagues, cerrá el mes para congelar estos números.
        </Banner>
      )}

      {/* Mientras falten porcentajes el total de abajo está incompleto, y eso hay que decirlo
          antes de que alguien lo use para pagar. */}
      {!data?.cerrada && faltaPct > 0 && (
        <Banner tone="warn">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          Hay {faltaPct} agente{faltaPct === 1 ? "" : "s"} con ventas y sin % sobre premium definido. Hasta que
          no se lo pongas, su pago sale en blanco y no entra en el total.
        </Banner>
      )}

      {/* Arriba de todo y antes de cualquier numero: si el Book se contradice, lo que hay abajo
          puede estar mal y no se nota mirandolo. El caso que lo pidio es un agente que cambia de
          oficina y deja sus polizas viejas con la oficina anterior — ahi la plata se le va a la
          oficina que no es, y el royalty tambien. Normalmente no se ve nada acá. */}
      {alertas.map((a) => (
        <Banner
          key={a.tipo}
          tone="bad"
          action={
            <button
              type="button"
              onClick={() => setVerAlerta(a.tipo)}
              className="whitespace-nowrap text-xs font-medium underline hover:no-underline"
            >
              Ver {a.n === 1 ? "la póliza" : `las ${a.n}`}
            </button>
          }
        >
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          <strong>Revisá el Book antes de pagar.</strong> {a.titulo}: {a.detalle}
          {a.monto !== 0 && <> · {money(a.monto)} en juego</>}
        </Banner>
      ))}

      {data && data.sinAsignar !== 0 && (
        <Banner
          tone="warn"
          action={
            <a href="/comisiones/conciliacion/" className="text-xs underline">
              Ir a Conciliación
            </a>
          }
        >
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          Hay {money(data.sinAsignar)} de comisión de este mes sin dueño asignado — no está incluida en los
          totales de abajo.
        </Banner>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium">Agente</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                {/* LA BASE DE PAGO: lo que vendió el cliente. Va primero porque es el número que
                    manda; lo que cobra la agencia es otra cosa y va después, en gris. */}
                <th className="px-4 py-2.5 font-medium text-right">New business premium</th>
                <th className="px-4 py-2.5 font-medium w-28">% s/ premium</th>
                <th className="px-4 py-2.5 font-medium text-right">A pagar</th>
                {/* El cálculo viejo, para comparar los primeros meses. La línea a la izquierda
                    separa las dos cuentas para que no se lean como una sola. */}
                <th className="border-l border-border px-4 py-2.5 font-medium text-right text-muted">Comisión nuevo</th>
                <th className="px-4 py-2.5 font-medium text-muted w-24">% com.</th>
                <th className="px-4 py-2.5 font-medium text-right text-muted">A pagar (viejo)</th>
                <th className="px-4 py-2.5 font-medium text-right">Prima sin clasificar</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const abierta = oficinasAbiertas.has(g.oficina);
                return (
                  <Fragment key={g.oficina}>
                    {/* La línea de la oficina: sus totales, y el clic la abre. */}
                    <tr
                      className="cursor-pointer border-t border-border bg-background/60 hover:bg-background"
                      onClick={() =>
                        setOficinasAbiertas((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.oficina)) next.delete(g.oficina);
                          else next.add(g.oficina);
                          return next;
                        })
                      }
                    >
                      <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                        <span className="inline-flex items-center gap-2">
                          <ChevronRight
                            size={14}
                            className={abierta ? "rotate-90 transition-transform" : "transition-transform"}
                            aria-hidden
                          />
                          {g.oficina}
                          <span className="font-normal text-muted">
                            {g.agentes.length} agente{g.agentes.length === 1 ? "" : "s"}
                          </span>
                          {g.sinPct > 0 && (
                            <Badge tone="warn">
                              {g.sinPct} sin %
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(g.primaNuevo)}</td>
                      <td />
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(g.aPagarPrima)}</td>
                      <td className="border-l border-border px-4 py-2.5 text-right tabular-nums text-muted">{money(g.comisionNuevo)}</td>
                      <td />
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(g.aPagar)}</td>
                      <td
                        className={
                          g.sinClasificar !== 0
                            ? "px-4 py-2.5 text-right tabular-nums text-warn-fg"
                            : "px-4 py-2.5 text-right tabular-nums text-muted"
                        }
                      >
                        {money(g.sinClasificar)}
                      </td>
                    </tr>

                    {abierta &&
                      g.agentes.map((f) => (
                        <tr key={f.agenteId} className="border-t border-border">
                          <td className="px-4 py-2.5 pl-10 font-medium">{f.nombre}</td>
                          <td className="px-4 py-2.5">
                            <Badge tone={f.activo ? "ok" : "neutral"}>{f.activo ? "Activo" : "Inactivo"}</Badge>
                          </td>

                          {/* El premium es la puerta al detalle: de acá sale el pago, así que tiene
                              que poder abrirse y ver de dónde. Texto plano cuando no hay nada, para
                              no ofrecer un clic que no lleva a ningún lado. */}
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {f.primaNuevo === 0 && f.comisionNuevo === 0 && f.comisionSinClasificar === 0 ? (
                              money(f.primaNuevo)
                            ) : (
                              <button
                                type="button"
                                onClick={() => setVerDetalle({ id: f.agenteId, nombre: f.nombre, foco: "todas" })}
                                className="tabular-nums font-medium underline decoration-dotted underline-offset-4 hover:text-brand"
                                title={`Ver todo lo que vendió ${f.nombre} en ${etiquetaPeriodo(periodo)}`}
                              >
                                {money(f.primaNuevo)}
                              </button>
                            )}
                          </td>

                          <td className="px-4 py-2.5">
                            {/* En un mes cerrado el % es parte del recibo, no un campo: dejarlo
                                editable daría a entender que cambiarlo corrige lo que ya se pagó. */}
                            {f.esDuenoOficina ? (
                              <Badge tone="brand">dueño/a</Badge>
                            ) : data?.cerrada ? (
                              <span className="tabular-nums">{f.pctPrima == null ? "—" : `${f.pctPrima}%`}</span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <TextInput
                                  value={pctPrimaEditado[f.agenteId] ?? (f.pctPrima == null ? "" : String(f.pctPrima))}
                                  onChange={(e) =>
                                    setPctPrimaEditado((prev) => ({ ...prev, [f.agenteId]: e.target.value }))
                                  }
                                  onBlur={() =>
                                    guardarPctPrima(
                                      f.agenteId,
                                      pctPrimaEditado[f.agenteId] ?? (f.pctPrima == null ? "" : String(f.pctPrima))
                                    )
                                  }
                                  inputMode="decimal"
                                  placeholder="—"
                                  className="w-16 h-8"
                                />
                                <span className="text-muted">%</span>
                                {guardando === f.agenteId && <span className="text-[11px] text-muted">guardando…</span>}
                              </div>
                            )}
                          </td>

                          {/* Sin % definido no se muestra $0.00: eso se leería como "no le toca
                              nada" cuando lo que pasa es que falta configurarlo. */}
                          {/* A una dueña no se le gira un cheque por su producción: se queda con
                              lo que deja su oficina, menos el royalty. Mostrarle un "a pagar"
                              era invitar a pagar dos veces — y con el % en 100 que tenían, el
                              número que salía era el premium entero. */}
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                            {f.esDuenoOficina ? (
                              <span className="text-[12px] font-normal text-muted">no lleva pago</span>
                            ) : f.pctPrima == null && f.primaNuevo !== 0 ? (
                              <span className="text-[12px] font-normal text-warn-fg">falta el %</span>
                            ) : (
                              money(f.aPagarPrima)
                            )}
                          </td>

                          <td className="border-l border-border px-4 py-2.5 text-right tabular-nums text-muted">
                            {money(f.comisionNuevo)}
                          </td>
                          <td className="px-4 py-2.5 text-muted">
                            {data?.cerrada ? (
                              <span className="tabular-nums">{f.pct}%</span>
                            ) : (
                              <div className="flex items-center gap-1">
                                <TextInput
                                  value={pctEditado[f.agenteId] ?? String(f.pct)}
                                  onChange={(e) => setPctEditado((prev) => ({ ...prev, [f.agenteId]: e.target.value }))}
                                  onBlur={() => guardarPct(f.agenteId, pctEditado[f.agenteId] ?? String(f.pct))}
                                  inputMode="decimal"
                                  className="w-14 h-8"
                                />
                                <span className="text-muted">%</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(f.aPagar)}</td>

                          {/* Se entra acá. Ver que a Heidi le faltan $16.380,91 por decidir no
                              sirve de nada si después hay que ir a buscarla a mano entre cientos
                              de líneas en otra pantalla — que es exactamente por lo que en seis
                              meses nadie clasificó nunca nada.

                              Solo se pinta cuando hay algo: un cero en amarillo en todas las
                              filas entrena a ignorar el color justo cuando importa. */}
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {f.primaSinClasificar === 0 ? (
                              <span className="text-muted">{money(0)}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setVerDetalle({ id: f.agenteId, nombre: f.nombre, foco: "sin_clasificar" })
                                }
                                className="tabular-nums font-medium text-warn-fg underline decoration-dotted underline-offset-4 hover:text-foreground"
                                title={`Revisar y clasificar lo que falta de ${f.nombre}`}
                              >
                                {money(f.primaSinClasificar)}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-background/60">
                  <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                    Total {etiquetaPeriodo(periodo)} · {grupos.length} oficina{grupos.length === 1 ? "" : "s"} ·{" "}
                    {filas.length} agente{filas.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(totalPrimaNuevo)}</td>
                  <td />
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(totalAPagarPrima)}</td>
                  <td className="border-l border-border px-4 py-2.5 text-right tabular-nums text-muted">
                    {money(totalNuevo)}
                  </td>
                  <td />
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(totalAPagar)}</td>
                  <td
                    className={
                      totalSinClasificar !== 0
                        ? "px-4 py-2.5 text-right tabular-nums font-semibold text-warn-fg"
                        : "px-4 py-2.5 text-right tabular-nums text-muted"
                    }
                  >
                    {money(totalSinClasificar)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          {loading && <Loading />}
          {!loading && filas.length === 0 && (
            <EmptyState title="Sin agentes" subtitle="No hay agentes para mostrar en este período." />
          )}
        </div>
      </Card>

      {verAlerta && <AlertasLibroPanel tipo={verAlerta} onClose={() => setVerAlerta(null)} />}

      {verDetalle && (
        <DetalleAgenteDrawer
          agenteId={verDetalle.id}
          nombre={verDetalle.nombre}
          periodo={periodo}
          etiquetaPeriodo={etiquetaPeriodo(periodo)}
          focoInicial={verDetalle.foco}
          onClose={() => setVerDetalle(null)}
          // Clasificar cambia cuánto se le paga: la tabla de atrás tiene que reflejarlo sin que
          // haya que recargar la página a mano.
          onCambio={() => void cargar()}
        />
      )}
    </div>
  );
}

export default function LiquidacionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LiquidacionContent />
    </Suspense>
  );
}

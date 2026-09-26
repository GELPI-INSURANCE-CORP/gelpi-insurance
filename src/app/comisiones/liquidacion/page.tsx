"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Download, AlertTriangle, Lock, Unlock } from "lucide-react";
import { Card, Select, TextInput, Button, Badge, Loading, EmptyState, Banner } from "@/components/agentes/ui";
import { money, fechaHora } from "@/lib/format";
import {
  getLiquidacion,
  actualizarPctSplit,
  cerrarLiquidacion,
  reabrirLiquidacion,
  periodoActual,
  type Liquidacion,
} from "@/lib/queries/liquidacion";

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
  const [guardando, setGuardando] = useState<string | null>(null);
  const [cerrandoMes, setCerrandoMes] = useState(false);

  const cargar = useCallback(() => {
    setLoading(true);
    getLiquidacion(periodo)
      .then((d) => {
        setData(d);
        setPctEditado({});
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

  const totalRecibido = filas.reduce((s, f) => s + f.comisionRecibida, 0);
  const totalNuevo = filas.reduce((s, f) => s + f.comisionNuevo, 0);
  const totalRenovacion = filas.reduce((s, f) => s + f.comisionRenovacion, 0);
  const totalSinClasificar = filas.reduce((s, f) => s + f.comisionSinClasificar, 0);
  const totalAPagar = filas.reduce((s, f) => s + f.aPagar, 0);

  function exportarCsv() {
    const header = [
      "Agente", "Oficina", "% comisión",
      "Negocio nuevo", "Renovación", "Sin clasificar", "Comisión total", "A pagar",
    ];
    const lineas = filas.map((f) =>
      [
        f.nombre, f.oficinaNombre, f.pct,
        f.comisionNuevo.toFixed(2), f.comisionRenovacion.toFixed(2),
        f.comisionSinClasificar.toFixed(2), f.comisionRecibida.toFixed(2), f.aPagar.toFixed(2),
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
          Solo cuenta la comisión ya conciliada (la que el sistema sabe de quién es). Cambiá el % de un agente
          directo en la tabla: se guarda solo y el cálculo se actualiza al instante. Cuando le pagues, cerrá el
          mes para congelar estos números.
        </Banner>
      )}

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
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium">Agente</th>
                <th className="px-4 py-2.5 font-medium">Oficina</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium w-32">% comisión</th>
                {/* El orden cuenta la cuenta: se paga sobre negocio nuevo, la renovación no se
                    paga, y lo que no se pudo clasificar queda a la vista para revisarlo. */}
                <th className="px-4 py-2.5 font-medium text-right">Negocio nuevo</th>
                <th className="px-4 py-2.5 font-medium text-right text-muted">Renovación</th>
                <th className="px-4 py-2.5 font-medium text-right">Sin clasificar</th>
                <th className="px-4 py-2.5 font-medium text-right">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.agenteId} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{f.nombre}</td>
                  <td className="px-4 py-2.5 text-muted">{f.oficinaNombre}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={f.activo ? "ok" : "neutral"}>{f.activo ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {/* En un mes cerrado el % es parte del recibo, no un campo: dejarlo editable daría
                        a entender que cambiarlo corrige lo que ya se pagó, y no lo hace. */}
                    {data?.cerrada ? (
                      <span className="tabular-nums">{f.pct}%</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <TextInput
                          value={pctEditado[f.agenteId] ?? String(f.pct)}
                          onChange={(e) => setPctEditado((prev) => ({ ...prev, [f.agenteId]: e.target.value }))}
                          onBlur={() => guardarPct(f.agenteId, pctEditado[f.agenteId] ?? String(f.pct))}
                          inputMode="decimal"
                          className="w-20 h-8"
                        />
                        <span className="text-muted">%</span>
                        {guardando === f.agenteId && <span className="text-[11px] text-muted">guardando…</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(f.comisionNuevo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(f.comisionRenovacion)}</td>
                  {/* Solo se pinta cuando hay algo que revisar: un cero en amarillo en todas las
                      filas entrena a ignorar el color justo cuando importa. */}
                  <td
                    className={
                      f.comisionSinClasificar !== 0
                        ? "px-4 py-2.5 text-right tabular-nums text-warn-fg"
                        : "px-4 py-2.5 text-right tabular-nums text-muted"
                    }
                  >
                    {money(f.comisionSinClasificar)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(f.aPagar)}</td>
                </tr>
              ))}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-background/60">
                  <td className="px-4 py-2.5 font-semibold" colSpan={4}>
                    Total {etiquetaPeriodo(periodo)} · {filas.length} agente{filas.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(totalNuevo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(totalRenovacion)}</td>
                  <td
                    className={
                      totalSinClasificar !== 0
                        ? "px-4 py-2.5 text-right tabular-nums font-semibold text-warn-fg"
                        : "px-4 py-2.5 text-right tabular-nums text-muted"
                    }
                  >
                    {money(totalSinClasificar)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(totalAPagar)}</td>
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

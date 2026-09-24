"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Download, AlertTriangle } from "lucide-react";
import { Card, Select, TextInput, Button, Badge, Loading, EmptyState, Banner } from "@/components/agentes/ui";
import { money } from "@/lib/format";
import {
  getLiquidacion,
  actualizarPctSplit,
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

  const filas = useMemo(() => {
    const todas = data?.filas ?? [];
    return soloActivos ? todas.filter((f) => f.activo) : todas;
  }, [data, soloActivos]);

  const totalRecibido = filas.reduce((s, f) => s + f.comisionRecibida, 0);
  const totalAPagar = filas.reduce((s, f) => s + f.aPagar, 0);

  function exportarCsv() {
    const header = ["Agente", "Oficina", "% comisión", "Comisión recibida", "A pagar"];
    const lineas = filas.map((f) =>
      [f.nombre, f.oficinaNombre, f.pct, f.comisionRecibida.toFixed(2), f.aPagar.toFixed(2)]
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

      <Banner tone="info">
        Solo cuenta la comisión ya conciliada (la que el sistema sabe de quién es). Cambiá el % de un agente
        directo en la tabla: se guarda solo y el cálculo se actualiza al instante.
      </Banner>

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
                <th className="px-4 py-2.5 font-medium text-right">Comisión recibida</th>
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
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(f.comisionRecibida)}</td>
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
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(totalRecibido)}</td>
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

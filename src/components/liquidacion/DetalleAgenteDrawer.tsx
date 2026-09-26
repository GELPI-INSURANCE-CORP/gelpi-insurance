"use client";

import { useEffect, useState } from "react";
import { SidePanel, Badge, Loading, Button } from "@/components/agentes/ui";
import { money, fecha as fmtFecha } from "@/lib/format";
import { getDetalleAgente, type LineaDeAgente } from "@/lib/queries/liquidacion";

// Qué hay detrás del número de un agente en Liquidación.
//
// Antes, para saber de dónde salían los $10.100 de alguien había que abrir cada statement y
// filtrar por esa persona — y sus ventas de un mismo mes pueden estar repartidas entre cinco
// compañías. Acá se ven todas juntas, con la fecha, la póliza y el cliente, ordenadas por fecha.
//
// Las líneas se separan en las tres cajas que decide el pago: negocio nuevo (lo que se paga),
// renovación (lo que no) y sin clasificar (lo que hay que mirar). Es el mismo corte que muestra
// la fila de la tabla, para que el detalle explique el número de arriba y no cuente otra cosa.

export default function DetalleAgenteDrawer({
  agenteId,
  nombre,
  periodo,
  etiquetaPeriodo,
  onClose,
}: {
  agenteId: string;
  nombre: string;
  periodo: string;
  etiquetaPeriodo: string;
  onClose: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDeAgente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLineas(null);
    setError(null);
    getDetalleAgente(agenteId, periodo)
      .then((l) => { if (vivo) setLineas(l); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar el detalle."); });
    return () => { vivo = false; };
  }, [agenteId, periodo]);

  const nuevo = (lineas ?? []).filter((l) => l.negocioNuevo === true);
  const renovacion = (lineas ?? []).filter((l) => l.negocioNuevo === false);
  const sinClasificar = (lineas ?? []).filter((l) => l.negocioNuevo == null);
  const suma = (ls: LineaDeAgente[]) => ls.reduce((s, l) => s + l.comision, 0);
  const polizas = new Set((lineas ?? []).map((l) => l.numeroPoliza).filter((p) => p !== "—")).size;

  function exportar() {
    const header = ["Fecha", "Compañía", "Póliza", "Cliente", "Tipo", "Negocio nuevo", "Prima", "Comisión", "Statement"];
    const filas = (lineas ?? []).map((l) =>
      [l.fecha ?? "", l.compania, l.numeroPoliza, l.cliente, l.tipo,
       l.negocioNuevo === true ? "Sí" : l.negocioNuevo === false ? "No" : "Sin clasificar",
       l.prima ?? "", l.comision.toFixed(2), l.statement ?? ""]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nombre.replace(/\s+/g, "-")}-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SidePanel open onClose={onClose} title={nombre} subtitle={`Lo que vendió en ${etiquetaPeriodo}`} width="900px">
      {error && <div className="text-[13px] text-bad-fg">{error}</div>}
      {!error && lineas === null && <Loading />}
      {lineas !== null && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-[13px] text-muted">
              {lineas.length} línea{lineas.length === 1 ? "" : "s"} · {polizas} póliza{polizas === 1 ? "" : "s"} ·{" "}
              {new Set(lineas.map((l) => l.compania)).size} compañía
              {new Set(lineas.map((l) => l.compania)).size === 1 ? "" : "s"}
            </div>
            <Button size="sm" onClick={exportar} disabled={lineas.length === 0}>Exportar a CSV</Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Caja titulo="Negocio nuevo" detalle="se paga" monto={suma(nuevo)} n={nuevo.length} destacado />
            <Caja titulo="Renovación" detalle="no se paga" monto={suma(renovacion)} n={renovacion.length} />
            <Caja titulo="Sin clasificar" detalle="hay que revisarlo" monto={suma(sinClasificar)} n={sinClasificar.length}
                  alerta={sinClasificar.length > 0} />
          </div>

          {lineas.length === 0 ? (
            <div className="text-[13px] text-muted py-6 text-center">
              No hay líneas conciliadas para {nombre} en {etiquetaPeriodo}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="text-left text-muted bg-background/60">
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Compañía</th>
                    <th className="px-3 py-2 font-medium">Póliza</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium text-right">Prima</th>
                    <th className="px-3 py-2 font-medium text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={`${l.numeroPoliza}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.fecha ? fmtFecha(l.fecha) : "—"}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{l.compania}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.numeroPoliza}</td>
                      <td className="px-3 py-2">{l.cliente}</td>
                      <td className="px-3 py-2">
                        <Badge tone={l.negocioNuevo === true ? "ok" : l.negocioNuevo === false ? "neutral" : "warn"}>
                          {l.tipo}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {l.prima == null ? "—" : money(l.prima)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(l.comision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function Caja({
  titulo, detalle, monto, n, destacado, alerta,
}: {
  titulo: string; detalle: string; monto: number; n: number; destacado?: boolean; alerta?: boolean;
}) {
  return (
    <div className={alerta ? "rounded-xl border border-warn-fg/30 bg-warn-bg px-3 py-2.5" : "rounded-xl border border-border px-3 py-2.5"}>
      <div className="text-[11px] text-muted uppercase tracking-wide">{titulo}</div>
      <div className={destacado ? "text-[19px] font-semibold tabular-nums" : "text-[19px] tabular-nums"}>{money(monto)}</div>
      <div className="text-[11px] text-muted">{n} línea{n === 1 ? "" : "s"} · {detalle}</div>
    </div>
  );
}

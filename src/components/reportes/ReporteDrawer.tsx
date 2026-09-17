"use client";

import { useState } from "react";
import Link from "next/link";
import { Info, ArrowRight, Eye, X, Pencil } from "lucide-react";
import { SidePanel, Button, Badge, TextInput, Loading, type Tone } from "@/components/agentes/ui";
import { money, pct, fechaHora, TIPOS_REPORTE, ESTADOS_LINEA } from "@/lib/format";
import {
  actualizarPeriodoReporte,
  type BonoResumen,
  type LineaComision,
  type LineaVenta,
  type Reporte,
} from "@/lib/queries/subir";

const ESTADOS_VENTA_ABB: Record<string, { label: string; tone: Tone }> = {
  pendiente: { label: "Pendiente", tone: "neutral" },
  nuevo: { label: "Nuevo en el ABB", tone: "ok" },
  coincide: { label: "Coincide", tone: "ok" },
  conflicto: { label: "Conflicto", tone: "bad" },
};

export default function ReporteDrawer({
  reporte,
  lineasComision,
  lineasVenta,
  bonoResumen,
  loadingLineas,
  onClose,
  onPeriodoActualizado,
}: {
  reporte: Reporte;
  lineasComision: LineaComision[];
  lineasVenta: LineaVenta[];
  bonoResumen: BonoResumen | null;
  loadingLineas: boolean;
  onClose: () => void;
  onPeriodoActualizado: (periodo: string | null) => void;
}) {
  const [rawModal, setRawModal] = useState<{ titulo: string; datos: Record<string, unknown> | null } | null>(null);
  const verCrudo = (titulo: string, datos: Record<string, unknown> | null) => setRawModal({ titulo, datos });

  const conflictosVenta = lineasVenta.filter((l) => l.estado_en_abb === "conflicto");

  return (
    <>
      <SidePanel
        open
        onClose={onClose}
        title={reporte.nombre_archivo}
        subtitle={reporte.aseguradora?.nombre ?? TIPOS_REPORTE[reporte.tipo]}
        width="920px"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{TIPOS_REPORTE[reporte.tipo] ?? reporte.tipo}</Badge>
            {reporte.confianza_promedio != null && (
              <Badge tone="ok">Confianza promedio {pct(reporte.confianza_promedio)}</Badge>
            )}
            <PeriodoEditor reporte={reporte} onActualizado={onPeriodoActualizado} />
          </div>

          {reporte.mapeo_columnas && Object.keys(reporte.mapeo_columnas).length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Mapeo aprendido:</span>
                {Object.entries(reporte.mapeo_columnas).map(([col, campo]) => (
                  <Badge key={col} tone="neutral">
                    <span>{col}</span>
                    <ArrowRight size={12} />
                    <span>{campo}</span>
                  </Badge>
                ))}
              </div>
              {reporte.columnas_detectadas && reporte.columnas_detectadas.length > 0 && (
                <span className="text-xs text-muted">Columnas detectadas: {reporte.columnas_detectadas.join(", ")}</span>
              )}
            </div>
          )}

          {reporte.resumen_ia && (
            <div className="flex items-start gap-2.5 rounded-lg border border-brand-tint bg-brand-tint px-3.5 py-2.5 text-[13px] text-brand-dark">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>{reporte.resumen_ia}</span>
            </div>
          )}

          <div className="border-t border-border pt-4">
            {loadingLineas ? (
              <Loading />
            ) : reporte.tipo === "venta_interna" ? (
              <VentasTabla lineas={lineasVenta} onVerCrudo={verCrudo} />
            ) : reporte.tipo === "bono_contingencia" ? (
              <BonoResumenTabla bono={bonoResumen} />
            ) : reporte.tipo === "actualizacion_abb" ? (
              <div className="py-4 text-center text-[13px] text-muted">
                Este archivo actualiza el Active Business Book directamente (clientes y pólizas): no genera líneas de
                comisión para revisar acá. Mirá el resumen de arriba para ver cuántas pólizas se crearon o
                actualizaron.
              </div>
            ) : (
              <ComisionTabla lineas={lineasComision} onVerCrudo={verCrudo} />
            )}
          </div>

          {reporte.tipo === "venta_interna" && conflictosVenta.length > 0 && (
            <div className="border-t border-border pt-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">Conflictos de reasignación</span>
                <Badge tone="warn">
                  {conflictosVenta.length} conflicto{conflictosVenta.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <ConflictosTabla lineas={conflictosVenta} />
            </div>
          )}
        </div>
      </SidePanel>

      {rawModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={() => setRawModal(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <h3 className="truncate text-[15px] font-semibold text-foreground">{rawModal.titulo}</h3>
              <button
                type="button"
                onClick={() => setRawModal(null)}
                aria-label="Cerrar"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-background"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
                {rawModal.datos ? JSON.stringify(rawModal.datos, null, 2) : "Sin datos crudos adicionales para esta fila."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PeriodoEditor({ reporte, onActualizado }: { reporte: Reporte; onActualizado: (periodo: string | null) => void }) {
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
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-brand"
      >
        {reporte.periodo ?? "Sin período — click para asignar uno"}
        <Pencil size={12} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-56">
        <TextInput
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder='Ej: "Agosto 2026"'
          className="h-8"
          autoFocus
        />
      </div>
      <Button size="sm" variant="primary" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEditando(false)} disabled={guardando}>
        Cancelar
      </Button>
    </div>
  );
}

function ConflictosTabla({ lineas }: { lineas: LineaVenta[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background">
            {["Agente reportado", "Oficina", "Cliente", "Póliza", "Aseguradora", "Fecha", "Prima", "Conflicto"].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.id} className="border-b border-border last:border-b-0">
              <td className="px-3.5 py-2 font-medium text-foreground">{l.agente_nombre_crudo ?? "—"}</td>
              <td className="px-3.5 py-2 text-muted">{l.oficina_nombre_crudo ?? "—"}</td>
              <td className="px-3.5 py-2">{l.cliente_nombre_crudo ?? "—"}</td>
              <td className="px-3.5 py-2">{l.numero_poliza ?? "—"}</td>
              <td className="px-3.5 py-2 text-muted">{l.aseguradora_nombre_crudo ?? "—"}</td>
              <td className="px-3.5 py-2 text-muted">{fechaHora(l.fecha_venta)}</td>
              <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
              <td className="px-3.5 py-2">
                <div className="flex flex-col items-start gap-1.5">
                  <span className="text-xs text-muted">Esta póliza ya figura asignada a otro agente en el Active Business Book.</span>
                  <Link
                    href="/comisiones/conciliacion"
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-background"
                  >
                    Resolver en Conciliación
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BonoResumenTabla({ bono }: { bono: BonoResumen | null }) {
  if (!bono) {
    return <div className="py-8 text-center text-[13px] text-muted">Todavía no hay un bono registrado para este archivo.</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-semibold text-foreground">{money(bono.monto_total)}</span>
        <Badge tone="neutral">{bono.estado}</Badge>
        {bono.periodo && <span className="text-muted">{bono.periodo}</span>}
      </div>
      {bono.reparto.length === 0 ? (
        <div className="text-[13px] text-muted">
          Este statement no traía detalle por productor: el monto total quedó cargado sin repartir por agente.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-background">
                {["Agente", "Monto", "Motivo", "Pagado"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bono.reparto.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-3.5 py-2 font-medium text-foreground">{r.agente ?? "—"}</td>
                  <td className="px-3.5 py-2 text-right tabular-nums">{money(r.monto)}</td>
                  <td className="px-3.5 py-2 text-muted">{r.motivo ?? "—"}</td>
                  <td className="px-3.5 py-2">
                    <Badge tone={r.pagado ? "ok" : "neutral"}>{r.pagado ? "Pagado" : "Pendiente"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ComisionTabla({
  lineas,
  onVerCrudo,
}: {
  lineas: LineaComision[];
  onVerCrudo: (titulo: string, datos: Record<string, unknown> | null) => void;
}) {
  if (lineas.length === 0) {
    return <div className="py-8 text-center text-[13px] text-muted">Todavía no hay líneas extraídas de este archivo.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="mt-1.5 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background">
            {["Fila", "Póliza", "Asegurado", "Tipo", "Prima", "Tasa", "Comisión", "Vigencia", "Productor (crudo)", "Confianza", "Estado"].map(
              (h) => (
                <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const estado = ESTADOS_LINEA[l.estado] ?? { label: l.estado, tone: "neutral" as Tone };
            return (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="px-3.5 py-2 font-medium text-foreground">Fila {l.fila ?? "—"}</td>
                <td className="px-3.5 py-2">{l.numero_poliza_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.nombre_asegurado_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.tipo_transaccion}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.tasa != null ? `${l.tasa}%` : "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.monto}</td>
                <td className="px-3.5 py-2 text-muted">{l.fecha_vigencia ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.productor_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.confianza != null ? pct(l.confianza) : "—"}</td>
                <td className="px-3.5 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    <button
                      type="button"
                      onClick={() => onVerCrudo(`Fila ${l.fila ?? "—"} — datos crudos`, l.campos_extra)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
                    >
                      <Eye size={12} />
                      Ver datos crudos completos de esta fila
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VentasTabla({
  lineas,
  onVerCrudo,
}: {
  lineas: LineaVenta[];
  onVerCrudo: (titulo: string, datos: Record<string, unknown> | null) => void;
}) {
  if (lineas.length === 0) {
    return <div className="py-8 text-center text-[13px] text-muted">Todavía no hay líneas extraídas de este archivo.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="mt-1.5 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background">
            {["Fila", "Agente", "Oficina", "Cliente", "Póliza", "Aseguradora", "Prima", "Confianza", "Estado"].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-border px-3.5 py-2 text-left font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const estado = ESTADOS_VENTA_ABB[l.estado_en_abb] ?? { label: l.estado_en_abb, tone: "neutral" as Tone };
            return (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="px-3.5 py-2 font-medium text-foreground">Fila {l.fila ?? "—"}</td>
                <td className="px-3.5 py-2">{l.agente_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.oficina_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.cliente_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2">{l.numero_poliza ?? "—"}</td>
                <td className="px-3.5 py-2 text-muted">{l.aseguradora_nombre_crudo ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.prima ?? "—"}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{l.confianza != null ? pct(l.confianza) : "—"}</td>
                <td className="px-3.5 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    <button
                      type="button"
                      onClick={() => onVerCrudo(`Fila ${l.fila ?? "—"} — datos crudos`, l.campos_extra)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-dark"
                    >
                      <Eye size={12} />
                      Ver datos crudos completos de esta fila
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

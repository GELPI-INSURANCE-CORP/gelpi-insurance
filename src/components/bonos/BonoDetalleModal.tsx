"use client";

import { useEffect, useState } from "react";
import { Modal, Field, Select, TextInput, Button, Badge, Loading, EmptyState } from "@/components/agentes/ui";
import { money } from "@/lib/format";
import {
  listRepartoBono,
  agregarFilaReparto,
  quitarFilaReparto,
  simularRepartoProporcional,
  ejecutarReparto,
  marcarBonoPagado,
  type BonoRow,
} from "@/lib/queries/bonos";

const TIPO_LABEL: Record<string, string> = {
  contingencia_aseguradora: "Contingencia de aseguradora",
  spiff_campana: "SPIFF / campaña",
  override_manager: "Override de manager",
  retencion: "Retención",
  volumen: "Volumen",
  otro: "Otro",
};

interface Reparto {
  id: string;
  monto: number;
  motivo: string | null;
  pagado: boolean;
  agente: { id: string; nombre: string } | null;
}

export default function BonoDetalleModal({
  bono,
  onClose,
  onChanged,
  agentes,
}: {
  bono: BonoRow;
  onClose: () => void;
  onChanged: () => void;
  agentes: { id: string; nombre: string }[];
}) {
  const [reparto, setReparto] = useState<Reparto[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevoAgenteId, setNuevoAgenteId] = useState("");
  const [nuevoMonto, setNuevoMonto] = useState("");
  const [nuevoMotivo, setNuevoMotivo] = useState("");
  const [propuesta, setPropuesta] = useState<{ agente_id: string; agente_nombre: string; produccion: number; monto: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorSimulacion, setErrorSimulacion] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    listRepartoBono(bono.id)
      .then((r) => setReparto(r as unknown as Reparto[]))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, [bono.id]);

  async function agregar() {
    if (!nuevoAgenteId || !nuevoMonto) return;
    setBusy(true);
    try {
      await agregarFilaReparto(bono.id, nuevoAgenteId, Number(nuevoMonto), nuevoMotivo);
      setNuevoAgenteId("");
      setNuevoMonto("");
      setNuevoMotivo("");
      cargar();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function quitar(id: string) {
    setBusy(true);
    try {
      await quitarFilaReparto(id);
      cargar();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function simular() {
    setBusy(true);
    setErrorSimulacion(null);
    try {
      const p = await simularRepartoProporcional(bono);
      setPropuesta(p);
    } catch (e) {
      setErrorSimulacion(e instanceof Error ? e.message : "No se pudo simular el reparto.");
    } finally {
      setBusy(false);
    }
  }

  async function ejecutar() {
    if (!propuesta || propuesta.length === 0) return;
    setBusy(true);
    try {
      await ejecutarReparto(bono.id, propuesta);
      setPropuesta(null);
      cargar();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function marcarPagado() {
    setBusy(true);
    try {
      await marcarBonoPagado(bono.id);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const totalReparto = reparto.reduce((s, r) => s + Number(r.monto), 0);

  return (
    <Modal open onClose={onClose} title={bono.nombre ?? TIPO_LABEL[bono.tipo]} width="720px">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-3 text-[13px]">
          <Info label="Tipo" value={TIPO_LABEL[bono.tipo] ?? bono.tipo} />
          <Info label="Aseguradora" value={bono.aseguradora?.nombre ?? "—"} />
          <Info label="Período" value={bono.periodo ?? "—"} />
          <Info label="Monto total" value={money(bono.monto_total)} />
        </div>
        <div className="text-xs text-muted bg-brand-tint text-brand-dark rounded-lg p-2.5">
          Regla de reparto: <strong>{bono.regla_reparto}</strong> · Los bonos nunca se mezclan con la comisión regular.
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold">Reparto ({reparto.length} agentes · {money(totalReparto)})</div>
            {bono.regla_reparto === "proporcional_produccion" && (
              <Button size="sm" onClick={simular} disabled={busy}>
                Simular reparto
              </Button>
            )}
          </div>
          {errorSimulacion && <p className="text-xs text-bad-fg mb-2">{errorSimulacion}</p>}
          {loading ? (
            <Loading />
          ) : reparto.length === 0 && !propuesta ? (
            <EmptyState title="Sin reparto todavía" subtitle="Agregá filas a mano o simulá un reparto proporcional." />
          ) : (
            <div className="flex flex-col divide-y divide-border border border-border rounded-lg">
              {reparto.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <div>
                    <div className="font-medium">{r.agente?.nombre}</div>
                    {r.motivo && <div className="text-xs text-muted">{r.motivo}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-medium">{money(r.monto)}</span>
                    <Badge tone={r.pagado ? "ok" : "warn"}>{r.pagado ? "Pagado" : "Pendiente"}</Badge>
                    <button onClick={() => quitar(r.id)} className="text-bad-fg text-xs hover:underline">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {propuesta && (
          <div>
            <div className="text-[13px] font-semibold mb-2">Propuesta simulada (proporcional a producción)</div>
            <div className="flex flex-col divide-y divide-border border border-border rounded-lg">
              {propuesta.map((p) => (
                <div key={p.agente_id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <div>
                    <div className="font-medium">{p.agente_nombre}</div>
                    <div className="text-xs text-muted">Producción: {money(p.produccion)}</div>
                  </div>
                  <span className="tabular-nums font-medium">{money(p.monto)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="secondary" size="sm" onClick={() => setPropuesta(null)}>
                Descartar
              </Button>
              <Button variant="primary" size="sm" onClick={ejecutar} disabled={busy}>
                Ejecutar reparto
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="text-[13px] font-semibold mb-2">Agregar fila manual</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={nuevoAgenteId}
              onChange={setNuevoAgenteId}
              options={[{ value: "", label: "Agente…" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]}
              className="w-48"
            />
            <TextInput type="number" value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)} placeholder="Monto" className="w-28" />
            <TextInput value={nuevoMotivo} onChange={(e) => setNuevoMotivo(e.target.value)} placeholder="Motivo (opcional)" className="flex-1 min-w-[160px]" />
            <Button size="sm" onClick={agregar} disabled={busy || !nuevoAgenteId || !nuevoMonto}>
              Agregar
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" onClick={marcarPagado} disabled={busy || bono.estado === "pagado" || reparto.length === 0}>
            Marcar como pagado
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}

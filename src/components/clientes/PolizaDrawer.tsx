"use client";

import { useEffect, useState } from "react";
import { SidePanel, Field, Select, TextInput, Button, Badge, Loading } from "@/components/agentes/ui";
import { money, fecha, fechaHora, RAMOS } from "@/lib/format";
import { getAuditoriaPoliza, actualizarPoliza, type EdicionPoliza } from "@/lib/queries/clientes";

interface PolizaVista {
  id: string;
  cliente: string | null;
  telefono: string | null;
  email: string | null;
  numero_poliza: string;
  aseguradora: string | null;
  ramo: string;
  agente: string | null;
  agente_id: string | null;
  oficina: string | null;
  oficina_id: string | null;
  fecha_vigencia: string | null;
  fecha_vencimiento: string | null;
  estado: string;
  origen: string;
  prima: number | null;
  updated_at: string;
}

const ESTADOS = [
  { value: "activa", label: "Activa" },
  { value: "cancelada", label: "Cancelada" },
  { value: "vencida", label: "Vencida" },
  { value: "pendiente", label: "Pendiente" },
];

const ORIGENES: Record<string, string> = { venta_interna: "Venta interna", alta_manual: "Alta manual", import: "Importado (ABB)" };

export default function PolizaDrawer({
  poliza,
  onClose,
  onSaved,
  agentes,
  oficinas,
}: {
  poliza: PolizaVista;
  onClose: () => void;
  onSaved: () => void;
  agentes: { id: string; nombre: string }[];
  oficinas: { id: string; nombre: string }[];
}) {
  const [agenteId, setAgenteId] = useState(poliza.agente_id ?? "");
  const [oficinaId, setOficinaId] = useState(poliza.oficina_id ?? "");
  const [estado, setEstado] = useState(poliza.estado);
  const [ramo, setRamo] = useState(poliza.ramo);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditoria, setAuditoria] = useState<{ id: number; campo: string | null; valor_anterior: string | null; valor_nuevo: string | null; motivo: string | null; created_at: string }[]>([]);
  const [loadingAud, setLoadingAud] = useState(true);

  useEffect(() => {
    getAuditoriaPoliza(poliza.id)
      .then((a) => setAuditoria(a as typeof auditoria))
      .finally(() => setLoadingAud(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poliza.id]);

  const cambioAgente = agenteId !== (poliza.agente_id ?? "");

  async function guardar() {
    if (cambioAgente && !motivo.trim()) {
      setError("El motivo es obligatorio al cambiar el agente.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cambios: EdicionPoliza = {};
      const anteriores: EdicionPoliza = {};
      if (agenteId !== (poliza.agente_id ?? "")) {
        cambios.agente_id = agenteId || null;
        anteriores.agente_id = poliza.agente_id;
      }
      if (oficinaId !== (poliza.oficina_id ?? "")) {
        cambios.oficina_id = oficinaId || null;
        anteriores.oficina_id = poliza.oficina_id;
      }
      if (estado !== poliza.estado) {
        cambios.estado = estado;
        anteriores.estado = poliza.estado;
      }
      if (ramo !== poliza.ramo) {
        cambios.ramo = ramo;
        anteriores.ramo = poliza.ramo;
      }
      await actualizarPoliza(poliza.id, cambios, anteriores, motivo || undefined);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidePanel open onClose={onClose} title={poliza.cliente ?? "Cliente"} subtitle={`Póliza ${poliza.numero_poliza}`} width="520px">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <Info label="Teléfono" value={poliza.telefono ?? "—"} />
          <Info label="Email" value={poliza.email ?? "—"} />
          <Info label="Aseguradora" value={poliza.aseguradora ?? "—"} />
          <Info label="Prima" value={money(poliza.prima)} />
          <Info label="Vigencia" value={fecha(poliza.fecha_vigencia)} />
          <Info label="Vencimiento" value={fecha(poliza.fecha_vencimiento)} />
          <Info label="Origen" value={ORIGENES[poliza.origen] ?? poliza.origen} />
          <Info label="Última actualización" value={fechaHora(poliza.updated_at)} />
        </div>

        <div className="border-t border-border pt-4 flex flex-col gap-3">
          <div className="text-[13px] font-semibold">Edición</div>
          <Field label="Agente">
            <Select value={agenteId} onChange={setAgenteId} options={[{ value: "", label: "Sin asignar" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]} />
          </Field>
          <Field label="Oficina">
            <Select value={oficinaId} onChange={setOficinaId} options={[{ value: "", label: "Sin asignar" }, ...oficinas.map((o) => ({ value: o.id, label: o.nombre }))]} />
          </Field>
          <Field label="Estado">
            <Select value={estado} onChange={setEstado} options={ESTADOS} />
          </Field>
          <Field label="Ramo">
            <Select value={ramo} onChange={setRamo} options={Object.entries(RAMOS).map(([value, label]) => ({ value, label }))} />
          </Field>
          {cambioAgente && (
            <Field label="Motivo del cambio de agente (obligatorio)">
              <TextInput value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se reasigna esta póliza…" />
            </Field>
          )}
          {error && <p className="text-xs text-bad-fg">{error}</p>}
          <Button variant="primary" onClick={guardar} disabled={saving} className="justify-center">
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <div className="text-[13px] font-semibold mb-2">Historial de auditoría</div>
          {loadingAud ? (
            <Loading />
          ) : auditoria.length === 0 ? (
            <div className="text-xs text-muted">Sin cambios registrados para esta póliza.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {auditoria.map((a) => (
                <div key={a.id} className="bg-background rounded-lg p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.campo ?? "cambio"}</span>
                    <span className="text-muted">{fechaHora(a.created_at)}</span>
                  </div>
                  <div className="text-muted mt-1">
                    {a.valor_anterior ?? "—"} → <span className="text-foreground">{a.valor_nuevo ?? "—"}</span>
                  </div>
                  {a.motivo && <div className="text-muted mt-1">Motivo: {a.motivo}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SidePanel>
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

export function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, "ok" | "bad" | "warn" | "neutral"> = {
    activa: "ok",
    cancelada: "bad",
    vencida: "warn",
    pendiente: "neutral",
  };
  const label: Record<string, string> = { activa: "Activa", cancelada: "Cancelada", vencida: "Vencida", pendiente: "Pendiente" };
  return <Badge tone={map[estado] ?? "neutral"}>{label[estado] ?? estado}</Badge>;
}

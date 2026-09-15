"use client";

import { useState } from "react";
import { Modal, Field, TextInput, Select, Button } from "@/components/agentes/ui";
import { crearBonoManual } from "@/lib/queries/bonos";

const TIPOS = [
  { value: "contingencia_aseguradora", label: "Contingencia de aseguradora" },
  { value: "spiff_campana", label: "SPIFF / campaña" },
  { value: "override_manager", label: "Override de manager" },
  { value: "retencion", label: "Retención" },
  { value: "volumen", label: "Volumen" },
  { value: "otro", label: "Otro" },
];

const REGLAS = [
  { value: "manual", label: "Manual" },
  { value: "proporcional_produccion", label: "Proporcional a producción" },
  { value: "fijo_por_oficina", label: "Fijo por oficina" },
  { value: "proporcional_retencion", label: "Proporcional a retención" },
];

export default function NuevoBonoModal({
  open,
  onClose,
  onCreated,
  aseguradoras,
  oficinas,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  aseguradoras: { id: string; nombre: string }[];
  oficinas: { id: string; nombre: string }[];
}) {
  const [tipo, setTipo] = useState("otro");
  const [nombre, setNombre] = useState("");
  const [aseguradoraId, setAseguradoraId] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [monto, setMonto] = useState("");
  const [regla, setRegla] = useState("manual");
  const [oficinaId, setOficinaId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!nombre.trim() || !monto) {
      setError("Nombre y monto son obligatorios.");
      return;
    }
    if (periodo.trim() && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo.trim())) {
      setError("Período inválido: usá el formato AAAA-MM (ej: 2026-09).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await crearBonoManual({
        tipo,
        nombre: nombre.trim(),
        aseguradora_id: aseguradoraId || null,
        periodo,
        monto_total: Number(monto) || 0,
        regla_reparto: regla,
        oficina_id: oficinaId || null,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el bono.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cargar bono manual">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo">
          <Select value={tipo} onChange={setTipo} options={TIPOS} />
        </Field>
        <Field label="Nombre">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <Field label="Aseguradora">
          <Select value={aseguradoraId} onChange={setAseguradoraId} options={[{ value: "", label: "N/A" }, ...aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]} />
        </Field>
        <Field label="Período (AAAA-MM)">
          <TextInput value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="2026-09" />
        </Field>
        <Field label="Monto total">
          <TextInput type="number" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Field>
        <Field label="Regla de reparto">
          <Select value={regla} onChange={setRegla} options={REGLAS} />
        </Field>
        {regla === "fijo_por_oficina" && (
          <Field label="Oficina">
            <Select value={oficinaId} onChange={setOficinaId} options={[{ value: "", label: "Seleccionar…" }, ...oficinas.map((o) => ({ value: o.id, label: o.nombre }))]} />
          </Field>
        )}
      </div>
      {error && <p className="text-xs text-bad-fg mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Guardando…" : "Cargar bono"}
        </Button>
      </div>
    </Modal>
  );
}

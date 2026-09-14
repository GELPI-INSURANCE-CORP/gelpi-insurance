"use client";

import { useState } from "react";
import { Modal, Field, TextInput, Select, Button } from "@/components/agentes/ui";
import { altaManualClientePoliza } from "@/lib/queries/clientes";
import { RAMOS } from "@/lib/format";

export default function AltaManualModal({
  open,
  onClose,
  onCreated,
  agentes,
  oficinas,
  aseguradoras,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  agentes: { id: string; nombre: string }[];
  oficinas: { id: string; nombre: string }[];
  aseguradoras: { id: string; nombre: string }[];
}) {
  const [clienteNombre, setClienteNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [numeroPoliza, setNumeroPoliza] = useState("");
  const [aseguradoraId, setAseguradoraId] = useState("");
  const [ramo, setRamo] = useState("auto");
  const [agenteId, setAgenteId] = useState("");
  const [oficinaId, setOficinaId] = useState("");
  const [fechaVigencia, setFechaVigencia] = useState("");
  const [prima, setPrima] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!clienteNombre.trim() || !numeroPoliza.trim() || !aseguradoraId || !agenteId || !oficinaId) {
      setError("Cliente, póliza, aseguradora, agente y oficina son obligatorios.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await altaManualClientePoliza({
        cliente_nombre: clienteNombre.trim(),
        telefono,
        email,
        numero_poliza: numeroPoliza.trim(),
        aseguradora_id: aseguradoraId,
        ramo,
        agente_id: agenteId,
        oficina_id: oficinaId,
        fecha_vigencia: fechaVigencia,
        prima: Number(prima) || 0,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo dar de alta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Alta manual de cliente / póliza" width="640px">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre del cliente">
          <TextInput value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Número de póliza">
          <TextInput value={numeroPoliza} onChange={(e) => setNumeroPoliza(e.target.value)} />
        </Field>
        <Field label="Aseguradora">
          <Select value={aseguradoraId} onChange={setAseguradoraId} options={[{ value: "", label: "Seleccionar…" }, ...aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]} />
        </Field>
        <Field label="Ramo">
          <Select value={ramo} onChange={setRamo} options={Object.entries(RAMOS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Agente">
          <Select value={agenteId} onChange={setAgenteId} options={[{ value: "", label: "Seleccionar…" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]} />
        </Field>
        <Field label="Oficina">
          <Select value={oficinaId} onChange={setOficinaId} options={[{ value: "", label: "Seleccionar…" }, ...oficinas.map((o) => ({ value: o.id, label: o.nombre }))]} />
        </Field>
        <Field label="Vigencia">
          <TextInput type="date" value={fechaVigencia} onChange={(e) => setFechaVigencia(e.target.value)} />
        </Field>
        <Field label="Prima">
          <TextInput type="number" value={prima} onChange={(e) => setPrima(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-xs text-bad-fg mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Guardando…" : "Dar de alta"}
        </Button>
      </div>
    </Modal>
  );
}
